import { describe, it, expect, vi } from "vitest";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { MSG_ORDEN_REPROGRAMADA_BLOQUEADA } from "@/lib/services/mensajes-bloqueo";
import type {
  GenerarGuiaDecisionData,
  IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };

// Feature 30: la zona GAM por defecto en los tests.
const GAM_ZONA_ID = "z-gam";
const NO_GAM_ZONA_ID = "z-limon";

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_espera_aceptacion: "os-espera",
  en_bodega: "os-bodega",
  en_ruta_bodega_satelite: "os-ruta-satelite", // feature 30
};

// Feature 30: por defecto la orden es GAM (zonaId === GAM_ZONA_ID) para que el
// camino GAM de la feature 17 (R18) siga verde sin tocar cada test.
function ordenRow(overrides: Partial<{
  id: string;
  estatusValue: string;
  numGuia: number | null;
  deletedAt: Date | null;
  zonaId: string;
  zonaEsGam: boolean;
  tiendaId: string;
}> = {}) {
  return {
    id: "o1",
    estatusValue: "en_fulfillment",
    numGuia: null,
    deletedAt: null,
    zonaId: GAM_ZONA_ID,
    zonaEsGam: true,
    tiendaId: "store-1",
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    // Metodos del CRUD (feature 6/15/16), no ejercitados aqui pero requeridos
    // por la interfaz; se dejan como stubs que fallarian si se invocan.
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    existsEstatus: vi.fn(),
    findEstatusIdByValue: vi.fn(async (value: string) => ESTATUS_ID_BY_VALUE[value] ?? null),
    findUsuarioFulfillment: vi.fn(),
    existsGeo: vi.fn(),
    findExistingRemisiones: vi.fn(),
    findAllProvincias: vi.fn(),
    findCantonesByProvinciaIds: vi.fn(),
    findDistritosByCantonIds: vi.fn(),
    findMensajerosByIds: vi.fn(),
    createManyOrdenes: vi.fn(),
    findResumenByNumRemisiones: vi.fn(),
    asignarMensajeroSugerido: vi.fn(),
    countOrdenesDeTienda: vi.fn(),
    // Feature 17
    findByIdsForTransicion: vi.fn(async () => [ordenRow()]),
    findMensajeroIdsValidos: vi.fn(async (ids: string[]): Promise<Set<string>> => new Set(ids)),
    findAllMensajeros: vi.fn(async () => []),
    listOrderStatus: vi.fn(async () => []),
    generarGuiaLote: vi.fn(async (decisiones: GenerarGuiaDecisionData[]) =>
      decisiones.map((d, idx) => ({ ordenId: d.ordenId, numGuia: idx + 1 })),
    ),
    asignarBodegaLote: vi.fn(async (ordenIds: string[]) => ordenIds.length),
    // Feature 30: por defecto todos los mensajeros pasados son GAM validos.
    findMensajerosByZona: vi.fn(async () => []),
    findMensajeroIdsValidosByZona: vi.fn(
      async (ids: string[]): Promise<Set<string>> => new Set(ids),
    ),
    rutearBodegaSateliteLote: vi.fn(async (ordenIds: string[]) => ordenIds.length),
    // Feature 41/R13: por defecto nadie bloqueado (los tests de bloqueo lo overridean).
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    ...overrides,
  } as unknown as IOrdenRepository;
}

// Feature 30: mock del IZonaRepository. Por defecto resuelve la zona GAM.
function fakeZonaRepo(overrides: Partial<IZonaRepository> = {}): IZonaRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    hardDelete: vi.fn(),
    arbol: vi.fn(),
    countExistingDistritos: vi.fn(),
    countExistingVehiculos: vi.fn(),
    // Feature 54: la zona central se resuelve por findCentralZonaId (antes findGamZonaId).
    findCentralZonaId: vi.fn(async () => GAM_ZONA_ID),
    ...overrides,
  } as unknown as IZonaRepository;
}

// Helper: construye el service con el nuevo constructor (repo, zonaRepo).
function newService(repo: IOrdenRepository, zonaRepo: IZonaRepository = fakeZonaRepo()) {
  return new GuiaAsignacionService(repo, zonaRepo);
}

