import { describe, it, expect, vi } from "vitest";
import {
  generarGuia,
  asignarDesdeBodega,
  asignarRecoleccion,
  listarMensajerosParaAsignacion,
  rutearABodegaSatelite,
} from "@/lib/actions/ordenes-guia";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGuiaAsignacionService } from "@/lib/interfaces/services/IGuiaAsignacionService";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const getActor = (actor: Actor | null) => async (): Promise<Actor | null> => actor;

function fakeGuiaService(overrides: Partial<IGuiaAsignacionService> = {}): IGuiaAsignacionService {
  return {
    generarGuia: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    asignarDesdeBodega: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    rutearABodegaSatelite: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    asignarRecoleccion: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    desasignarRecoleccion: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    ...overrides,
  };
}

describe("R14: sin sesion valida -> unauthenticated antes de tocar el service", () => {
  it("generarGuia", async () => {
    const service = fakeGuiaService();
    const r = await generarGuia(
      { ordenIds: ["o1"] },
      { guiaService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.generarGuia).not.toHaveBeenCalled();
  });

  it("asignarDesdeBodega", async () => {
    const service = fakeGuiaService();
    const r = await asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { guiaService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.asignarDesdeBodega).not.toHaveBeenCalled();
  });

  it("listarMensajerosParaAsignacion", async () => {
    const ordenRepo = {
      findMensajerosByZona: vi.fn(),
      findMensajerosConOrdenesEn: vi.fn(), // feature 157

    };
    const zonaRepo = { findCentralZonaId: vi.fn() };
    const r = await listarMensajerosParaAsignacion({ ordenRepo, zonaRepo, getActor: getActor(null) });

    expect(r.status).toBe("unauthenticated");
    expect(zonaRepo.findCentralZonaId).not.toHaveBeenCalled();
    expect(ordenRepo.findMensajerosByZona).not.toHaveBeenCalled();
  });

  it("rutearABodegaSatelite", async () => {
    const service = fakeGuiaService();
    const r = await rutearABodegaSatelite(
      { ordenIds: ["o1"] },
      { guiaService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.rutearABodegaSatelite).not.toHaveBeenCalled();
  });
});

describe("feature 94: admin en escritura -> permitido (delegado al service con el actor, sin transformar)", () => {
  it("generarGuia", async () => {
    const service = fakeGuiaService({
      generarGuia: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    });
    const r = await generarGuia(
      { ordenIds: ["o1"] },
      { guiaService: service, getActor: getActor(ADMIN) },
    );

    expect(r).toEqual({ status: "ok", resultados: [] });
    expect(service.generarGuia).toHaveBeenCalledWith({ ordenIds: ["o1"] }, ADMIN);
  });

  it("asignarDesdeBodega", async () => {
    const service = fakeGuiaService({
      asignarDesdeBodega: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    });
    const r = await asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { guiaService: service, getActor: getActor(ADMIN) },
    );

    expect(r).toEqual({ status: "ok", resultados: [] });
    // Feature 246 (T3.1, R4): idem bodega central — la peticion no trae `dia`, zod le pone
    // `"hoy"` y el borde lo entrega sin transformar.
    expect(service.asignarDesdeBodega).toHaveBeenCalledWith(
      { ordenIds: ["o1"], mensajeroId: "m1", dia: "hoy" },
      ADMIN,
    );
  });
});

// Feature 156/R14 — la entrada de generar guia es un LOTE DE IDS y nada mas. El contrato
// previo (`decisiones: [{ ordenId, mensajeroId }]`) ya no valida, y ningun dato de mensajero
// llega al service.
describe("generarGuia — validacion de entrada (zod, 156/R14)", () => {
  it("input invalido -> validation_error sin llamar al service", async () => {
    const service = fakeGuiaService();
    const r = await generarGuia(
      { ordenIds: "no-es-array" },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    expect(service.generarGuia).not.toHaveBeenCalled();
  });

  it("156/R14: el contrato viejo con decisiones/mensajeroId -> validation_error, sin llamar al service", async () => {
    const service = fakeGuiaService();
    const r = await generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m1" }] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.ordenIds).toBeDefined(); // el motivo es la falta de `ordenIds`
    expect(service.generarGuia).not.toHaveBeenCalled();
  });

  it("156/R14: un mensajeroId colado junto a ordenIds NO llega al service", async () => {
    const service = fakeGuiaService();
    await generarGuia(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    // zod descarta lo no declarado: el service recibe EXACTAMENTE el lote de ids.
    expect(service.generarGuia).toHaveBeenCalledWith({ ordenIds: ["o1"] }, MAESTRO);
  });

  it("un id vacio dentro del lote -> validation_error", async () => {
    const service = fakeGuiaService();
    const rIdVacio = await generarGuia(
      { ordenIds: [""] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );
    expect(rIdVacio.status).toBe("validation_error");
    expect(service.generarGuia).not.toHaveBeenCalled();
  });
});

// 2026-08-05 — EL LOTE VACIO NO ES UN EXITO. Las tres acciones de lote de este archivo
// declaraban `ordenIds: z.array(...)` SIN cota inferior, y sus tres services arrancan con
// `if (ordenIds.length === 0) return { status: "ok", resultados: [] }`: `{ ordenIds: [] }`
// cruzaba el borde y volvia como `ok` con 0 resultados, que la UI cantaba como exito
// ("Mensajero asignado a 0 orden(es)"). Se cerro en el schema —la raiz—, no en los modales:
// el borde rechaza el lote vacio con `validation_error` y el service NI SE ENTERA.
//
// Cada caso espia el service: `not.toHaveBeenCalled()` es lo que distingue "lo para el
// borde" de "lo absorbe el service y devuelve ok". Si a `orden-guia.ts` se le quita el
// `.min(1)` del array, estos tres se ponen en rojo (verificado por mutacion).
describe("lote vacio -> validation_error en el borde, sin tocar el service", () => {
  it("generarGuia", async () => {
    const service = fakeGuiaService();
    const r = await generarGuia(
      { ordenIds: [] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.ordenIds).toBeDefined();
    expect(service.generarGuia).not.toHaveBeenCalled();
  });

  it("asignarDesdeBodega", async () => {
    const service = fakeGuiaService();
    const r = await asignarDesdeBodega(
      { ordenIds: [], mensajeroId: "m1" },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.ordenIds).toBeDefined();
    expect(service.asignarDesdeBodega).not.toHaveBeenCalled();
  });

  it("rutearABodegaSatelite", async () => {
    const service = fakeGuiaService();
    const r = await rutearABodegaSatelite(
      { ordenIds: [] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.ordenIds).toBeDefined();
    expect(service.rutearABodegaSatelite).not.toHaveBeenCalled();
  });
});

describe("generarGuia — camino ok delega al service con el actor resuelto", () => {
  it("llama al service y devuelve su resultado tal cual", async () => {
    const service = fakeGuiaService({
      generarGuia: vi.fn().mockResolvedValue({
        status: "ok",
        resultados: [{ ordenId: "o1", numGuia: 10, estado: "en_bodega_central" }],
      }),
    });

    const r = await generarGuia(
      { ordenIds: ["o1"] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r).toEqual({
      status: "ok",
      resultados: [{ ordenId: "o1", numGuia: 10, estado: "en_bodega_central" }],
    });
  });
});

describe("Feature 30/R5: listarMensajerosParaAsignacion devuelve SOLO mensajeros de la zona GAM", () => {
  it("maestro: resuelve gamZonaId y llama findMensajerosByZona con esa zona", async () => {
    const findCentralZonaId = vi.fn().mockResolvedValue("z-gam");
    const findMensajerosByZona = vi.fn().mockResolvedValue([
      { id: "m1", nombre: "Ana" },
      { id: "m2", nombre: "Beto" },
    ]);
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: {
        findMensajerosByZona,
        // feature 157: sin carga por defecto; los casos de la regla lo overridean.
        findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
      },
      zonaRepo: { findCentralZonaId },
      getActor: getActor(MAESTRO),
    });

    // ⚠️ FEATURE 241 (2026-08-20) — ESTE `toEqual` LLEVABA `bloqueadosIds: ["m2"]`, y era el
    // CONTRATO: afirmaba que la accion marcaba en el selector a quien arrastrara un cierre. Se
    // quita a proposito, no por conveniencia. Asignar no se bloquea por cierres (regla 2 firmada),
    // la pantalla ya ignoraba el dato desde el 2026-08-18, y seguir calculandolo era una consulta
    // a `cierre_dia` por cada carga del listado cuyo unico destino posible era volver a bloquear.
    //
    // Sigue siendo un LITERAL exhaustivo a proposito: si alguien vuelve a emitir `bloqueadosIds`,
    // este `toEqual` se pone rojo. Y no puede hacerlo por descuido — el predicado ya no figura en
    // el `Pick<IOrdenRepository, ...>` de `ListarMensajerosDeps`, asi que la accion NO PUEDE
    // llamarlo sin que alguien lo vuelva a declarar con su nombre "ParaGestion" delante.
    expect(r).toEqual({
      status: "ok",
      mensajeros: [
        { id: "m1", nombre: "Ana" },
        { id: "m2", nombre: "Beto" },
      ],
      // Feature 157: las dos caras de la regla de dedicacion viajan con la lista, para que
      // cada modal deshabilite la suya con el motivo a la vista. Esta regla SI sigue viva: es de
      // carga de trabajo, no de cierres.
      conRepartoIds: [],
      conRecoleccionIds: [],
    });
    expect(findMensajerosByZona).toHaveBeenCalledWith("z-gam"); // R5: filtrado por zona GAM
  });

  // ===============================================================================================
  // FEATURE 235 (regla de dedicacion de la 157) — EL GEMELO DE INTERFAZ.
  //
  // Esta accion marca en el selector del maestro a quien NO se le puede mandar una recoleccion. Su
  // lista de estados y la de `GuiaAsignacionService.ESTADOS_REPARTO_PENDIENTE` son LA MISMA VERDAD
  // DICHA DOS VECES: si divergen, el selector deja elegir a un mensajero al que el servidor va a
  // rechazar al confirmar, que es exactamente el «toparse con un rechazo del servidor» que este
  // marcador existe para evitar.
  //
  // Al mover la ayuda a un estatus propio, esta lista se quedo con los dos estados viejos y el
  // mensajero con el paquete encima aparecio SELECCIONABLE. Se repone aqui, y la guardia
  // `carga-del-mensajero.guardia.test.ts` cruza las dos listas para que no vuelvan a separarse.
  // ===============================================================================================
  it("235: pregunta por los TRES estados que ocupan al mensajero, `ayuda_tienda` incluido", async () => {
    const findCentralZonaId = vi.fn().mockResolvedValue("z-gam");
    const findMensajerosByZona = vi
      .fn()
      .mockResolvedValue([{ id: "m1", nombre: "Ana" }]);
    const findMensajerosConOrdenesEn = vi.fn(async () => new Set<string>());

    await listarMensajerosParaAsignacion({
      ordenRepo: {
        findMensajerosByZona,
        findMensajerosConOrdenesEn,
      },
      zonaRepo: { findCentralZonaId },
      getActor: getActor(MAESTRO),
    });

    // Cara REPARTO: censo cerrado, con el estatus de la ayuda dentro.
    expect(findMensajerosConOrdenesEn).toHaveBeenCalledWith(
      ["m1"],
      ["por_recoger", "en_reparto", "ayuda_tienda"],
    );
    // Cara RECOLECCION: intacta. `ayuda_tienda` no es una recoleccion.
    expect(findMensajerosConOrdenesEn).toHaveBeenCalledWith(["m1"], ["por_recolectar_en_tienda"]);
  });

  it("235: el mensajero con una orden en `ayuda_tienda` sale marcado en `conRepartoIds`", async () => {
    const findCentralZonaId = vi.fn().mockResolvedValue("z-gam");
    const findMensajerosByZona = vi
      .fn()
      .mockResolvedValue([{ id: "m1", nombre: "Ana" }]);
    // El doble responde como la query real: ocupado si se le pregunta por el estatus de ayuda.
    const findMensajerosConOrdenesEn = vi.fn(async (_ids: string[], estados: string[]) =>
      estados.includes("ayuda_tienda") ? new Set(["m1"]) : new Set<string>(),
    );

    const r = await listarMensajerosParaAsignacion({
      ordenRepo: {
        findMensajerosByZona,
        findMensajerosConOrdenesEn,
      },
      zonaRepo: { findCentralZonaId },
      getActor: getActor(MAESTRO),
    });

    expect(r).toMatchObject({ status: "ok", conRepartoIds: ["m1"], conRecoleccionIds: [] });
  });

  it("R5: sin zona GAM configurada -> lista vacia, sin consultar mensajeros", async () => {
    const findCentralZonaId = vi.fn().mockResolvedValue(null);
    const findMensajerosByZona = vi.fn();
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: {
        findMensajerosByZona,
        // feature 157: sin carga por defecto; los casos de la regla lo overridean.
        findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
      },
      zonaRepo: { findCentralZonaId },
      getActor: getActor(MAESTRO),
    });

    expect(r).toEqual({ status: "ok", mensajeros: [] });
    expect(findMensajerosByZona).not.toHaveBeenCalled();
  });

  it("feature 94: admin (paridad con maestro) tambien puede listar", async () => {
    const findCentralZonaId = vi.fn().mockResolvedValue("z-gam");
    const findMensajerosByZona = vi.fn().mockResolvedValue([]);
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: {
        findMensajerosByZona,
        // feature 157: sin carga por defecto; los casos de la regla lo overridean.
        findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
      },
      zonaRepo: { findCentralZonaId },
      getActor: getActor(ADMIN),
    });

    expect(r.status).toBe("ok");
  });

  it("mensajero/adminTienda -> forbidden", async () => {
    const findCentralZonaId = vi.fn();
    const findMensajerosByZona = vi.fn();
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: {
        findMensajerosByZona,
        // feature 157: sin carga por defecto; los casos de la regla lo overridean.
        findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
      },
      zonaRepo: { findCentralZonaId },
      getActor: getActor({ usuarioId: "u-msg", rol: "mensajero" }),
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(findCentralZonaId).not.toHaveBeenCalled();
    expect(findMensajerosByZona).not.toHaveBeenCalled();
  });
});

describe("Feature 30/R13/R16: rutearABodegaSatelite (server action)", () => {
  it("input invalido -> validation_error sin llamar al service", async () => {
    const service = fakeGuiaService();
    const r = await rutearABodegaSatelite(
      { ordenIds: "no-es-array" },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    expect(service.rutearABodegaSatelite).not.toHaveBeenCalled();
  });

  it("camino ok delega al service con el actor resuelto y devuelve su resultado", async () => {
    const service = fakeGuiaService({
      rutearABodegaSatelite: vi.fn().mockResolvedValue({
        status: "ok",
        resultados: [{ ordenId: "o1", estado: "en_ruta_bodega_satelite" }],
      }),
    });
    const r = await rutearABodegaSatelite(
      { ordenIds: ["o1"] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r).toEqual({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "en_ruta_bodega_satelite" }],
    });
    expect(service.rutearABodegaSatelite).toHaveBeenCalledWith({ ordenIds: ["o1"] }, MAESTRO);
  });
});

// BORRADO 2026-08-07 (chore de deuda de superficie): aqui vivia
// `describe("R15/R16: listarCatalogoEstatus ...")`, con los tres casos de esa accion (catalogo
// completo, paridad admin, forbidden a mensajero). Se van CON la accion, no se reapuntan: la
// sustituta viva `listarOrderStatus` (`lib/actions/order-status.ts`) ya prueba las tres
// propiedades y mas, en `tests/unit/actions/order-status.test.ts` — catalogo {id,value},
// los CUATRO roles autorizados, sin sesion, mensajero -> forbidden y rol desconocido ->
// forbidden. No se pierde ninguna cobertura.

// BORRADO 2026-08-18 (pedido humano): aqui vivia `describe("listarZonasBloqueadasPorCierre")`,
// con los casos del gate de seleccion del maestro (zonas con >=1 mensajero en cierre, paridad
// admin, forbidden, sin sesion). Se van CON la action, que se borro porque la regla desaparecio:
// un cierre abierto ya no impide asignar, asi que la UI no deshabilita nada por zona. No es
// cobertura perdida — es cobertura de una regla que ya no existe.

// Feature 157 (T1.14) — borde de la asignacion de recoleccion. El UUID en el schema es la
// diferencia con `asignarBodegaSchema` (que acepta cualquier string no vacio): esta action
// nace con el contrato mas estricto, y el borde lo impone antes de llegar al service.
describe("asignarRecoleccion (feature 157)", () => {
  const ORDEN_ID = "11111111-1111-4111-8111-111111111111";
  const MENSAJERO_ID = "22222222-2222-4222-8222-222222222222";

  it("R8: sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeGuiaService();

    const r = await asignarRecoleccion(
      { ordenIds: [ORDEN_ID], mensajeroId: MENSAJERO_ID },
      { guiaService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.asignarRecoleccion).not.toHaveBeenCalled();
  });

  it.each([
    ["ordenIds vacio", { ordenIds: [], mensajeroId: MENSAJERO_ID }],
    ["ordenId que no es uuid", { ordenIds: ["no-uuid"], mensajeroId: MENSAJERO_ID }],
    ["mensajeroId que no es uuid", { ordenIds: [ORDEN_ID], mensajeroId: "m1" }],
  ])("validation_error con %s, sin llegar al service", async (_n, input) => {
    const service = fakeGuiaService();

    const r = await asignarRecoleccion(input, {
      guiaService: service,
      getActor: getActor(MAESTRO),
    });

    expect(r.status).toBe("validation_error");
    expect(service.asignarRecoleccion).not.toHaveBeenCalled();
  });

  it("passthrough del `conflict{detalle}` del service (la UI lo pinta por orden)", async () => {
    const detalle = [{ ordenId: ORDEN_ID, motivo: "estado de origen no permitido: en_bodega_central" }];
    const service = fakeGuiaService({
      asignarRecoleccion: vi.fn().mockResolvedValue({ status: "conflict", detalle }),
    });

    const r = await asignarRecoleccion(
      { ordenIds: [ORDEN_ID], mensajeroId: MENSAJERO_ID },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r).toEqual({ status: "conflict", detalle });
  });

  it("passthrough del `ok` con el input ya validado", async () => {
    const service = fakeGuiaService({
      asignarRecoleccion: vi.fn().mockResolvedValue({ status: "ok", resultados: [{ ordenId: ORDEN_ID }] }),
    });

    const r = await asignarRecoleccion(
      { ordenIds: [ORDEN_ID], mensajeroId: MENSAJERO_ID },
      { guiaService: service, getActor: getActor(ADMIN) },
    );

    expect(r).toEqual({ status: "ok", resultados: [{ ordenId: ORDEN_ID }] });
    expect(service.asignarRecoleccion).toHaveBeenCalledWith(
      { ordenIds: [ORDEN_ID], mensajeroId: MENSAJERO_ID },
      ADMIN,
    );
  });
});
