import { describe, it, expect, vi } from "vitest";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import {
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  MSG_ORDEN_REPROGRAMADA_BLOQUEADA,
} from "@/lib/services/mensajes-bloqueo";
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
  recolectando: "os-recolectando", // feature 157 (ampliacion): destino de la asignacion
  por_recolectar_en_tienda: "os-por-recolectar", // destino de su reversion
};

// Feature 30: por defecto la orden es GAM (zonaId === GAM_ZONA_ID).
// Feature 156: el estatus por defecto pasa a `en_preparacion`, que es el UNICO origen valido
// de "generar guia" tras esta feature (R4).
// Feature 262 (B3): `fechaReparto` entra en la fila de transicion y es OBLIGATORIO —sin `?`—
// porque es insumo de una guarda de la correccion del dia (R5/R7). El default es `null`, que es lo
// que tienen las ordenes de estos casos (aun sin asignar), y ninguna asercion de este archivo
// cambia por ello.
function ordenRow(overrides: Partial<{
  id: string;
  estatusValue: string;
  numGuia: number | null;
  deletedAt: Date | null;
  zonaId: string;
  zonaEsGam: boolean;
  tiendaId: string;
  fechaReparto: Date | null;
}> = {}) {
  return {
    id: "o1",
    estatusValue: "en_preparacion",
    numGuia: null,
    deletedAt: null,
    zonaId: GAM_ZONA_ID,
    zonaEsGam: true,
    tiendaId: "store-1",
    fechaReparto: null,
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
    // Feature 157: la asignacion de recoleccion escribe SOLO el mensajero (sin transicion).
    asignarRecoleccionLote: vi.fn(async (ordenIds: string[]) => ordenIds.length),
    desasignarRecoleccionLote: vi.fn(async (ordenIds: string[]) => ordenIds.length),
    // Feature 157 (regla de dedicacion): por defecto NADIE esta ocupado; los casos de la
    // regla lo overridean para simular reparto o recoleccion pendiente.
    findMensajerosConOrdenesEn: vi.fn(async (): Promise<Set<string>> => new Set()),
    // Feature 41/R13: por defecto nadie bloqueado (los tests de bloqueo lo overridean).
    findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set()),
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
  return new GuiaAsignacionService(repo, zonaRepo, gate, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);
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
    expect(repo.findMensajerosBloqueadosPorCierres).not.toHaveBeenCalled();
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
      findMensajerosBloqueadosPorCierres: vi.fn(
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
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set(["m-lim1"])),
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

// Pedido humano 2026-08-18 — R13 RETIRADA. Este bloque afirmaba que asignar desde bodega a un
// mensajero con cierre abierto daba `conflict`. Se invierte: la asignacion pasa.
//
// FEATURE 241 (2026-08-20) — SE QUEDA ASI, y ahora por una regla firmada en vez de por un tope
// inalcanzable. Recibir asignaciones NO SE BLOQUEA NUNCA, sea cual sea el estado del cierre. Lo
// que ese mismo mensajero NO podra hacer es GESTIONAR lo que se le asigne, si su cierre esta
// `vencido` o `rechazado` — eso se decide en `MisAsignacionesService`, con otro predicado, y sus
// tres casos estan en `mis-asignaciones-service.test.ts` (feature 111, R1/R4).
// ⚠️ ESTE BLOQUE SE DIO LA VUELTA EL 2026-08-23 (FEATURE 271, Q1). Decia «el cierre abierto YA NO
// bloquea (R13 retirada)» y afirmaba que la asignacion ni siquiera preguntaba. El humano revirtio
// esa mitad de la regla firmada el 2026-08-20: acumular dos cierres —o arrastrar uno
// re-solicitable— bloquea TAMBIEN recibir trabajo nuevo. Sus palabras: «un mensajero no puede hacer
// las dos gestiones, solo una a la vez».
//
// Lo que SOBREVIVE de la 241 y se afirma abajo: un cierre `solicitado` A SECAS (N=1, V=0) NO
// bloquea, asi que ese mensajero sigue recibiendo reparto con normalidad.
describe("GuiaAsignacionService — el mensajero BLOQUEADO no recibe reparto (feature 271/R28/R30)", () => {
  it("asignarDesdeBodega hacia un mensajero BLOQUEADO -> conflict, y NINGUNA orden cambia", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: "en_bodega_central" })]),
      findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]): Promise<Set<string>> => new Set(ids)),
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set(["m-bloq"])),
    });
    const service = newService(repo);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m-bloq" }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: "o1", motivo: MSG_MENSAJERO_BLOQUEADO_POR_CIERRES },
    ]);
    // R30: todo-o-nada. La guarda va ANTES de cualquier escritura.
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
    expect(repo.findMensajerosBloqueadosPorCierres).toHaveBeenCalledWith(["m-bloq"]);
  });

  it("y el mensajero LIBRE sigue recibiendo reparto: la guarda no bloquea de mas", async () => {
    // El contraste obligatorio. Sin el, «conflict» podria venir de cualquier otra guarda del metodo.
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: "en_bodega_central" })]),
      findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]): Promise<Set<string>> => new Set(ids)),
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set()),
    });

    const r = await newService(repo).asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m-libre" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(repo.asignarBodegaLote).toHaveBeenCalled();
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

    // Feature 246 (T3.2, R4/R5): sin `dia` en la peticion, el servicio la trata como «hoy» y
    // resuelve la fecha con el reloj INYECTADO. Un reloj real haria esta asercion dependiente del
    // dia en que se corra la suite.
    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
      new Date("2026-08-20T20:00:00.000Z"), // 14:00 CR del 20
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toEqual([{ ordenId: "o1", estado: "por_recoger" }]);
    expect(repo.asignarBodegaLote).toHaveBeenCalledWith(
      ["o1"],
      "m1",
      "os-espera",
      { actorUsuarioId: "u-maestro", origenTipo: "asignacion_bodega" },
      // Feature 246 (R4/R7): el dia de reparto YA RESUELTO llega en la MISMA llamada. `hoy` por
      // defecto = el comportamiento anterior a esta ficha.
      new Date("2026-08-20T00:00:00.000Z"),
    );
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

