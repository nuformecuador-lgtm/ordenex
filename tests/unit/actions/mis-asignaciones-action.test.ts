import { describe, it, expect, vi } from "vitest";
import {
  escogerParaGestion,
  gestionar,
  liberarGestion,
  listarMisAsignaciones,
  recogerAsignaciones,
} from "@/lib/actions/mis-asignaciones";
import type { IMisAsignacionesService } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ForbiddenError } from "@/lib/errors";

// ⚠️ Feature 193 (R10), decision humana del 2026-08-10: la gestion EXIGE la ubicacion del
// mensajero (o un motivo tecnico). Los FormData validos de abajo se AMPLIAN con las dos
// coordenadas —no se relajan—: lo que cada test AFIRMA sigue siendo lo mismo. La disyuncion
// ubicacion/motivo se cubre aparte, en `mis-asignaciones-ubicacion.test.ts`.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

function imagenFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], "ev.jpg", { type: "image/jpeg" });
}

function fechaFuturaISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

function buildService(overrides: Partial<IMisAsignacionesService> = {}): IMisAsignacionesService {
  return {
    listarMisAsignaciones: vi.fn(async () => ({
      status: "ok" as const,
      porRecoger: [],
      porGestionar: [],
    conAyuda: [], // feature 235 (R18): el tercer grupo, separado en el servidor
      ordenEnGestionId: null,
      kpis: { pendientes: 0, entregadas: 0, porCobrar: 0, totalACobrar: 0 },
    // Feature 92/R27/R30: bloque de estado de la ruta que acompana al listado.
    ruta: {
      estado: "vigente" as const,
      calculadaAt: null,
      origenFuente: null,
      // Feature 265 (R45): `null` = no consta quien ordeno las paradas. Es lo que exige el tipo,
      // no un test que fallara: sin marca, la pantalla no dice nada del orden.
      secuenciaFuente: null,
      paradasSinOptimizar: 0,
      trazado: null,
      tramoSiguiente: null,
    },
    })),
    recogerAsignaciones: vi.fn(async () => ({ status: "ok" as const, recogidas: ["o1"] })),
    escogerParaGestion: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1" })),
    gestionar: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1", estado: "entregado" })),
    liberarGestion: vi.fn(async () => ({ status: "ok" as const })),
    ...overrides,
  };
}

const noActor = async () => null;
const actorMensajero = async () => MENSAJERO;

// --- unauthenticated en el borde (R12) ---

