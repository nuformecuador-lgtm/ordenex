import { describe, it, expect, vi } from "vitest";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import type {
  GenerarGuiaDecisionData,
  IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_espera_aceptacion: "os-espera",
  en_bodega: "os-bodega",
};

function ordenRow(overrides: Partial<{
  id: string;
  estatusValue: string;
  numGuia: number | null;
  deletedAt: Date | null;
}> = {}) {
  return {
    id: "o1",
    estatusValue: "en_fulfillment",
    numGuia: null,
    deletedAt: null,
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
    findProvinciasByNombres: vi.fn(),
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
    ...overrides,
  } as unknown as IOrdenRepository;
}

describe("GuiaAsignacionService.generarGuia — autorizacion (R11-R13)", () => {
  it("R11: maestro puede generar guia", async () => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo);

    const r = await service.generarGuia({ decisiones: [{ ordenId: "o1", mensajeroId: null }] }, MAESTRO);

    expect(r.status).toBe("ok");
  });

  it("R12/R13: admin (solo-lectura) en escritura -> forbidden, sin tocar datos", async () => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo);

    const r = await service.generarGuia({ decisiones: [{ ordenId: "o1", mensajeroId: null }] }, ADMIN);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
  });

  it("R13: adminTienda/mensajero en escritura -> forbidden", async () => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m-sugerido" }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_espera_aceptacion" });
    expect(repo.generarGuiaLote).toHaveBeenCalledWith([
      { ordenId: "o1", estatusId: "os-espera", mensajeroAsignadoId: "m-sugerido" },
    ]);
  });

  it("R22: override a otro mensajero -> mensajero_asignado_id=elegido, en_espera_aceptacion", async () => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m-override" }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_espera_aceptacion" });
    expect(repo.generarGuiaLote).toHaveBeenCalledWith([
      { ordenId: "o1", estatusId: "os-espera", mensajeroAsignadoId: "m-override" },
    ]);
  });

  it("R23: sin mensajero -> mensajero_asignado_id NULL, en_bodega, con num_guia igual", async () => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_bodega" });
    expect(typeof r.resultados[0].numGuia).toBe("number");
    expect(repo.generarGuiaLote).toHaveBeenCalledWith([
      { ordenId: "o1", estatusId: "os-bodega", mensajeroAsignadoId: null },
    ]);
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
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

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
      findMensajeroIdsValidos: vi.fn(async () => new Set(["m-valido"])),
    });
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

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
    const service = new GuiaAsignacionService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toEqual([{ ordenId: "o1", estado: "en_espera_aceptacion" }]);
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(["o1"], "m1", "os-espera");
    // R5/R26: NUNCA toca num_guia; el metodo dedicado ni siquiera lo recibe como parametro.
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R27: origen distinto de en_bodega -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_fulfillment" }),
      ]),
    });
    const service = new GuiaAsignacionService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: expect.stringContaining("en_fulfillment") }]);
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("R28: mensajeroId sin rol mensajero -> validation_error (lote completo)", async () => {
    const repo = fakeRepo({ findMensajeroIdsValidos: vi.fn(async () => new Set<string>()) });
    const service = new GuiaAsignacionService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "no-msg" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.mensajeroId).toBeDefined();
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("forbidden fuera de maestro (R11-R13)", async () => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, ADMIN);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
  });
});