// ⚠️ FEATURE 241 (2026-08-20) — BLOQUE INVERTIDO. Aqui vivia «no rutear a bodega satelite con >=1
// mensajero en cierre», una regla del humano del 2026-07-16 que dos casos afirmaban como `conflict`.
//
// SE VA, y no por inercia: es la version mas desproporcionada del bloqueo por cierre —por ZONA y no
// por mensajero—, asi que el cierre de UNA persona paraba la bodega entera, companeros limpios
// incluidos, con una espera de 8,2 h de mediana y 22,1 h en p90 (investigacion 241 §5). Rutear
// ordenes a una bodega ES que esa bodega reciba trabajo, y la regla firmada dice que recibir no se
// bloquea nunca.
//
// Y HABIA QUE DECIDIRLO EXPLICITAMENTE, no dejarlo pasar: desde el 2026-08-18 esta guarda no
// disparaba porque el predicado estaba apagado por un tope inalcanzable. Al reparar el predicado en
// esta misma ficha habria RESUCITADO sola, sin que nadie lo pidiera. Por eso se borra el codigo y
// no solo su efecto.
//
// Los casos se conservan invertidos —no se borran— porque son el testigo: si alguien repone el
// bloqueo por zona, estos dos se ponen rojos y nombran el sitio.
describe("Feature 241 — rutear a bodega satelite YA NO mira los cierres de sus mensajeros", () => {
  const MENSAJEROS_LIMON = [
    { id: "m-lim1", nombre: "Ana" },
    { id: "m-lim2", nombre: "Beto" },
  ];

  it("zona destino con TODOS los mensajeros en cierre -> rutea igual (ok)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosByZona: vi.fn(async () => MENSAJEROS_LIMON),
      // Los dobles siguen diciendo que estan bloqueados PARA GESTIONAR: el punto es que rutear ya
      // no lo pregunta. Ni siquiera necesita saber quienes son los mensajeros de la zona.
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set(["m-lim1", "m-lim2"])),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.rutearBodegaSateliteLote).toHaveBeenCalledTimes(1);
    expect(repo.findMensajerosBloqueadosPorCierres).not.toHaveBeenCalled();
    // La guarda entera se fue: tampoco se pide el censo de la zona para evaluarla.
    expect(repo.findMensajerosByZona).not.toHaveBeenCalled();
  });

  it("1 solo mensajero de la zona destino en cierre -> rutea igual (ok)", async () => {
    // El caso que mas dolia: un companero cierra su dia y la bodega entera dejaba de recibir.
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosByZona: vi.fn(async () => MENSAJEROS_LIMON),
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set(["m-lim1"])),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.rutearBodegaSateliteLote).toHaveBeenCalledTimes(1);
    expect(repo.findMensajerosBloqueadosPorCierres).not.toHaveBeenCalled();
  });

  it("NINGUN mensajero de la zona destino en cierre -> rutea normal (ok)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosByZona: vi.fn(async () => MENSAJEROS_LIMON),
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set()),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.rutearBodegaSateliteLote).toHaveBeenCalledTimes(1);
  });

  it("zona destino SIN mensajeros -> rutea ok", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
      findMensajerosByZona: vi.fn(async () => []),
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set()),
    });
    const service = newService(repo);

    const r = await service.rutearABodegaSatelite({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------------------
// Feature 157 (R3-R9) — asignarRecoleccion: la CUARTA accion. Es la unica que NO transiciona
// (la orden sigue en `por_recolectar_en_tienda`) y la unica que no pasa por el gate de
// coordenadas. El mensajero NO se acota por zona (decision del humano 2026-07-30): el filtro
// de las otras asignaciones es la zona de ENTREGA, que para ir a recoger no significa nada.
// ---------------------------------------------------------------------------------------
describe("GuiaAsignacionService.asignarRecoleccion (feature 157)", () => {
  const ORIGEN = "por_recolectar_en_tienda";

  it.each([
    ["adminTienda", ADMIN_TIENDA],
    ["mensajero", MENSAJERO],
  ])("R8: %s no asigna recolecciones (sin efectos)", async (_n, actor) => {
    const repo = fakeRepo();
    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      actor,
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.asignarRecoleccionLote).not.toHaveBeenCalled();
  });

  it("R3: asigna el lote entero y escribe UNA sola vez, sin transicionar", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: ORIGEN }),
        ordenRow({ id: "o2", estatusValue: ORIGEN }),
      ]),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1", "o2"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", resultados: [{ ordenId: "o1" }, { ordenId: "o2" }] });
    // Feature 157 (ampliacion): la asignacion TRANSICIONA, asi que ademas del origen viaja el
    // destino (`recolectando`) y el contexto del historial — es lo que deja el rastro.
    expect(repo.asignarRecoleccionLote).toHaveBeenCalledWith(
      ["o1", "o2"],
      "m1",
      ORIGEN,
      "os-recolectando",
      { actorUsuarioId: MAESTRO.usuarioId, origenTipo: "asignacion_recoleccion" },
    );
    // Ninguna de las otras escrituras: esto NO es una transicion.
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it.each([
    ["estado de origen invalido", ordenRow({ id: "o2", estatusValue: "en_bodega_central" })],
    ["borrada", ordenRow({ id: "o2", estatusValue: ORIGEN, deletedAt: new Date() })],
  ])("R5: una orden %s aborta el lote ENTERO sin efectos", async (_n, mala) => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: ORIGEN }), mala]),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1", "o2"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    expect(repo.asignarRecoleccionLote).not.toHaveBeenCalled();
  });

  it("R5: una orden inexistente tambien aborta el lote, con su motivo", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: ORIGEN })]),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1", "fantasma"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r).toMatchObject({
      status: "conflict",
      detalle: [{ ordenId: "fantasma", motivo: expect.stringMatching(/no existe/i) }],
    });
    expect(repo.asignarRecoleccionLote).not.toHaveBeenCalled();
  });

  it("R6: mensajeroId que no es mensajero -> validation_error, sin escribir", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: ORIGEN })]),
      findMensajeroIdsValidos: vi.fn(async (): Promise<Set<string>> => new Set()),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "no-es-mensajero" },
      MAESTRO,
    );

    expect(r).toMatchObject({ status: "validation_error" });
    expect(repo.asignarRecoleccionLote).not.toHaveBeenCalled();
  });

  it("R6: el mensajero se valida SIN acotar por zona (no se consulta la zona GAM)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        // Orden de zona NO-GAM: para una recoleccion la zona de entrega es irrelevante.
        ordenRow({ id: "o1", estatusValue: ORIGEN, zonaId: NO_GAM_ZONA_ID, zonaEsGam: false }),
      ]),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m-de-otra-zona" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(repo.findMensajeroIdsValidos).toHaveBeenCalledWith(["m-de-otra-zona"]);
    expect(repo.findMensajeroIdsValidosByZona).not.toHaveBeenCalled();
  });

  // Pedido humano 2026-08-18 — R7 RETIRADA (misma decision que R13), ratificada por la regla 2 de
  // la feature 241: ningun estado de cierre impide mandar a alguien a recolectar. Lo que SI le
  // impide un `vencido`/`rechazado` es CONFIRMAR esa recoleccion cuando llegue a la tienda —
  // recolectar es cobrar—, y eso vive en `RecoleccionTiendaService` con su propio caso.
  // ⚠️ ESTE CASO SE DIO LA VUELTA EL 2026-08-23 (FEATURE 271, R31). Decia «mensajero con cierre
  // pendiente -> se le asigna la recoleccion igual», que era la EXCEPCION que el humano revirtio:
  // «Error mío, en realidad no puede recibir recolecciones porque son dos tareas diferentes […] un
  // mensajero no puede hacer las dos gestiones, solo una a la vez». Y ademas recolectar COBRA:
  // `RecoleccionTiendaService` ya bloqueaba el ACTO, asi que permitir RECIBIR lo que no se puede
  // EJECUTAR dejaba al mensajero con paquetes asignados y un rechazo en el mostrador de la tienda.
  it("mensajero BLOQUEADO -> NO se le asigna la recoleccion (feature 271/R31)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: ORIGEN })]),
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set(["m-bloq"])),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m-bloq" },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: "o1", motivo: MSG_MENSAJERO_BLOQUEADO_POR_CIERRES },
    ]);
    expect(repo.asignarRecoleccionLote).not.toHaveBeenCalled();
  });

  it("y el mensajero LIBRE sigue recibiendo recoleccion: la guarda no bloquea de mas", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: ORIGEN })]),
      findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set()),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m-libre" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(repo.asignarRecoleccionLote).toHaveBeenCalled();
  });

  it("R9: una orden SIN coordenadas SI se asigna (el gate no corre: no entra a ninguna ruta)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", estatusValue: ORIGEN })]),
    });
    // Gate que rechazaria TODO si llegara a consultarse.
    const gateQueRechaza: IAsignabilidadCoordenadasService = {
      evaluar: vi.fn(
        async (rows: OrdenAsignabilidadRow[]) =>
          new Map<string, EstadoAsignabilidad>(
            rows.map((row) => [row.id, "sin_coordenadas" as EstadoAsignabilidad]),
          ),
      ),
    };

    const r = await newService(repo, fakeZonaRepo(), gateQueRechaza).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(gateQueRechaza.evaluar).not.toHaveBeenCalled();
  });

  it("lote vacio -> ok trivial sin tocar el repo (idempotencia, patron de las otras acciones)", async () => {
    const repo = fakeRepo();

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: [], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", resultados: [] });
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
    expect(repo.asignarRecoleccionLote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------
// Feature 157 — REGLA DE DEDICACIÓN (decisión del humano, 2026-07-31). Recolectar en tienda
// y repartir son viajes incompatibles: quien va a recoger un lote sale con el vehículo
// vacío y vuelve a la central. La regla vale en las DOS direcciones.
//
// Asimetría deliberada de lo que cuenta como "ocupado": las otras RECOLECCIONES no
// bloquean —un viaje a la tienda son N órdenes y hay que poder asignar el lote entero—,
// pero cualquier orden de REPARTO sí.
// ---------------------------------------------------------------------------------------
describe("GuiaAsignacionService — dedicación: reparto y recolección no se mezclan", () => {
  const ORIGEN_RECOLECCION = "por_recolectar_en_tienda";

  it("no se le asigna una recolección a quien tiene reparto pendiente", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: ORIGEN_RECOLECCION }),
      ]),
      findMensajerosConOrdenesEn: vi.fn(async (): Promise<Set<string>> => new Set(["m1"])),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r).toMatchObject({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: expect.stringMatching(/sin carga/i) }],
    });
    expect(repo.asignarRecoleccionLote).not.toHaveBeenCalled();
  });

  it("pregunta EXACTAMENTE por los estados de reparto, no por otras recolecciones", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: ORIGEN_RECOLECCION }),
      ]),
    });

    await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
    );

    // Si preguntara por `por_recolectar_en_tienda`, el segundo lote de un mismo viaje a la
    // tienda seria inasignable: el mensajero ya tendria la primera orden encima.
    //
    // FEATURE 235 (2026-08-19): la lista pasa a TRES. `ayuda_tienda` significa literalmente que el
    // paquete SIGUE CON EL, en la calle (R1), asi que ocupa igual que `en_reparto`. Censo CERRADO:
    // uno de mas bloquearia a quien no lleva nada; uno de menos —el que se cayo al mover el
    // estatus— manda a recolectar a quien va cargado.
    expect(repo.findMensajerosConOrdenesEn).toHaveBeenCalledWith(
      ["m1"],
      ["por_recoger", "en_reparto", "ayuda_tienda"],
    );
  });

  // ===============================================================================================
  // FEATURE 235 (R1 + regla de dedicacion de la 157) — LA ORDEN EN AYUDA OCUPA AL MENSAJERO.
  //
  // ⚠️ ESTO SE ROMPIO Y NADIE LO VIO. Mientras la ayuda fue un BOOLEANO, la orden seguia en
  // `en_reparto` y esta lista la contaba sola. Al moverla a un estatus propio, un mensajero con el
  // paquete encima paso a leerse como SIN CARGA y el maestro podia mandarlo a recolectar a una
  // tienda — contra la regla que el humano firmo el 2026-07-31 y que el propio archivo explica:
  // «quien va a una tienda a recoger un lote sale con el vehiculo vacio y vuelve a la central».
  //
  // El barrido de la 235 (T3.4/R17) miro los listados que OFRECEN ORDENES; esta es otra familia:
  // las listas que describen la OCUPACION DEL MENSAJERO. La guardia
  // `carga-del-mensajero.guardia.test.ts` censa la familia entera para que no vuelva a pasar.
  // ===============================================================================================
  it("235: no se le asigna una recoleccion a quien tiene una orden en `ayuda_tienda`", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: ORIGEN_RECOLECCION }),
      ]),
      // El doble responde como responderia la query real: pregunta por los tres estados y este
      // mensajero tiene una orden en uno de ellos.
      findMensajerosConOrdenesEn: vi.fn(async (_ids: string[], estados: string[]) =>
        estados.includes("ayuda_tienda") ? new Set(["m1"]) : new Set<string>(),
      ),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r).toMatchObject({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: expect.stringMatching(/sin carga/i) }],
    });
    expect(repo.asignarRecoleccionLote).not.toHaveBeenCalled();
  });

  it("235 (CASO NEGATIVO): si `ayuda_tienda` saliera de la lista, este mensajero pasaria", async () => {
    // La contraprueba que da sentido al caso de arriba: el MISMO doble, y lo unico que decide es si
    // el service pregunta o no por el estatus de ayuda. Sin este par, el caso anterior pasaria
    // igual con un doble que dijera «ocupado» siempre.
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: ORIGEN_RECOLECCION }),
      ]),
      findMensajerosConOrdenesEn: vi.fn(async (_ids: string[], estados: string[]) =>
        estados.includes("por_devolver") ? new Set(["m1"]) : new Set<string>(),
      ),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
  });

  it("un mensajero con OTRAS recolecciones SÍ recibe más del mismo viaje", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: ORIGEN_RECOLECCION }),
      ]),
      // Sin reparto: el doble responde vacío para los estados que se le preguntan.
      findMensajerosConOrdenesEn: vi.fn(async (): Promise<Set<string>> => new Set()),
    });

    const r = await newService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(repo.asignarRecoleccionLote).toHaveBeenCalledTimes(1);
  });

  it("SIMÉTRICA: no se le asigna reparto a quien tiene una recolección sin confirmar", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central" }),
      ]),
      findMensajerosConOrdenesEn: vi.fn(async (): Promise<Set<string>> => new Set(["m1"])),
    });

    const r = await newService(repo).asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r).toMatchObject({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: expect.stringMatching(/recoleccion/i) }],
    });
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("SIMÉTRICA: pregunta por el estado de recolección, y sin ella la asignación sigue", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central" }),
      ]),
    });

    const r = await newService(repo).asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(repo.findMensajerosConOrdenesEn).toHaveBeenCalledWith(
      ["m1"],
      ["recolectando"], // lo que ocupa es la recoleccion ASIGNADA, no la que espera sin dueño
    );
    expect(r.status).toBe("ok");
  });
});