describe("GuiaAsignacionService — bloqueo de mensajero (feature 41/R13/R23)", () => {
  it("R13: generarGuia hacia un mensajero bloqueado -> conflict, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1" })]),
      findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]): Promise<Set<string>> => new Set(ids)),
      // m-bloq esta bloqueado por un cierre pendiente.
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set(["m-bloq"])),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m-bloq" }] },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: "mensajero bloqueado por cierre pendiente" }]);
    }
    // R23: no se persiste nada (todo-o-nada).
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R13: el ruteo a satelite (ordenes SIN mensajero) NO se bloquea", async () => {
    const repo = fakeRepo({
      // orden no-GAM sin mensajero -> se rutea a satelite; no toca el bloqueo.
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set(["m-bloq"])),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(repo.generarGuiaLote).toHaveBeenCalled();
  });

  it("R13: asignarDesdeBodega hacia mensajero bloqueado -> conflict, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: "en_bodega" })]),
      findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]): Promise<Set<string>> => new Set(ids)),
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set(["m-bloq"])),
    });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m-bloq" }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: "mensajero bloqueado por cierre pendiente" }]);
    }
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });
});

describe("GuiaAsignacionService — bloqueo por reprogramacion (feature 46/R1/R2/R5)", () => {
  it("R2: generarGuia con una orden reprogramada en el lote -> conflict con motivo tipado, 0 escrituras", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment" }),
        ordenRow({ id: "o2", estatusValue: "reprogramada" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o1", mensajeroId: null },
          { ordenId: "o2", mensajeroId: null },
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o2", motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA }]);
    // R5/R2: aborta el lote completo sin persistir (todo-o-nada).
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R2: asignarDesdeBodega con una orden reprogramada -> conflict con motivo tipado, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "reprogramada" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA }]);
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });
});

describe("GuiaAsignacionService.generarGuia — autorizacion (R11-R13)", () => {
  it("R11: maestro puede generar guia", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.generarGuia({ decisiones: [{ ordenId: "o1", mensajeroId: null }] }, MAESTRO);

    expect(r.status).toBe("ok");
  });

  it("R12/R13: admin (solo-lectura) en escritura -> forbidden, sin tocar datos", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.generarGuia({ decisiones: [{ ordenId: "o1", mensajeroId: null }] }, ADMIN);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
  });

  it("R13: adminTienda/mensajero en escritura -> forbidden", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const rTienda = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      ADMIN_TIENDA,
    );
    const rMsg = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MENSAJERO,
    );

    expect(rTienda).toEqual({ status: "forbidden" });
    expect(rMsg).toEqual({ status: "forbidden" });
  });
});

describe("GuiaAsignacionService.generarGuia — origen y destino (R18/R19/R21/R22/R23)", () => {
  it("R18: acepta origen en_fulfillment Y en_preparacion", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment" }),
        ordenRow({ id: "o2", estatusValue: "en_preparacion" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o1", mensajeroId: null },
          { ordenId: "o2", mensajeroId: null },
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
  });

  it("R19: TODAS las ordenes del lote reciben num_guia, incluidas las que van a en_bodega", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment" }),
        ordenRow({ id: "o2", estatusValue: "en_preparacion" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o1", mensajeroId: "m1" }, // -> en_espera_aceptacion
          { ordenId: "o2", mensajeroId: null }, // -> en_bodega
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toHaveLength(2);
    for (const res of r.resultados) {
      expect(typeof res.numGuia).toBe("number");
    }
  });

  it("R21: confirmar mensajero sugerido -> mensajero_asignado_id=sugerido, en_espera_aceptacion", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m-sugerido" }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_espera_aceptacion" });
    expect(repo.generarGuiaLote).toHaveBeenCalledWith(
      [{ ordenId: "o1", estatusId: "os-espera", mensajeroAsignadoId: "m-sugerido" }],
      { actorUsuarioId: "u-maestro", origenTipo: "generacion_guia" },
    );
  });

  it("R22: override a otro mensajero -> mensajero_asignado_id=elegido, en_espera_aceptacion", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m-override" }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_espera_aceptacion" });
    expect(repo.generarGuiaLote).toHaveBeenCalledWith(
      [{ ordenId: "o1", estatusId: "os-espera", mensajeroAsignadoId: "m-override" }],
      { actorUsuarioId: "u-maestro", origenTipo: "generacion_guia" },
    );
  });

  it("R23: sin mensajero -> mensajero_asignado_id NULL, en_bodega, con num_guia igual", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_bodega" });
    expect(typeof r.resultados[0].numGuia).toBe("number");
    expect(repo.generarGuiaLote).toHaveBeenCalledWith(
      [{ ordenId: "o1", estatusId: "os-bodega", mensajeroAsignadoId: null }],
      { actorUsuarioId: "u-maestro", origenTipo: "generacion_guia" },
    );
  });
});

