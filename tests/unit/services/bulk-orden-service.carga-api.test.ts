import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import type {
  CreateOrdenData,
  CreateOrdenConGuiaResultRow,
  IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigente,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";

// Feature 98 — tarifa vigente por defecto del lote (no-central: valorFlete; central:
// valorFleteGam). `ivaFlete` 12% no trivial para verificar la suma del IVA (D2/R7).
const TARIFA: TarifaVigente = {
  valorFlete: "3.50", // -> costoEnvio no-central = 3.50 + 12% = "3.92"
  valorFleteGam: "5.00", // -> costoEnvio central = 5.00 + 12% = "5.60"
  valorFleteDevuelto: "1.00",
  valorFleteDevueltoGam: "2.00",
  comisionCod: "5.00",
  ivaFlete: "12.00", // 12%
  ivaComisionCod: "12.00",
};

// Fake del resolver de tarifa por tienda. `tarifa=null` simula el gap (D1 -> "0.00").
function buildTarifaRepo(tarifa: TarifaVigente | null = TARIFA): ITarifaVigentePorTiendaRepository {
  return {
    resolveTarifaPorTienda: vi.fn(async () => tarifa),
    resolveTarifasPorTiendas: vi.fn(async () => new Map()),
  };
}

// Servicio con las dos dependencias (repo + tarifa). Por defecto usa la TARIFA de arriba.
function buildService(
  repo: IOrdenRepository,
  tarifaRepo: ITarifaVigentePorTiendaRepository = buildTarifaRepo(),
): BulkOrdenService {
  return new BulkOrdenService(repo, tarifaRepo);
}

// Feature 88 — BulkOrdenService.cargarViaApi: reusa la resolucion/dedup/validacion de la
// carga masiva pero autoriza SOLO al rol apiKey, fija el estado inicial en
// en_ruta_bodega_principal y persiste con num_guia inmediato.

const APIKEY: Actor = { usuarioId: "key-user-1", rol: "apiKey" as RolValue };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };

// Mock por defecto de la persistencia con guia: hace eco de las filas recibidas,
// asignando guias consecutivas desde 1000 y el estado inicial de la via API.
function conGuiaEco(data: CreateOrdenData[]): CreateOrdenConGuiaResultRow[] {
  return data.map((d, i) => ({
    ordenId: `ord-${d.numRemision}`,
    numRemision: d.numRemision,
    numGuia: 1000 + i,
    estatusValue: "en_ruta_bodega_principal",
  }));
}

function buildRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    existsEstatus: vi.fn(),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-erbp"),
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
    existsGeo: vi.fn(),
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findAllProvincias: vi.fn().mockResolvedValue([{ id: "p1", nombre: "Pichincha" }]),
    findCantonesByProvinciaIds: vi.fn().mockResolvedValue([{ id: "c1", nombre: "Quito", provinciaId: "p1" }]),
    findDistritosByCantonIds: vi
      .fn()
      .mockResolvedValue([
        { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1", esCentral: false },
      ]),
    findMensajerosByIds: vi.fn().mockResolvedValue(new Set(["msg-1"])),
    createManyOrdenes: vi.fn().mockResolvedValue(0),
    createManyOrdenesConGuia: vi.fn(async (data: CreateOrdenData[]) => conGuiaEco(data)),
    findByIdsForTransicion: vi.fn().mockResolvedValue([]),
    findByNumGuiaForTransicion: vi.fn().mockResolvedValue(null),
    findMensajeroIdsValidos: vi.fn().mockResolvedValue(new Set()),
    findAllMensajeros: vi.fn().mockResolvedValue([]),
    listOrderStatus: vi.fn().mockResolvedValue([]),
    generarGuiaLote: vi.fn().mockResolvedValue([]),
    asignarBodegaLote: vi.fn().mockResolvedValue(0),
    findMensajerosByZona: vi.fn().mockResolvedValue([]),
    findMensajeroIdsValidosByZona: vi.fn().mockResolvedValue(new Set()),
    rutearBodegaSateliteLote: vi.fn().mockResolvedValue(0),
    findResumenByNumRemisiones: vi.fn().mockResolvedValue([]),
    asignarMensajeroSugerido: vi.fn().mockResolvedValue(0),
    countOrdenesDeTienda: vi.fn().mockResolvedValue(0),
    findEtiquetasByIds: vi.fn().mockResolvedValue([]),
    findEtiquetaByNumGuia: vi.fn().mockResolvedValue(null),
    findUsuarioZonaId: vi.fn().mockResolvedValue(null),
    findUsuarioVehiculoId: vi.fn().mockResolvedValue(null),
    findRecepcionSateliteByZona: vi.fn().mockResolvedValue([]),
    recibirEnSatelite: vi.fn().mockResolvedValue(false),
    recibirEnOrigen: vi.fn().mockResolvedValue(false),
    recibirLoteEnSatelite: vi.fn().mockResolvedValue(0),
    asignarSateliteLote: vi.fn().mockResolvedValue(0),
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
    findZonasConMensajeroBloqueado: vi.fn(async (): Promise<Set<string>> => new Set()),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    // [89] Lecturas de /novedades, incorporadas a `IOrdenRepository` al mergear `dev`. La
    // carga por API no las usa; se stubean neutras para satisfacer la interfaz completa.
    countDevueltasByTienda: vi.fn(async (): Promise<number> => 0),
    findDevueltasByTienda: vi.fn(async () => []),
    // Feature 92 (R8/R35): metodos nuevos de lectura de `IOrdenRepository`. Estos
    // tests no ejercitan el gate de coordenadas ni la ruta: devuelven vacio.
    findParaAsignabilidad: vi.fn(async () => []),
    findParadasEnReparto: vi.fn(async () => []),
    findCausasDevueltaVigentes: vi.fn(async () => new Map()),
    // Feature 106: canal integrador (API por key), no ejercitado aqui.
    listByOwner: vi.fn(async () => ({ items: [], total: 0 })),
    findDetalleByNumGuiaForOwner: vi.fn(async () => null),
    cancelarViaApi: vi.fn(async () => ({ status: "not_found" as const })),
    ...overrides,
  };
}

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton: "Quito",
    distrito: "La Mariscal",
    direccion: "",
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
    mensajero_sugerido_id: "",
    ...overrides,
  };
}

function conGuiaArg(repo: IOrdenRepository) {
  return (repo.createManyOrdenesConGuia as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateOrdenData[];
}

describe("cargarViaApi — autorizacion (R15)", () => {
  it.each([TIENDA, MAESTRO, MENSAJERO])("rol %o distinto de apiKey -> forbidden sin tocar datos", async (actor) => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row()], actor);
    expect(r.status).toBe("forbidden");
    expect(repo.findExistingRemisiones).not.toHaveBeenCalled();
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });

  it("rol apiKey -> autorizado", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row()], APIKEY);
    expect(r.status).toBe("ok");
  });
});

describe("cargarViaApi — dueño y estado inicial (R8, D4)", () => {
  it("tienda_id = usuario dedicado de la key (D4)", async () => {
    const repo = buildRepo();
    await buildService(repo).cargarViaApi([row()], APIKEY);
    expect(conGuiaArg(repo)[0].tiendaId).toBe("key-user-1");
  });

  it("R8: estado inicial FIJO en_ruta_bodega_principal (no consulta fulfillment)", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row()], APIKEY);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_ruta_bodega_principal");
    expect(repo.findUsuarioFulfillment).not.toHaveBeenCalled(); // la via API no ramifica por fulfillment
    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("en_ruta_bodega_principal");
    }
    expect(conGuiaArg(repo)[0].estatusId).toBe("os-erbp");
  });
});

describe("cargarViaApi — resultado con num_guia (R10)", () => {
  it("happy path: summary con num_guia por creada + bloque plano ordenes", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" })],
      APIKEY,
    );

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(2);
      // Filas creadas extendidas con numGuia.
      expect(r.summary.filas[0]).toMatchObject({ resultado: "creada", numGuia: 1000, estatus: "en_ruta_bodega_principal" });
      expect(r.summary.filas[1]).toMatchObject({ resultado: "creada", numGuia: 1001 });
      // Bloque plano `ordenes` (R10): id + numGuia + estado + costoEnvio (feature 98/R5) por
      // creada. No-central con TARIFA por defecto -> 3.50 + 12% = "3.92".
      expect(r.summary.ordenes).toEqual([
        { id: "ord-REM-1", numRemision: "REM-1", numGuia: 1000, estado: "en_ruta_bodega_principal", costoEnvio: "3.92" },
        { id: "ord-REM-2", numRemision: "REM-2", numGuia: 1001, estado: "en_ruta_bodega_principal", costoEnvio: "3.92" },
      ]);
    }
  });
});