// =================================================================================================
// FEATURE 246 (T3.2, R3/R4/R5/R6/R7) — LA ELECCION SE RESUELVE A FECHA EN EL SERVIDOR.
// =================================================================================================
describe("246/R3-R7 — asignarDesdeBodega resuelve el dia de reparto", () => {
  /** 14:00 hora de pared de Costa Rica del 20 de agosto. */
  const TARDE_DEL_20 = new Date("2026-08-20T20:00:00.000Z");
  const DIA_20 = new Date("2026-08-20T00:00:00.000Z");
  const DIA_21 = new Date("2026-08-21T00:00:00.000Z");

  function repoConDosOrdenes() {
    return fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central", numGuia: 55 }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central", numGuia: 56 }),
      ]),
    });
  }

  /** La fecha que el servicio le pasa al repositorio (5.º argumento). */
  function fechaEscrita(repo: ReturnType<typeof fakeRepo>): Date {
    const call = (repo.asignarBodegaLote as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    return call[4] as Date;
  }

  it('R4/R5: sin `dia` -> «hoy», resuelto con el reloj del SERVIDOR', async () => {
    const repo = repoConDosOrdenes();
    await newService(repo).asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
      TARDE_DEL_20,
    );
    expect(fechaEscrita(repo).toISOString()).toBe(DIA_20.toISOString());
  });

  it('R5: `dia: "manana"` -> la fecha CR del dia SIGUIENTE, no un booleano', async () => {
    const repo = repoConDosOrdenes();
    await newService(repo).asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1", dia: "manana" },
      MAESTRO,
      TARDE_DEL_20,
    );
    // Una FECHA ABSOLUTA, no una marca «para mañana»: una fecha vence sola (D2/R13).
    expect(fechaEscrita(repo).toISOString()).toBe(DIA_21.toISOString());
  });

  it("R3: UNA asignacion, UN dia de reparto — el lote entero recibe la misma fecha", async () => {
    const repo = repoConDosOrdenes();
    await newService(repo).asignarDesdeBodega(
      { ordenIds: ["o1", "o2"], mensajeroId: "m1", dia: "manana" },
      MAESTRO,
      TARDE_DEL_20,
    );
    const call = (repo.asignarBodegaLote as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    // Los dos ids van en UNA sola llamada, con UNA sola fecha: no hay forma de que el lote se
    // parta en dos dias.
    expect(call[0]).toEqual(["o1", "o2"]);
    expect((call[4] as Date).toISOString()).toBe(DIA_21.toISOString());
    expect((repo.asignarBodegaLote as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("R5/R17: a las 23:59 CR «mañana» sigue siendo el dia siguiente en HORA DE COSTA RICA", async () => {
    // 2026-08-21T05:59:00Z = 23:59 CR del 20. En UTC ya es dia 21: si el servicio usara el dia
    // UTC, «mañana» seria el 22 y la orden quedaria protegida DOS noches.
    const repo = repoConDosOrdenes();
    await newService(repo).asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1", dia: "manana" },
      MAESTRO,
      new Date("2026-08-21T05:59:00.000Z"),
    );
    expect(fechaEscrita(repo).toISOString()).toBe(DIA_21.toISOString());
  });

  it("R6: la fecha la pone el SERVIDOR — el input no tiene por donde colar una", async () => {
    // El borde ya lo impide (zod solo acepta el token), pero el servicio tampoco leeria una:
    // una peticion con una fecha de sobra produce exactamente la misma escritura.
    const repo = repoConDosOrdenes();
    await newService(repo).asignarDesdeBodega(
      {
        ordenIds: ["o1"],
        mensajeroId: "m1",
        dia: "hoy",
        // @ts-expect-error — el contrato NO admite una fecha; el caso existe para demostrarlo.
        fechaReparto: new Date("2030-01-01T00:00:00.000Z"),
      },
      MAESTRO,
      TARDE_DEL_20,
    );
    expect(fechaEscrita(repo).toISOString()).toBe(DIA_20.toISOString());
  });

  it("R7: la fecha va en la MISMA llamada que fija el mensajero, no en una segunda pasada", async () => {
    const repo = repoConDosOrdenes();
    await newService(repo).asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1", dia: "manana" },
      MAESTRO,
      TARDE_DEL_20,
    );
    // Una sola escritura de asignacion, y lleva las dos cosas.
    expect((repo.asignarBodegaLote as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const call = (repo.asignarBodegaLote as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(call[1]).toBe("m1"); // el mensajero
    expect(call[4]).toBeInstanceOf(Date); // ...y el dia, juntos
  });
});