describe("GuiaAsignacionService.generarGuia — lote mixto en una sola llamada (R24)", () => {
  it("resuelve con-mensajero y sin-mensajero en UNA sola invocacion de generarGuiaLote", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment" }),
        ordenRow({ id: "o2", estatusValue: "en_preparacion" }),
        ordenRow({ id: "o3", estatusValue: "en_fulfillment" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o1", mensajeroId: "m1" },
          { ordenId: "o2", mensajeroId: null },
          { ordenId: "o3", mensajeroId: "m2" },
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1); // R24: una sola llamada
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toHaveLength(3);
  });
});

describe("GuiaAsignacionService.generarGuia — guardias de origen/mensajero (R27/R28/R25/R29)", () => {
  it("R27: estado de origen no permitido -> conflict.detalle, ABORTA sin llamar generarGuiaLote", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: "entregada" })]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: expect.stringContaining("entregada") }]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R28: mensajeroId sin rol mensajero en una decision -> conflict.detalle, ABORTA todo el lote", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment" }),
        ordenRow({ id: "o2", estatusValue: "en_fulfillment" }),
      ]),
      // Feature 30/R6: el service valida el mensajero contra la zona GAM.
      findMensajeroIdsValidosByZona: vi.fn(async () => new Set(["m-valido"])),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o1", mensajeroId: "m-valido" },
          { ordenId: "o2", mensajeroId: "m-invalido" },
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o2", motivo: expect.stringContaining("mensajeroId") }]);
    // R25/R29: ninguna orden se numera, ni siquiera o1 (que era valida).
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R29: orden inexistente en el lote -> fallo aislado sin transaccion a medias", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: "en_fulfillment" })]),
      // o2 no viene en la respuesta -> no existe
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o1", mensajeroId: null },
          { ordenId: "o2", mensajeroId: null },
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o2", motivo: "orden no existe" }]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R29: orden borrada (deletedAt) en el lote -> fallo aislado", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment" }),
        ordenRow({ id: "o2", estatusValue: "en_fulfillment", deletedAt: new Date() }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o1", mensajeroId: null },
          { ordenId: "o2", mensajeroId: null },
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o2", motivo: "orden borrada" }]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });
});

describe("GuiaAsignacionService.generarGuia — atomicidad (R25)", () => {
  it("propaga el fallo de la transaccion sin envolverlo (rollback total delegado a la DB)", async () => {
    const repo = fakeRepo({
      // Ambas ordenes validas (existen, no borradas, origen permitido) para que
      // la validacion previa pase y se llegue a invocar la transaccion.
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment" }),
        ordenRow({ id: "o2", estatusValue: "en_preparacion" }),
      ]),
      generarGuiaLote: vi.fn().mockRejectedValue(new Error("fallo de conexion a mitad del lote")),
    });
    const service = newService(repo);

    await expect(
      service.generarGuia(
        {
          decisiones: [
            { ordenId: "o1", mensajeroId: null },
            { ordenId: "o2", mensajeroId: null },
          ],
        },
        MAESTRO,
      ),
    ).rejects.toThrow("fallo de conexion a mitad del lote");
  });
});

describe("GuiaAsignacionService.generarGuia — num_guia unico e incremental entre llamadas (R4)", () => {
  it("dos invocaciones consecutivas devuelven valores de guia distintos y crecientes", async () => {
    let seq = 100;
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1" })]),
      generarGuiaLote: vi.fn(async (decisiones: GenerarGuiaDecisionData[]) =>
        decisiones.map((d) => ({ ordenId: d.ordenId, numGuia: ++seq })),
      ),
    });
    const service = newService(repo);

    const r1 = await service.generarGuia({ decisiones: [{ ordenId: "o1", mensajeroId: null }] }, MAESTRO);
    const r2 = await service.generarGuia({ decisiones: [{ ordenId: "o1", mensajeroId: null }] }, MAESTRO);

    if (r1.status !== "ok" || r2.status !== "ok") throw new Error("unreachable");
    expect(r1.resultados[0].numGuia).toBe(101);
    expect(r2.resultados[0].numGuia).toBe(102);
    expect(r2.resultados[0].numGuia).toBeGreaterThan(r1.resultados[0].numGuia);
  });
});

