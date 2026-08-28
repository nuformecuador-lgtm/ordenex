import { describe, it, expect, vi } from "vitest";
import { EtiquetaGuiaService } from "@/lib/services/EtiquetaGuiaService";
import type { EtiquetaRow, IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };

// Fila de etiqueta con guia asignada por defecto (nombres resueltos). Los tests
// sobreescriben lo que necesiten.
function etiquetaRow(overrides: Partial<EtiquetaRow> = {}): EtiquetaRow {
  return {
    id: "o1",
    tiendaId: "tienda-1",
    numGuia: 501,
    numRemision: "REM-1",
    destinatario: "Juan Perez",
    telefonoDest: "0999999999",
    direccion: "Av. Siempre Viva 742",
    producto: "Caja x2",
    montoCobrar: 25.5,
    tiendaNombre: "Tienda Uno",
    zonaNombre: "GAM",
    provinciaNombre: "San Jose",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    fechaCreacion: "2026-08-25", // feature 295: ya serializada por el repo (YYYY-MM-DD de CR)
    ...overrides,
  };
}

// Stub de IOrdenRepository: solo `findEtiquetasByIds` / `findEtiquetaByNumGuia` se
// ejercitan; el resto son stubs que fallarian si se invocan (patron
// guia-asignacion-service.test.ts).
function fakeRepo(rows: EtiquetaRow[] = [etiquetaRow()]): IOrdenRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    existsEstatus: vi.fn(),
    findEstatusIdByValue: vi.fn(),
    findUsuarioFulfillment: vi.fn(),
    existsGeo: vi.fn(),
    findExistingRemisiones: vi.fn(),
    findAllProvincias: vi.fn(),
    findCantonesByProvinciaIds: vi.fn(),
    findDistritosByCantonIds: vi.fn(),
    createManyOrdenes: vi.fn(),
    findByIdsForTransicion: vi.fn(),
    findByNumGuiaForTransicion: vi.fn(),
    findMensajeroIdsValidos: vi.fn(),
    findAllMensajeros: vi.fn(),
    listOrderStatus: vi.fn(),
    generarGuiaLote: vi.fn(),
    asignarBodegaLote: vi.fn(),
    findMensajerosByZona: vi.fn(),
    findMensajeroIdsConVehiculo: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajeroIdsValidosByZona: vi.fn(),
    rutearBodegaSateliteLote: vi.fn(),
    // Feature 32: filtra por ids solicitados (simula el `where id in` del repo).
    findEtiquetasByIds: vi.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.id))),
    // QR por guia: simula el `where num_guia = ? and deleted_at is null` (UNIQUE).
    findEtiquetaByNumGuia: vi.fn(
      async (numGuia: number) => rows.find((r) => r.numGuia === numGuia) ?? null,
    ),
  } as unknown as IOrdenRepository;
}

describe("EtiquetaGuiaService — autorizacion (cualquier rol autenticado)", () => {
  it("cualquier rol (admin/adminTienda/mensajero/maestro) genera etiqueta, sin forbidden", async () => {
    const repo = fakeRepo();
    const service = new EtiquetaGuiaService(repo);

    for (const actor of [ADMIN, ADMIN_TIENDA, MENSAJERO, MAESTRO]) {
      const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, actor);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") throw new Error("unreachable");
      expect(r.etiquetas).toHaveLength(1);
    }
    expect(repo.findEtiquetasByIds).toHaveBeenCalled();
  });
});