describe("cargarViaApi — validacion de valor heredada (R13, D3 override)", () => {
  it("monto_cobrar no numerico -> error de fila, no crea", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row({ monto_cobrar: "abc" })], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      expect(r.summary.filas[0].errores).toHaveProperty("monto_cobrar");
    }
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });

  it("monto_cobrar negativo -> error de fila", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row({ monto_cobrar: "-5" })], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("monto_cobrar");
    }
  });

  // D3 (override del humano): NO se endurece el monto. Vacio/null se HEREDA de la carga
  // masiva -> la orden se crea igual (no se agrega obligatoriedad).
  it("monto_cobrar vacio -> se crea igual (regla heredada, sin obligatoriedad)", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi([row({ monto_cobrar: "" })], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(0);
    }
    expect(conGuiaArg(repo)[0].montoCobrar).toBeNull();
  });
});

describe("cargarViaApi — dedup y exito parcial (R7/R11/R12)", () => {
  it("R11: remision existente en DB -> duplicada, sin consumir guia", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-1", "entregada"]])),
    });
    const r = await buildService(repo).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.duplicadas).toBe(1);
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.filas[0]).toMatchObject({ resultado: "duplicada" });
      expect(r.summary.filas[0].numGuia).toBeUndefined(); // duplicada no lleva guia
    }
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });

  it("R12: geo invalida en una fila no aborta el resto del lote", async () => {
    const repo = buildRepo();
    const r = await buildService(repo).cargarViaApi(
      [row({ num_remision: "REM-A" }), row({ num_remision: "REM-B", provincia: "Inexistente" })],
      APIKEY,
    );
    if (r.status === "ok") {
      expect(r.summary.total).toBe(2);
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(1);
      expect(r.summary.filas[1].errores).toHaveProperty("provincia");
    }
    // Solo la valida se persiste.
    expect(conGuiaArg(repo)).toHaveLength(1);
    expect(conGuiaArg(repo)[0].numRemision).toBe("REM-A");
  });
});

describe("cargarViaApi — guarda de seed de estado", () => {
  it("estatus inicial no disponible (seed pendiente) -> todas a error, sin persistir", async () => {
    const repo = buildRepo({ findEstatusIdByValue: vi.fn().mockResolvedValue(null) });
    const r = await buildService(repo).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.conError).toBe(1);
      expect(r.summary.filas[0].errores).toHaveProperty("estatus");
    }
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });
});