describe("GuiaAsignacionService.generarGuia — validation_error si falta el seed de estados", () => {
  it("catalogo incompleto -> validation_error sin llamar generarGuiaLote", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("validation_error");
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });
});

describe("GuiaAsignacionService.asignarDesdeBodega (R26-R29)", () => {
  it("R26: en_bodega + mensajero -> en_espera_aceptacion, sin reasignar guia", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega", numGuia: 55 }),
      ]),
    });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toEqual([{ ordenId: "o1", estado: "en_espera_aceptacion" }]);
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(["o1"], "m1", "os-espera", {
      actorUsuarioId: "u-maestro",
      origenTipo: "asignacion_bodega",
    });
    // R5/R26: NUNCA toca num_guia; el metodo dedicado ni siquiera lo recibe como parametro.
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R27: origen distinto de en_bodega -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: expect.stringContaining("en_fulfillment") }]);
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("R28: mensajeroId sin rol mensajero -> validation_error (lote completo)", async () => {
    // Feature 30/R6: la validacion del mensajero es contra la zona GAM.
    const repo = fakeRepo({ findMensajeroIdsValidosByZona: vi.fn(async () => new Set<string>()) });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "no-msg" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.mensajeroId).toBeDefined();
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("forbidden fuera de maestro (R11-R13)", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, ADMIN);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
  });
});

// =====================  Feature 30  =====================

describe("Feature 30 — guardia zona GAM no configurada (R4)", () => {
  it("R4: generarGuia sin zona GAM -> validation_error 'zona GAM no configurada', sin efectos", async () => {
    const repo = fakeRepo();
    const service = newService(repo, fakeZonaRepo({ findCentralZonaId: vi.fn(async () => null) }));

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.zona).toEqual(["zona GAM no configurada"]);
    // Sin efectos: no se cargan ordenes ni se persiste nada.
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R4: asignarDesdeBodega sin zona GAM -> validation_error, sin efectos", async () => {
    const repo = fakeRepo();
    const service = newService(repo, fakeZonaRepo({ findCentralZonaId: vi.fn(async () => null) }));

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("R4: rutearABodegaSatelite sin zona GAM -> validation_error, sin efectos", async () => {
    const repo = fakeRepo();
    const service = newService(repo, fakeZonaRepo({ findCentralZonaId: vi.fn(async () => null) }));

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(repo.rutearBodegaSateliteLote).not.toHaveBeenCalled();
  });
});

describe("Feature 30 — generarGuia clasifica GAM/no-GAM (R6/R8/R9/R11)", () => {
  it("R6: mensajero de otra zona (no GAM) en orden GAM -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment", zonaId: GAM_ZONA_ID }),
      ]),
      // El mensajero pasado NO es GAM: findMensajeroIdsValidosByZona lo excluye.
      findMensajeroIdsValidosByZona: vi.fn(async () => new Set<string>()),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m-otra-zona" }] },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: expect.stringContaining("mensajeroId") }]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R8: orden no-GAM con mensajeroId != null -> rechazo por orden, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m1" }] },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: expect.stringContaining("no-GAM") }]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R9/R10: orden no-GAM (sin mensajero) -> en_ruta_bodega_satelite, mensajeroAsignadoId NULL, con num_guia", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_ruta_bodega_satelite" });
    expect(typeof r.resultados[0].numGuia).toBe("number");
    // R9/R10: se rutea con estatus satelite y mensajeroAsignadoId NULL (num_guia via lote).
    expect(repo.generarGuiaLote).toHaveBeenCalledWith(
      [{ ordenId: "o1", estatusId: "os-ruta-satelite", mensajeroAsignadoId: null }],
      { actorUsuarioId: "u-maestro", origenTipo: "generacion_guia" },
    );
  });

  it("R11: lote mixto GAM/no-GAM se resuelve en UNA sola llamada (GAM regla 17, no-GAM a satelite)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o-gam-msg", estatusValue: "en_fulfillment", zonaId: GAM_ZONA_ID }),
        ordenRow({ id: "o-gam-sin", estatusValue: "en_preparacion", zonaId: GAM_ZONA_ID }),
        ordenRow({ id: "o-nogam", estatusValue: "en_fulfillment", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o-gam-msg", mensajeroId: "m1" }, // GAM + mensajero -> espera
          { ordenId: "o-gam-sin", mensajeroId: null }, // GAM sin mensajero -> bodega
          { ordenId: "o-nogam", mensajeroId: null }, // no-GAM -> satelite
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1); // R11: una sola transaccion
    expect(repo.generarGuiaLote).toHaveBeenCalledWith(
      [
        { ordenId: "o-gam-msg", estatusId: "os-espera", mensajeroAsignadoId: "m1" },
        { ordenId: "o-gam-sin", estatusId: "os-bodega", mensajeroAsignadoId: null },
        { ordenId: "o-nogam", estatusId: "os-ruta-satelite", mensajeroAsignadoId: null },
      ],
      { actorUsuarioId: "u-maestro", origenTipo: "generacion_guia" },
    );
    const estados = r.resultados.map((x) => x.estado);
    expect(estados).toEqual(["en_espera_aceptacion", "en_bodega", "en_ruta_bodega_satelite"]);
  });

  it("R11/R17: lote mixto con una orden invalida -> conflict todo-o-nada (ni GAM ni no-GAM se tocan)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o-gam", estatusValue: "en_fulfillment", zonaId: GAM_ZONA_ID }),
        ordenRow({ id: "o-nogam", estatusValue: "entregada", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o-gam", mensajeroId: "m1" },
          { ordenId: "o-nogam", mensajeroId: null }, // origen invalido
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });
});