// Feature 136 — aislamiento entre tiendas para el canal de integracion. Hasta la
// 136 la garantia descansaba SOLO en el borde (los ids salian del summary de la
// propia carga); estos tests la fijan en el service, que es donde vive la autz.
describe("EtiquetaGuiaService — aislamiento por dueño del rol apiKey (feature 136)", () => {
  const KEY_TIENDA_1: Actor = { usuarioId: "tienda-1", rol: "apiKey" };
  const KEY_TIENDA_2: Actor = { usuarioId: "tienda-2", rol: "apiKey" };

  it("una API key NO obtiene la etiqueta de una orden de otra tienda", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", tiendaId: "tienda-1" })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, KEY_TIENDA_2);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas).toEqual([]);
    // Se reporta igual que una orden inexistente: no revela que la orden existe.
    expect(r.omitidas).toEqual([{ ordenId: "o1", motivo: "no_encontrada" }]);
  });

  it("una API key SI obtiene la etiqueta de sus propias ordenes", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", tiendaId: "tienda-1" })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, KEY_TIENDA_1);

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas).toHaveLength(1);
    expect(r.etiquetas[0].ordenId).toBe("o1");
    expect(r.omitidas).toEqual([]);
  });

  it("en un lote mixto, la API key solo recibe las etiquetas de su tienda", async () => {
    const repo = fakeRepo([
      etiquetaRow({ id: "propia", tiendaId: "tienda-1", numGuia: 11 }),
      etiquetaRow({ id: "ajena", tiendaId: "tienda-2", numGuia: 22 }),
    ]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["propia", "ajena"] }, KEY_TIENDA_1);

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas).toHaveLength(1);
    expect(r.etiquetas[0].ordenId).toBe("propia");
    expect(r.etiquetas.map((e) => e.numGuia)).not.toContain(22);
    expect(r.omitidas).toEqual([{ ordenId: "ajena", motivo: "no_encontrada" }]);
  });

  it("la ruta por num_guia tampoco expone la orden de otra tienda a una API key", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", tiendaId: "tienda-1", numGuia: 501 })]);
    const service = new EtiquetaGuiaService(repo);

    expect((await service.obtenerEtiquetaPorGuia(501, KEY_TIENDA_2)).status).toBe("no_encontrada");
    expect((await service.obtenerEtiquetaPorGuia(501, KEY_TIENDA_1)).status).toBe("ok");
  });

  it("los roles de sesion NO se filtran por dueño (comportamiento de la feature 32)", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", tiendaId: "otra-tienda" })]);
    const service = new EtiquetaGuiaService(repo);

    for (const actor of [MAESTRO, ADMIN, ADMIN_TIENDA, MENSAJERO]) {
      const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, actor);
      if (r.status !== "ok") throw new Error("unreachable");
      expect(r.etiquetas).toHaveLength(1);
    }
  });
});

describe("EtiquetaGuiaService — armado del DTO de etiqueta (R1)", () => {
  it("R1: orden con guia y geografia completas -> DTO con todos los nombres resueltos", async () => {
    const repo = fakeRepo([etiquetaRow()]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.omitidas).toEqual([]);
    expect(r.etiquetas).toHaveLength(1);
    expect(r.etiquetas[0]).toEqual({
      ordenId: "o1",
      numGuia: 501,
      numRemision: "REM-1",
      destinatario: "Juan Perez",
      telefonoDest: "0999999999",
      direccion: "Av. Siempre Viva 742",
      producto: "Caja x2",
      montoCobrar: 25.5,
      tiendaNombre: "Tienda Uno",
      zonaNombre: "GAM",
      provinciaNombre: "San Jose",
      cantonNombre: "Central",
      distritoNombre: "Carmen",
      // Feature 295: la fecha de creacion viaja del repo al DTO SIN reformatearse.
      fechaCreacion: "2026-08-25",
      qrValue: "501",
      barcodeValue: "501",
    });
  });
});

describe("EtiquetaGuiaService — orden sin guia (R2)", () => {
  it("R2: orden existente sin num_guia -> omitida 'sin_guia', sin etiqueta (no tiene QR)", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", numGuia: null })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas).toEqual([]);
    expect(r.omitidas).toEqual([{ ordenId: "o1", motivo: "sin_guia" }]);
  });
});

describe("EtiquetaGuiaService — orden inexistente/borrada (R3)", () => {
  it("R3: id no encontrado (no viene de la query) + orden valida -> etiqueta del valido, omitida del otro (no aborta el lote)", async () => {
    // El repo solo devuelve o1 (o2 no existe o esta borrada -> el repo lo excluye).
    const repo = fakeRepo([etiquetaRow({ id: "o1" })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas).toHaveLength(1);
    expect(r.etiquetas[0].ordenId).toBe("o1");
    expect(r.omitidas).toEqual([{ ordenId: "o2", motivo: "no_encontrada" }]);
  });
});

describe("EtiquetaGuiaService — distrito ausente (R4)", () => {
  it("R4: orden sin distrito -> distritoNombre null con etiqueta valida y resto de geografia", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", distritoNombre: null })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas[0].distritoNombre).toBeNull();
    expect(r.etiquetas[0].zonaNombre).toBe("GAM");
    expect(r.etiquetas[0].provinciaNombre).toBe("San Jose");
    expect(r.etiquetas[0].cantonNombre).toBe("Central");
  });
});

