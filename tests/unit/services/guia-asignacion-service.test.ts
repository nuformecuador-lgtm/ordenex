import { describe, it, expect, vi } from "vitest";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { MSG_ORDEN_REPROGRAMADA_BLOQUEADA } from "@/lib/services/mensajes-bloqueo";
import type {
  GenerarGuiaDecisionData,
  IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };

// Feature 30: la zona GAM por defecto en los tests.
const GAM_ZONA_ID = "z-gam";
const NO_GAM_ZONA_ID = "z-limon";

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  por_recoger: "os-espera",
  en_bodega_central: "os-bodega",
  en_ruta_bodega_satelite: "os-ruta-satelite", // feature 30
};

// Feature 30: por defecto la orden es GAM (zonaId === GAM_ZONA_ID).
// Feature 156: el estatus por defecto pasa a `en_preparacion`, que es el UNICO origen valido
// de "generar guia" tras esta feature (R4).
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
    estatusValue: "en_preparacion",
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
    createManyOrdenes: vi.fn(),
    // Feature 17
    findByIdsForTransicion: vi.fn(async () => [ordenRow()]),
    // Feature 92 (R8): filas que consume el gate de coordenadas (ya geocodificadas).
    findParaAsignabilidad: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, direccion: "x", latitud: 9.9, longitud: -84.1, geocodeStatus: "OK" })),
    ),
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

/**
 * Feature 92 (R8): el gate de asignabilidad es una dep REQUERIDA del service. Estos tests
 * no lo ejercitan (eso vive en `guia-asignacion-gate-coordenadas.test.ts`), asi que se
 * inyecta un doble que declara TODA orden asignable — que es el estado real de una orden ya
 * geocodificada. Es el escenario feliz, no un aflojamiento: el gate tiene su test propio.
 */
function gateTodoAsignable(): IAsignabilidadCoordenadasService {
  return {
    evaluar: async (ordenes: OrdenAsignabilidadRow[]) =>
      new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, "asignable"])),
  };
}

// Helper: construye el service (repo, zonaRepo, gate de coordenadas).
function newService(
  repo: IOrdenRepository,
  zonaRepo: IZonaRepository = fakeZonaRepo(),
  gate: IAsignabilidadCoordenadasService = gateTodoAsignable(),
) {
  return new GuiaAsignacionService(repo, zonaRepo, gate);
}

/** Atajo: las decisiones con las que el service llamo a `generarGuiaLote`. */
function decisionesPersistidas(repo: IOrdenRepository): GenerarGuiaDecisionData[] {
  const mock = vi.mocked(repo.generarGuiaLote);
  return mock.mock.calls[0]![0] as GenerarGuiaDecisionData[];
}

// =====================  Feature 156 — generarGuia v2  =====================
//
// "Generar guia" tiene UN SOLO efecto: numerar y mover a la bodega central. Ningun test de
// este bloque menciona mensajero, porque la operacion ya no lo decide.

describe("156 — generarGuia numera y mueve a en_bodega_central (R1/R3/R8)", () => {
  it("R1/R3: un lote en en_preparacion queda numerado y en en_bodega_central", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toEqual([
      { ordenId: "o1", numGuia: 1, estado: "en_bodega_central" },
      { ordenId: "o2", numGuia: 2, estado: "en_bodega_central" },
    ]);
    expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1);
  });

  it("R3: en_bodega_central es el UNICO destino; nadie termina en por_recoger ni en satelite", async () => {
    // Se mezclan zona central y zona satelite a proposito: antes de la 156 la de zona no-GAM
    // habria acabado en `en_ruta_bodega_satelite`. Ahora las dos van al mismo sitio.
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o-gam", zonaId: GAM_ZONA_ID }),
        ordenRow({ id: "o-satelite", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o-gam", "o-satelite"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados.map((x) => x.estado)).toEqual([
      "en_bodega_central",
      "en_bodega_central",
    ]);
    expect(decisionesPersistidas(repo).map((d) => d.estatusId)).toEqual([
      "os-bodega",
      "os-bodega",
    ]);
    // Ni siquiera resuelve los otros dos estados del catalogo: ya no son destinos posibles.
    expect(repo.findEstatusIdByValue).toHaveBeenCalledTimes(1);
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_bodega_central");
  });

  it("R8: registra el lote con origenTipo generacion_guia y el actor que lo ejecuto", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    await service.generarGuia({ ordenIds: ["o1"] }, ADMIN);

    expect(repo.generarGuiaLote).toHaveBeenCalledWith(
      [{ ordenId: "o1", estatusId: "os-bodega", mensajeroAsignadoId: null }],
      { actorUsuarioId: "u-admin", origenTipo: "generacion_guia" },
    );
  });

  it("un lote vacio es ok sin efectos (ni lecturas ni escrituras)", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: [] }, MAESTRO);

    expect(r).toEqual({ status: "ok", resultados: [] });
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("ids repetidos en la entrada se numeran una sola vez", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1", "o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(decisionesPersistidas(repo)).toHaveLength(1);
  });
});