// Feature 98 (T7) — costoEnvio (FLETE + IVA del flete) por orden creada. Mapea R1/R2/R3/R4/
// R5/R6/R7/R8.
describe("cargarViaApi — costoEnvio flete + IVA (feature 98)", () => {
  // Distrito en zona CENTRAL, para forzar la columna valorFleteGam (R2).
  const distritoCentral = {
    findDistritosByCantonIds: vi
      .fn()
      .mockResolvedValue([
        { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1", esCentral: true },
      ]),
  };

  it("R1/R2/R7: creada en zona NO-central -> costoEnvio = valorFlete + IVA (3.50 + 12% = 3.92)", async () => {
    const repo = buildRepo(); // distrito por defecto esCentral:false
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.ordenes[0].costoEnvio).toBe("3.92");
    }
  });

  it("R2/R7: creada en zona CENTRAL -> costoEnvio = valorFleteGam + IVA (5.00 + 12% = 5.60)", async () => {
    const repo = buildRepo(distritoCentral);
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      expect(r.summary.ordenes[0].costoEnvio).toBe("5.60");
    }
  });

  it("R3: la tarifa del lote se resuelve UNA sola vez para N ordenes (sin N+1)", async () => {
    const repo = buildRepo();
    const tarifaRepo = buildTarifaRepo(TARIFA);
    const r = await buildService(repo, tarifaRepo).cargarViaApi(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" }), row({ num_remision: "REM-3" })],
      APIKEY,
    );
    if (r.status === "ok") expect(r.summary.creadas).toBe(3);
    expect(tarifaRepo.resolveTarifaPorTienda).toHaveBeenCalledTimes(1);
    // Resuelta por la tienda dueña (el usuario dedicado de la key, D4).
    expect(tarifaRepo.resolveTarifaPorTienda).toHaveBeenCalledWith("key-user-1");
  });

  it("R4/R6: filas duplicada y error NO llevan costoEnvio y conservan su shape", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-DUP", "entregada"]])),
    });
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi(
      [
        row({ num_remision: "REM-OK" }),
        row({ num_remision: "REM-DUP" }),
        row({ num_remision: "REM-ERR", provincia: "Inexistente" }),
      ],
      APIKEY,
    );
    if (r.status === "ok") {
      const dup = r.summary.filas.find((f) => f.resultado === "duplicada")!;
      const err = r.summary.filas.find((f) => f.resultado === "error")!;
      // Las filas NO tienen costoEnvio (vive solo en el bloque `ordenes`).
      expect(dup).not.toHaveProperty("costoEnvio");
      expect(err).not.toHaveProperty("costoEnvio");
      // Shape intacto: la duplicada expone `estatus`, la error expone `errores`.
      expect(dup).toMatchObject({ resultado: "duplicada", estatus: "entregada" });
      expect(err.errores).toHaveProperty("provincia");
      // Y `ordenes` (una por creada) sí lleva costoEnvio, solo para la creada.
      expect(r.summary.ordenes).toHaveLength(1);
      expect(r.summary.ordenes[0]).toMatchObject({ numRemision: "REM-OK", costoEnvio: "3.92" });
    }
  });

  it("R8/D1: tienda SIN tarifa (resolver -> null) -> todas las creadas con costoEnvio '0.00', ninguna a error", async () => {
    const repo = buildRepo();
    const r = await buildService(repo, buildTarifaRepo(null)).cargarViaApi(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" })],
      APIKEY,
    );
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(2);
      expect(r.summary.conError).toBe(0);
      expect(r.summary.ordenes.map((o) => o.costoEnvio)).toEqual(["0.00", "0.00"]);
    }
  });

  it("R7: costoEnvio es STRING escala 2 (money-safe, nunca number)", async () => {
    const repo = buildRepo();
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi([row()], APIKEY);
    if (r.status === "ok") {
      const c = r.summary.ordenes[0].costoEnvio;
      expect(typeof c).toBe("string");
      expect(c).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("R7: monto_cobrar (COD) y costoEnvio (flete) coexisten sin confundirse", async () => {
    const repo = buildRepo();
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi(
      [row({ monto_cobrar: "100.00" })],
      APIKEY,
    );
    if (r.status === "ok") {
      // costoEnvio es el flete + IVA (3.92), NO el COD (100.00).
      expect(r.summary.ordenes[0].costoEnvio).toBe("3.92");
    }
    // El COD sigue viajando al persistir, separado del costoEnvio.
    expect(conGuiaArg(repo)[0].montoCobrar).toBe(100);
  });
});

// Feature 98 (T12) — el contrato 88 sigue intacto: la UNICA extension observable es costoEnvio.
describe("cargarViaApi — no-regresión del contrato 88 (feature 98/R10)", () => {
  it("estado inicial fijo, num_guia inmediato y shape de `ordenes` = 88 + costoEnvio", async () => {
    const repo = buildRepo();
    const r = await buildService(repo, buildTarifaRepo(TARIFA)).cargarViaApi(
      [row({ num_remision: "REM-1" })],
      APIKEY,
    );
    // Estado inicial FIJO (no consulta fulfillment) y num_guia inmediato (via createManyOrdenesConGuia).
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_ruta_bodega_principal");
    expect(repo.findUsuarioFulfillment).not.toHaveBeenCalled();
    expect(repo.createManyOrdenesConGuia).toHaveBeenCalledTimes(1);
    if (r.status === "ok") {
      // El bloque `ordenes` es EXACTAMENTE el de la 88 (id/numRemision/numGuia/estado) + costoEnvio,
      // sin campos de mas: costoEnvio es la unica extension observable (R10).
      expect(r.summary.ordenes[0]).toEqual({
        id: "ord-REM-1",
        numRemision: "REM-1",
        numGuia: 1000,
        estado: "en_ruta_bodega_principal",
        costoEnvio: "3.92",
      });
    }
  });
});