describe("EtiquetaGuiaService — montoCobrar serializable (R5)", () => {
  it("R5: montoCobrar number cuando la orden lo trae; sin simbolo de moneda", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", montoCobrar: 99.9 })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, MAESTRO);

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas[0].montoCobrar).toBe(99.9);
    expect(typeof r.etiquetas[0].montoCobrar).toBe("number");
  });

  it("R5: montoCobrar null cuando la orden no lo trae", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", montoCobrar: null })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, MAESTRO);

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas[0].montoCobrar).toBeNull();
  });
});

describe("EtiquetaGuiaService — no expone internos (R6)", () => {
  it("R6: el DTO de etiqueta no contiene deletedAt ni claves fuera del contrato", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1" })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, MAESTRO);

    if (r.status !== "ok") throw new Error("unreachable");
    const keys = Object.keys(r.etiquetas[0]).sort();
    expect(keys).not.toContain("deletedAt");
    expect(keys).toEqual(
      [
        "barcodeValue",
        "cantonNombre",
        "destinatario",
        "direccion",
        "distritoNombre",
        "fechaCreacion", // feature 295
        "montoCobrar",
        "numGuia",
        "numRemision",
        "ordenId",
        "producto",
        "provinciaNombre",
        "qrValue",
        "telefonoDest",
        "tiendaNombre",
        "zonaNombre",
      ].sort(),
    );
  });
});

describe("EtiquetaGuiaService — codificacion QR/barcode (R7/R8)", () => {
  it("R7: qrValue === String(numGuia) (el QR ya NO codifica orden.id)", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "orden-uuid-abc", numGuia: 700 })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["orden-uuid-abc"] }, MAESTRO);

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas[0].qrValue).toBe("700");
    expect(r.etiquetas[0].qrValue).toBe(String(r.etiquetas[0].numGuia));
    expect(r.etiquetas[0].qrValue).not.toBe(r.etiquetas[0].ordenId);
  });

  it("R7/R8: qrValue y barcodeValue codifican el MISMO num_guia", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", numGuia: 4242 })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, MAESTRO);

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas[0].qrValue).toBe(r.etiquetas[0].barcodeValue);
  });

  it("R8: barcodeValue === String(numGuia)", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", numGuia: 12345 })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.generarEtiquetas({ ordenIds: ["o1"] }, MAESTRO);

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas[0].barcodeValue).toBe("12345");
    expect(r.etiquetas[0].barcodeValue).toBe(String(r.etiquetas[0].numGuia));
  });
});

describe("EtiquetaGuiaService — etiqueta por num_guia (ruta /paquete/<numGuia>)", () => {
  it("R1/R7: resuelve la etiqueta de la orden con ese num_guia (mismo DTO)", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", numGuia: 501 })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.obtenerEtiquetaPorGuia(501, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiqueta.ordenId).toBe("o1");
    expect(r.etiqueta.numGuia).toBe(501);
    expect(r.etiqueta.qrValue).toBe("501");
    expect(repo.findEtiquetaByNumGuia).toHaveBeenCalledWith(501);
  });

  it("R3: sin orden viva con ese num_guia (inexistente o borrada) -> no_encontrada", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", numGuia: 501 })]);
    const service = new EtiquetaGuiaService(repo);

    const r = await service.obtenerEtiquetaPorGuia(999, MAESTRO);

    expect(r.status).toBe("no_encontrada");
  });

  it("cualquier rol autenticado resuelve la etiqueta por guia (sin forbidden)", async () => {
    const repo = fakeRepo([etiquetaRow({ id: "o1", numGuia: 501 })]);
    const service = new EtiquetaGuiaService(repo);

    for (const actor of [ADMIN, ADMIN_TIENDA, MENSAJERO, MAESTRO]) {
      const r = await service.obtenerEtiquetaPorGuia(501, actor);
      expect(r.status).toBe("ok");
    }
  });
});