describe("156/R2 — generarGuia NO escribe mensajero_asignado_id ni asignado_at", () => {
  it("toda decision persistida lleva mensajeroAsignadoId null", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
        ordenRow({ id: "o3", numGuia: 77 }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1", "o2", "o3"] }, MAESTRO);

    expect(r.status).toBe("ok");
    const decisiones = decisionesPersistidas(repo);
    expect(decisiones).toHaveLength(3);
    for (const d of decisiones) expect(d.mensajeroAsignadoId).toBeNull();
    // `asignado_at` se estampa en el repo SOLO cuando el mensajero no es nulo
    // (`OrdenRepository.generarGuiaLote`); con null constante nunca se toca.
  });

  it("no consulta mensajeros por zona ni mensajeros bloqueados: no hay a quien asignar", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    expect(repo.findMensajeroIdsValidosByZona).not.toHaveBeenCalled();
    expect(repo.findMensajerosBloqueados).not.toHaveBeenCalled();
  });
});

describe("156/R4 — origen UNICO en_preparacion", () => {
  // Feature 155: el estado de fulfillment ya no figura en esta lista porque salio del
  // CATALOGO; su sitio lo ocupa `por_recolectar_en_tienda`, el otro estado de creacion, que
  // tampoco es origen valido de "generar guia" (el paquete todavia esta en la tienda).
  it.each([
    ["por_recolectar_en_tienda"],
    ["en_bodega_central"],
    ["por_recoger"],
    ["entregada"],
  ])("origen %s -> conflict con el motivo tipado, sin numerar nada", async (estatusValue) => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue })]),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: "o1", motivo: `estado de origen no permitido: ${estatusValue}` },
    ]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });
});

describe("156/R5 — num_guia idempotente", () => {
  it("una orden que ya tiene num_guia conserva el mismo valor y lo devuelve", async () => {
    const YA_NUMERADA = 4321;
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", numGuia: YA_NUMERADA }),
        ordenRow({ id: "o2", numGuia: null }),
      ]),
      // El repo respeta `WHERE num_guia IS NULL`: la ya numerada devuelve SU numero,
      // la otra estrena uno (cobertura del SQL: `orden-repository.guia.test.ts`).
      generarGuiaLote: vi.fn(async (decisiones: GenerarGuiaDecisionData[]) =>
        decisiones.map((d) => ({
          ordenId: d.ordenId,
          numGuia: d.ordenId === "o1" ? YA_NUMERADA : 9001,
        })),
      ),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toEqual([
      { ordenId: "o1", numGuia: YA_NUMERADA, estado: "en_bodega_central" },
      { ordenId: "o2", numGuia: 9001, estado: "en_bodega_central" },
    ]);
  });

  it("dos invocaciones consecutivas devuelven guias distintas y crecientes", async () => {
    let seq = 100;
    const repo = fakeRepo({
      generarGuiaLote: vi.fn(async (decisiones: GenerarGuiaDecisionData[]) =>
        decisiones.map((d) => ({ ordenId: d.ordenId, numGuia: ++seq })),
      ),
    });
    const service = newService(repo);

    const r1 = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);
    const r2 = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    if (r1.status !== "ok" || r2.status !== "ok") throw new Error("unreachable");
    expect(r1.resultados[0].numGuia).toBe(101);
    expect(r2.resultados[0].numGuia).toBe(102);
    expect(r2.resultados[0].numGuia).toBeGreaterThan(r1.resultados[0].numGuia);
  });
});