describe("Feature 30 — asignarDesdeBodega rechaza no-GAM (R12)", () => {
  it("R12: orden no-GAM en el lote (origen en_bodega) -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega", numGuia: 10, zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: expect.stringContaining("no-GAM") }]);
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });
});

describe("Feature 30 — rutearABodegaSatelite (R13/R16/R17)", () => {
  it("R13: rutea N ordenes no-GAM desde origen permitido -> en_ruta_bodega_satelite", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
        ordenRow({ id: "o2", estatusValue: "en_preparacion", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
        ordenRow({ id: "o3", estatusValue: "en_fulfillment", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1", "o2", "o3"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toEqual([
      { ordenId: "o1", estado: "en_ruta_bodega_satelite" },
      { ordenId: "o2", estado: "en_ruta_bodega_satelite" },
      { ordenId: "o3", estado: "en_ruta_bodega_satelite" },
    ]);
    expect(repo.rutearBodegaSateliteLote).toHaveBeenCalledWith(
      ["o1", "o2", "o3"],
      "os-ruta-satelite",
      { actorUsuarioId: "u-maestro", origenTipo: "ruteo_satelite" },
    );
  });

  it("una orden GAM en el lote -> conflict 'orden GAM no se rutea a satelite', sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
        ordenRow({ id: "o2", estatusValue: "en_bodega", zonaId: GAM_ZONA_ID }),
      ]),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o2", motivo: expect.stringContaining("GAM") }]);
    expect(repo.rutearBodegaSateliteLote).not.toHaveBeenCalled();
  });

  it("R17: origen invalido / orden borrada -> conflict sin transaccion a medias", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "entregada", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
        ordenRow({ id: "o2", estatusValue: "en_bodega", deletedAt: new Date(), zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: "o1", motivo: expect.stringContaining("entregada") },
      { ordenId: "o2", motivo: "orden borrada" },
    ]);
    expect(repo.rutearBodegaSateliteLote).not.toHaveBeenCalled();
  });

  it("R16: autorizacion — admin/adminTienda/mensajero -> forbidden, sin tocar datos", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    for (const actor of [ADMIN, ADMIN_TIENDA, MENSAJERO]) {
      const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, actor);
      expect(r).toEqual({ status: "forbidden" });
    }
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
  });
});

describe("Feature 30 — no-regresion camino GAM feature 17 (R18)", () => {
  it("R18: orden GAM con mensajero GAM -> en_espera_aceptacion (regla 17 intacta)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment", zonaId: GAM_ZONA_ID }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m1" }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_espera_aceptacion" });
  });

  it("R18: orden GAM sin mensajero -> en_bodega (regla 17 intacta)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment", zonaId: GAM_ZONA_ID }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_bodega" });
  });
});