describe("R12: unauthenticated antes de tocar el service", () => {
  it("listar sin actor -> unauthenticated", async () => {
    const service = buildService();
    const r = await listarMisAsignaciones({ service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarMisAsignaciones).not.toHaveBeenCalled();
  });

  it("recoger sin actor -> unauthenticated", async () => {
    const r = await recogerAsignaciones({ ordenIds: ["o1"] }, { service: buildService(), getActor: noActor });
    expect(r.status).toBe("unauthenticated");
  });

  it("escoger sin actor -> unauthenticated", async () => {
    const r = await escogerParaGestion({ ordenId: "o1" }, { service: buildService(), getActor: noActor });
    expect(r.status).toBe("unauthenticated");
  });

  it("gestionar sin actor -> unauthenticated", async () => {
    const fd = new FormData();
    const r = await gestionar(fd, { service: buildService(), getActor: noActor });
    expect(r.status).toBe("unauthenticated");
  });
});

// --- recoger / escoger delegan ---

describe("recoger / escoger", () => {
  it("recoger valido delega en el service con los ordenIds", async () => {
    const service = buildService();
    const r = await recogerAsignaciones({ ordenIds: ["o1", "o2"] }, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    expect(service.recogerAsignaciones).toHaveBeenCalledWith({ ordenIds: ["o1", "o2"] }, MENSAJERO);
  });

  it("recoger con lista vacia -> validation_error (zod), sin service", async () => {
    const service = buildService();
    const r = await recogerAsignaciones({ ordenIds: [] }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.recogerAsignaciones).not.toHaveBeenCalled();
  });

  it("escoger valido delega con el ordenId", async () => {
    const service = buildService();
    const r = await escogerParaGestion({ ordenId: "o1" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    expect(service.escogerParaGestion).toHaveBeenCalledWith("o1", MENSAJERO);
  });
});

// --- gestionar: zod discriminado + lectura de binario ---

describe("gestionar — validacion de borde (R22/R24/R25/R27/R29)", () => {
  function fdEntrega(overrides: Record<string, string> = {}, withFile = true): FormData {
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "entregado");
    fd.set("montoRecibido", "100");
    fd.set("metodoPago", "efectivo");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    if (withFile) fd.set("evidencia", imagenFile());
    return fd;
  }

  it("R22: entrega valida delega con montoRecibido number, metodo y bytes de evidencia", async () => {
    const service = buildService();
    const r = await gestionar(fdEntrega(), { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    const [input] = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.resultado).toBe("entregado");
    expect(input.montoRecibido).toBe(100);
    expect(input.metodoPago).toBe("efectivo");
    // Feature 119 (R5): la evidencia llega como LISTA de 1..N; el borde la lee via getAll.
    expect(input.evidencias[0].bytes).toBeInstanceOf(Uint8Array);
  });

  it("R22: entrega sin foto -> validation_error, sin service", async () => {
    const service = buildService();
    const r = await gestionar(fdEntrega({}, false), { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  // El schema paso de `.positive()` a `.nonnegative()` (lib/types/gestion-orden.ts):
  // una entrega SIN cobro recauda 0 y es valida, asi que 0 ya NO se rechaza aqui.
  // Lo que la action sigue rechazando es un monto NEGATIVO.
  //
  // Que el monto CUADRE con el `montoCobrar` de la orden es R22 (h) y lo valida
  // el SERVICIO, no el schema (MisAsignacionesService: comparacion en Decimal).
  // Sus casos viven en tests/unit/services/mis-asignaciones-service.test.ts
  // ("monto != montoCobrar -> validation_error", "montoCobrar 0 + monto 0 -> ok",
  // "montoCobrar null + monto 100 -> validation_error"): R22 sigue trazado.
  it("R22: entrega con monto negativo -> validation_error, sin service", async () => {
    const service = buildService();
    const r = await gestionar(fdEntrega({ montoRecibido: "-1" }), { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R22: entrega con monto 0 (sin cobro) -> delega en el service", async () => {
    const service = buildService();
    const r = await gestionar(fdEntrega({ montoRecibido: "0" }), { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    const [input] = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.montoRecibido).toBe(0);
  });

  it("R25: reprogramar con fecha pasada -> validation_error", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "reprogramado");
    fd.set("fechaReprogramacion", "2000-01-01");
    fd.set("motivo", "x");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R25: reprogramar valido delega", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "reprogramado");
    fd.set("fechaReprogramacion", fechaFuturaISO());
    fd.set("motivo", "cliente no estaba");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    const [input] = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.resultado).toBe("reprogramado");
  });

  it("R27: devolucion sin motivo -> validation_error", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "novedad");
    fd.set("motivo", "");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
  });

  it("R29: rechazo sin foto -> validation_error", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "devolucion_a_origen_por_rechazo");
    fd.set("motivo", "cliente rechazo");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R29: rechazo valido (foto + motivo) delega con bytes", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "devolucion_a_origen_por_rechazo");
    fd.set("motivo", "cliente rechazo");
    fd.set("evidencia", imagenFile());
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    const [input] = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.resultado).toBe("devolucion_a_origen_por_rechazo");
    expect(input.evidencias[0].bytes).toBeInstanceOf(Uint8Array);
  });
});

// --- menor-1: errores EXCEPCIONALES pasan por withErrorHandler ---

describe("menor-1: withErrorHandler envuelve los cuerpos de las actions", () => {
  it("un error EXCEPCIONAL del service NO se propaga crudo (pasa por el manejador)", async () => {
    // Con el patron de ordenes-guia.ts: withErrorHandler captura y normaliza a INTERNAL. Lo que
    // este test AFIRMA sigue siendo lo mismo que el 2026: el error crudo "db down" NO escapa sin
    // pasar por el manejador.
    //
    // ⚠️ FICHA 440 — LO QUE CAMBIO Y POR QUE. Hasta hoy este test tambien exigia que la action
    // RELANZARA (`rejects.toThrow(/AppErrorCode inesperado/)`), porque INTERNAL caia en el
    // `default` del switch. Es decir: la unica red que cubria este camino estaba CONGELANDO el
    // defecto que el 2026-09-17 produjo 27 respuestas 500 en produccion. No fue «faltaba un
    // test»: habia uno, y afirmaba el bug. Ahora exige lo contrario —desenlace `error`, sin
    // lanzar— y la mitad que si valia (no filtrar el mensaje crudo) se conserva intacta.
    const service = buildService({
      gestionar: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "novedad");
    // Feature 73/R6: sin causa este FormData ya no llegaria al service (moriria en el borde
    // como validation_error) y el test dejaria de probar lo suyo — que un error EXCEPCIONAL
    // del service pasa por withErrorHandler. Se añade la causa para que el input siga siendo
    // valido; lo que el test AFIRMA no cambia.
    fd.set("causaDevolucion", "not_found");
    fd.set("motivo", "cliente no estaba");
    // Feature 75/analogo: sin evidencia este FormData moriria en el borde (validation_error) y
    // dejaria de probar lo suyo. Se adjunta la foto para que el input siga siendo valido; lo que
    // el test AFIRMA no cambia.
    fd.set("evidencia", imagenFile());

    const r = await gestionar(fd, { service, getActor: actorMensajero });
    // Ficha 440: se resuelve, no se rechaza. Que la promesa RESUELVA es la mitad que importa:
    // una Server Action que lanza no tiene frontera que la recoja y revienta en el `await` del
    // cliente.
    expect(r.status).toBe("error");
    // El mensaje crudo del service NO viaja al cliente: el desenlace es un objeto pelado, sin
    // `message` ni rastro de la base.
    expect(JSON.stringify(r)).not.toContain("db down");
  });

  it("unauthenticated (actor ausente) sigue devolviendose a traves de withErrorHandler", async () => {
    const service = buildService({
      gestionar: vi.fn(async () => {
        throw new Error("no deberia llamarse");
      }),
    });
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "novedad");
    fd.set("motivo", "x");
    const r = await gestionar(fd, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("validation_error (zod invalido) sigue devolviendose a traves de withErrorHandler", async () => {
    const service = buildService();
    // recoger con lista vacia: ZodError -> VALIDATION_ERROR normalizado.
    const r = await recogerAsignaciones({ ordenIds: [] }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.recogerAsignaciones).not.toHaveBeenCalled();
  });
});

// --- menor-3: liberarGestion (R35) ---

describe("menor-3: liberarGestion action (R35)", () => {
  it("actor ausente -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await liberarGestion({ ordenId: "o1" }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.liberarGestion).not.toHaveBeenCalled();
  });

  it("zod invalido (ordenId vacio) -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await liberarGestion({ ordenId: "" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.liberarGestion).not.toHaveBeenCalled();
  });

  it("ok: delega en el service con el ordenId y el actor", async () => {
    const service = buildService();
    const r = await liberarGestion({ ordenId: "o1" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    expect(service.liberarGestion).toHaveBeenCalledWith("o1", MENSAJERO);
  });
});

// --- FICHA 440: el tropiezo de base deja de reventar la pantalla del mensajero ---

/**
 * EL FALLO REAL, reproducido. El 2026-09-17 entre las 03:26 y las 04:34 UTC este portal devolvio
 * 27 respuestas 500 en `/mis-asignaciones/reparto`, todas del mismo mensajero. La cadena medida:
 * una lectura recibe de Postgres 25P02 —«current transaction is aborted»— desde una conexion que
 * volvio al pool sin rollback, `withErrorHandler` lo normaliza a INTERNAL, y el `default` del
 * switch del borde RELANZABA. Una Server Action que lanza no tiene frontera de error que la
 * recoja: el `await` del cliente se rechaza, el `finally` apaga el spinner y no se pinta nada.
 * El mensajero ve un boton que no hace nada.
 *
 * Estos casos NO existian, y por eso llego a produccion. Lo que afirman es lo minimo que impide
 * que vuelva: que la promesa RESUELVE (no se rechaza) y que trae un desenlace que la pantalla
 * puede contar.
 *
 * La CAUSA RAIZ —quien deja la transaccion abierta— no se toca aqui: es la otra mitad de la
 * ficha, va con spec y vive en codigo de dinero.
 */
describe("ficha 440: INTERNAL es un desenlace, no una excepcion", () => {
  /** Lo que Prisma entrega de verdad ante 25P02: un Error normal, sin `code` de AppError. */
  function baseAbortada() {
    return new Error(
      "current transaction is aborted, commands ignored until end of transaction block",
    );
  }

  /** FormData de devolucion valido (si muriera en el borde, el test dejaria de probar lo suyo). */
  function fdDevolucionValido() {
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281");
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "novedad");
    fd.set("causaDevolucion", "not_found");
    fd.set("motivo", "cliente no estaba");
    fd.set("evidencia", imagenFile());
    return fd;
  }

  it("listar: la base tropieza -> `error`, y la promesa RESUELVE", async () => {
    const service = buildService({
      listarMisAsignaciones: vi.fn(async () => {
        throw baseAbortada();
      }),
    });
    const r = await listarMisAsignaciones({ service, getActor: actorMensajero });
    expect(r.status).toBe("error");
  });

  it("listar: un fallo de base ya NO se disfraza de `unauthenticated`", async () => {
    // El disfraz no era inocuo: la pagina traduce `unauthenticated` a `notFound()`, asi que un
    // tropiezo de base se le contaba al mensajero como «esta pantalla no existe» —una respuesta
    // que miente y que ademas no ofrece reintentar, que es lo unico que lo resolvia—.
    const service = buildService({
      listarMisAsignaciones: vi.fn(async () => {
        throw baseAbortada();
      }),
    });
    const r = await listarMisAsignaciones({ service, getActor: actorMensajero });
    expect(r.status).not.toBe("unauthenticated");
  });

  it("listar: sin sesion SIGUE siendo `unauthenticated` (el caso nuevo no se lo come)", async () => {
    const r = await listarMisAsignaciones({ service: buildService(), getActor: noActor });
    expect(r.status).toBe("unauthenticated");
  });

  it("recoger: la base tropieza -> `error`, y la promesa RESUELVE", async () => {
    const service = buildService({
      recogerAsignaciones: vi.fn(async () => {
        throw baseAbortada();
      }),
    });
    const r = await recogerAsignaciones({ ordenIds: ["o1"] }, { service, getActor: actorMensajero });
    expect(r.status).toBe("error");
  });

  it("escoger: la base tropieza -> `error`, y la promesa RESUELVE", async () => {
    const service = buildService({
      escogerParaGestion: vi.fn(async () => {
        throw baseAbortada();
      }),
    });
    const r = await escogerParaGestion({ ordenId: "o1" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("error");
  });

  it("gestionar: la base tropieza -> `error`, y la promesa RESUELVE", async () => {
    // EL CASO DE PRODUCCION, con la evidencia ya subida y el mensajero en la puerta del cliente.
    const service = buildService({
      gestionar: vi.fn(async () => {
        throw baseAbortada();
      }),
    });
    const r = await gestionar(fdDevolucionValido(), { service, getActor: actorMensajero });
    expect(r.status).toBe("error");
  });

  it("liberar: la base tropieza -> `error`, y la promesa RESUELVE", async () => {
    const service = buildService({
      liberarGestion: vi.fn(async () => {
        throw baseAbortada();
      }),
    });
    const r = await liberarGestion({ ordenId: "o1" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("error");
  });

  it("el detalle tecnico NO viaja al cliente: ni el 25P02 ni el texto de Postgres", async () => {
    const service = buildService({
      gestionar: vi.fn(async () => {
        throw baseAbortada();
      }),
    });
    const r = await gestionar(fdDevolucionValido(), { service, getActor: actorMensajero });
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain("transaction is aborted");
    expect(serializado).not.toContain("25P02");
    // El desenlace es un objeto pelado: solo el discriminante.
    expect(r).toEqual({ status: "error" });
  });

  it("LA RED SIGUE PUESTA: un codigo que no deberia llegar sigue reventando", async () => {
    // FORBIDDEN por este camino es imposible —el service lo DEVUELVE, no lo lanza—, asi que si
    // aparece es que alguien cambio esa regla. Eso tiene que romper, no degradarse en silencio.
    // Sin este caso, «hacerle hueco a INTERNAL» seria indistinguible de borrar la red entera.
    const service = buildService({
      escogerParaGestion: vi.fn(async () => {
        throw new ForbiddenError();
      }),
    });
    await expect(
      escogerParaGestion({ ordenId: "o1" }, { service, getActor: actorMensajero }),
    ).rejects.toThrow(/AppErrorCode inesperado FORBIDDEN/);
  });
});