describe("156/R6 — todo-o-nada por lote", () => {
  it("una sola orden con origen invalido aborta el lote entero, sin numerar ninguna", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2" }),
        ordenRow({ id: "o3", estatusValue: "entregada" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1", "o2", "o3"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: "o3", motivo: "estado de origen no permitido: entregada" },
    ]);
    // Ni o1 ni o2 se tocan aunque fueran validas.
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("propaga el fallo de la transaccion sin envolverlo (rollback total delegado a la DB)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1" }), ordenRow({ id: "o2" })]),
      generarGuiaLote: vi.fn().mockRejectedValue(new Error("fallo de conexion a mitad del lote")),
    });
    const service = newService(repo);

    await expect(service.generarGuia({ ordenIds: ["o1", "o2"] }, MAESTRO)).rejects.toThrow(
      "fallo de conexion a mitad del lote",
    );
  });
});

describe("156/R7 — orden inexistente, borrada o reprogramada", () => {
  it("orden inexistente -> conflict con motivo por orden, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1" })]),
      // o2 no viene en la respuesta -> no existe
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o2", motivo: "orden no existe" }]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("orden borrada (deletedAt) -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2", deletedAt: new Date() }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o2", motivo: "orden borrada" }]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  // Feature 46/R2: la reprogramada tiene motivo propio, ANTES del de origen invalido.
  it("orden reprogramada -> conflict con el motivo tipado de reprogramacion", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2", estatusValue: "reprogramada" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o2", motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA }]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });
});

describe("156/R9 — autorizacion de generar guia", () => {
  it("maestro puede generar guia", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
  });

  it("feature 94: admin tiene paridad con maestro y puede generar guia", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1"] }, ADMIN);

    expect(r.status).toBe("ok");
  });

  it("adminTienda/mensajero -> forbidden sin tocar datos", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    for (const actor of [ADMIN_TIENDA, MENSAJERO]) {
      const r = await service.generarGuia({ ordenIds: ["o1"] }, actor);
      expect(r).toEqual({ status: "forbidden" });
    }
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 156 — GUARDAS QUE DEJAN DE APLICAR AL NUMERAR (R10-R13).
//
// Los cuatro casos de abajo son los MISMOS escenarios que antes producian `conflict` o
// `validation_error` en `generarGuia`. Ahora terminan en `ok` y con `generarGuiaLote` llamado:
// son guardas de la ASIGNACION, y numerar ya no asigna. Cada una de las cuatro se conserva
// INTACTA en el metodo que si asigna o si rutea (ver los describes de no-regresion mas abajo).
// ---------------------------------------------------------------------------------------------
describe("156 — guardas retiradas de generar guia (R10/R11/R12/R13)", () => {
  const MENSAJEROS_ZONA = [
    { id: "m-lim1", nombre: "Ana" },
    { id: "m-lim2", nombre: "Beto" },
  ];

  it("R10: con TODOS los mensajeros en cierre abierto, generar guia sigue funcionando", async () => {
    const repo = fakeRepo({
      findMensajerosByZona: vi.fn(async () => MENSAJEROS_ZONA),
      findMensajerosBloqueados: vi.fn(
        async (): Promise<Set<string>> => new Set(["m-lim1", "m-lim2"]),
      ),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1);
  });

  it("R11: una orden de zona satelite con un cierre abierto se numera igual", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosByZona: vi.fn(async () => MENSAJEROS_ZONA),
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set(["m-lim1"])),
    });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    // Ni conflict por bodega bloqueada ni ruteo: va a la bodega central como todas.
    expect(r.resultados[0]).toMatchObject({ estado: "en_bodega_central" });
    expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1);
  });

  it.each([
    "direccion_no_geocodificable",
    "geocodificacion_agotada",
    "geocodificacion_en_curso",
    "geocodificacion_encolada",
    "geocodificacion_no_encolable",
  ] as EstadoAsignabilidad[])(
    "R12: una orden en estado %s se numera igual (el gate de coordenadas no participa)",
    async (estado) => {
      const gateQueRechaza: IAsignabilidadCoordenadasService = {
        evaluar: vi.fn(async (ordenes: OrdenAsignabilidadRow[]) =>
          new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, estado])),
        ),
      };
      const repo = fakeRepo();
      const service = newService(repo, fakeZonaRepo(), gateQueRechaza);

      const r = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

      expect(r.status).toBe("ok");
      expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1);
      // Ni siquiera se consulta: no hay a quien asignar, no hay coordenadas que exigir.
      expect(gateQueRechaza.evaluar).not.toHaveBeenCalled();
      expect(repo.findParaAsignabilidad).not.toHaveBeenCalled();
    },
  );

  it("R13: sin zona GAM configurada, generar guia funciona con normalidad", async () => {
    const repo = fakeRepo();
    const zonaRepo = fakeZonaRepo({ findCentralZonaId: vi.fn(async () => null) });
    const service = newService(repo, zonaRepo);

    const r = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1);
    // La clasificacion GAM/no-GAM ya no participa: ni se consulta la zona central.
    expect(zonaRepo.findCentralZonaId).not.toHaveBeenCalled();
  });
});

describe("GuiaAsignacionService.generarGuia — validation_error si falta el seed de estados", () => {
  it("catalogo incompleto -> validation_error sin llamar generarGuiaLote", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const service = newService(repo);

    const r = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.estatus).toEqual(["catalogo de estados incompleto (seed pendiente)"]);
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });
});

// =====================  No-regresion: asignarDesdeBodega (156/R17)  =====================
//
// Cero cambios de codigo en este metodo. Estos tests son la prueba de que las guardas que
// `generarGuia` dejo de aplicar SIGUEN vivas donde si se asigna un mensajero.

describe("GuiaAsignacionService — bloqueo de mensajero (feature 41/R13/R23)", () => {
  it("R13: asignarDesdeBodega hacia mensajero bloqueado -> conflict, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: "en_bodega_central" })]),
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

describe("GuiaAsignacionService.asignarDesdeBodega (R26-R29)", () => {
  it("R26: en_bodega_central + mensajero -> por_recoger, sin reasignar guia", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", numGuia: 55 }),
      ]),
    });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toEqual([{ ordenId: "o1", estado: "por_recoger" }]);
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(["o1"], "m1", "os-espera", {
      actorUsuarioId: "u-maestro",
      origenTipo: "asignacion_bodega",
    });
    // R5/R26: NUNCA toca num_guia; el metodo dedicado ni siquiera lo recibe como parametro.
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("R27: origen distinto de en_bodega_central -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_preparacion" }),
      ]),
    });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: expect.stringContaining("en_preparacion") }]);
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

  it("feature 94: admin tiene paridad con maestro en asignarDesdeBodega", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", numGuia: 55 }),
      ]),
    });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, ADMIN);

    expect(r.status).toBe("ok");
    expect(repo.asignarBodegaLote).toHaveBeenCalled();
  });

  it("forbidden fuera de acceso total: adminTienda/mensajero -> forbidden", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    for (const actor of [ADMIN_TIENDA, MENSAJERO]) {
      const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, actor);
      expect(r).toEqual({ status: "forbidden" });
    }
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
  });
});

// =====================  Feature 30  =====================

describe("Feature 30 — guardia zona GAM no configurada (R4)", () => {
  // Feature 156/R13: `generarGuia` ya NO tiene esta guarda (no clasifica GAM/no-GAM);
  // su caso vive arriba, en "guardas retiradas". Los dos metodos que si clasifican la
  // conservan INTACTA.
  it("R4: asignarDesdeBodega sin zona GAM -> validation_error, sin efectos", async () => {
    const repo = fakeRepo();
    const service = newService(repo, fakeZonaRepo({ findCentralZonaId: vi.fn(async () => null) }));

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.zona).toEqual(["zona GAM no configurada"]);
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("R4: rutearABodegaSatelite sin zona GAM -> validation_error, sin efectos", async () => {
    const repo = fakeRepo();
    const service = newService(repo, fakeZonaRepo({ findCentralZonaId: vi.fn(async () => null) }));

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.zona).toEqual(["zona GAM no configurada"]);
    expect(repo.rutearBodegaSateliteLote).not.toHaveBeenCalled();
  });
});

describe("Feature 30 — asignarDesdeBodega rechaza no-GAM (R12)", () => {
  it("R12: orden no-GAM en el lote (origen en_bodega_central) -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", numGuia: 10, zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
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

describe("Feature 30 + 156 — rutearABodegaSatelite (R13/R16/R17 · 156/R15/R16)", () => {
  it("156/R15: rutea N ordenes no-GAM desde en_bodega_central -> en_ruta_bodega_satelite", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toEqual([
      { ordenId: "o1", estado: "en_ruta_bodega_satelite" },
      { ordenId: "o2", estado: "en_ruta_bodega_satelite" },
    ]);
    expect(repo.rutearBodegaSateliteLote).toHaveBeenCalledWith(
      ["o1", "o2"],
      "os-ruta-satelite",
      { actorUsuarioId: "u-maestro", origenTipo: "ruteo_satelite" },
    );
  });

  // Feature 156/R16: los origenes que la feature retira (`ORIGEN_RUTEO_SATELITE` pasa de un
  // Set de tres a la constante `en_bodega_central`). Feature 155: el tercero de aquel Set salio
  // del catalogo, asi que su lugar lo toma el otro estado de creacion vigente.
  it.each([["en_preparacion"], ["por_recolectar_en_tienda"]])(
    "156/R16: origen %s -> conflict 'estado de origen no permitido', sin efectos",
    async (estatusValue) => {
      const repo = fakeRepo({
        findByIdsForTransicion: vi.fn(async () => [
          ordenRow({ id: "o1", estatusValue, zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
        ]),
      });
      const service = newService(repo);

      const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

      expect(r.status).toBe("conflict");
      if (r.status !== "conflict") throw new Error("unreachable");
      expect(r.detalle).toEqual([
        { ordenId: "o1", motivo: `estado de origen no permitido: ${estatusValue}` },
      ]);
      expect(repo.rutearBodegaSateliteLote).not.toHaveBeenCalled();
    },
  );

  it("156/R6: una orden en en_preparacion aborta el lote entero (las de bodega tampoco se rutean)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
        ordenRow({ id: "o2", estatusValue: "en_preparacion", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: "o2", motivo: "estado de origen no permitido: en_preparacion" },
    ]);
    expect(repo.rutearBodegaSateliteLote).not.toHaveBeenCalled();
  });

  it("una orden GAM en el lote -> conflict 'orden GAM no se rutea a satelite', sin efectos", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central", zonaId: GAM_ZONA_ID }),
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
        ordenRow({ id: "o2", estatusValue: "en_bodega_central", deletedAt: new Date(), zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
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

  it("R16: autorizacion — adminTienda/mensajero -> forbidden, sin tocar datos", async () => {
    const repo = fakeRepo();
    const service = newService(repo);

    for (const actor of [ADMIN_TIENDA, MENSAJERO]) {
      const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, actor);
      expect(r).toEqual({ status: "forbidden" });
    }
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
  });

  it("feature 94: admin tiene paridad con maestro y rutea a bodega satelite", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, ADMIN);

    expect(r.status).toBe("ok");
    expect(repo.rutearBodegaSateliteLote).toHaveBeenCalled();
  });
});

// Decision del humano 2026-07-16: la regla se unifica a >=1 (antes "TODOS"): basta un
// mensajero con cierre abierto para que la bodega destino no reciba ordenes nuevas.
// Feature 156: los casos de `generarGuia` de este bloque se mudaron a "guardas retiradas"
// (R11) — numerar ya no rutea a ninguna bodega satelite. El de `rutearABodegaSatelite`, que es
// quien de verdad envia el paquete, se conserva INTACTO.
describe("Ajuste maestro — no rutear a bodega satelite con >=1 mensajero en cierre", () => {
  const MENSAJEROS_LIMON = [
    { id: "m-lim1", nombre: "Ana" },
    { id: "m-lim2", nombre: "Beto" },
  ];

  it("rutearABodegaSatelite: zona destino con TODOS los mensajeros en cierre -> conflict, sin persistir", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosByZona: vi.fn(async () => MENSAJEROS_LIMON),
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set(["m-lim1", "m-lim2"])),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: "o1", motivo: expect.stringContaining("bodega satelite bloqueada") },
    ]);
    expect(repo.rutearBodegaSateliteLote).not.toHaveBeenCalled();
    expect(repo.findMensajerosByZona).toHaveBeenCalledWith(NO_GAM_ZONA_ID);
  });

  it("rutearABodegaSatelite: 1 solo mensajero de la zona destino en cierre -> conflict", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosByZona: vi.fn(async () => MENSAJEROS_LIMON),
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set(["m-lim1"])),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("conflict");
    expect(repo.rutearBodegaSateliteLote).not.toHaveBeenCalled();
  });

  it("rutearABodegaSatelite: NINGUN mensajero de la zona destino en cierre -> rutea normal (ok)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosByZona: vi.fn(async () => MENSAJEROS_LIMON),
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.rutearBodegaSateliteLote).toHaveBeenCalledTimes(1);
  });

  it("rutearABodegaSatelite: zona destino SIN mensajeros -> no bloquea (rutea ok)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosByZona: vi.fn(async () => []), // sin mensajeros: no hay cierre que resolver
      findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
  });
});
