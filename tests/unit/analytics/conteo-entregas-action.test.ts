import { describe, it, expect, vi } from "vitest";

import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import { consultarConteoEntregas } from "@/lib/actions/conteo-entregas";
import type { ConteoEntregasDTO } from "@/lib/types/conteo-entregas";

const AHORA = new Date("2026-08-17T12:00:00.000Z");

const DATOS: ConteoEntregasDTO = {
  porDesenlace: { entregada: 20, devuelta: 5, rechazada: 3, reprogramada: 7, incidente: 1, otros: 64 },
  total: 100,
  lastSync: "2026-08-17T12:00:00.000Z",
};

function deps(actor: unknown) {
  const service = { consultar: vi.fn(async (_consulta: ConsultaConteoEntregas) => DATOS) };
  const logger = { logError: vi.fn() };
  return {
    deps: {
      service,
      logger,
      getActor: async () => actor as never,
      now: () => AHORA,
    },
    service,
    logger,
  };
}

describe("El borde del conteo — el camino feliz", () => {
  it("devuelve las tres cifras y el sello", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect(await consultarConteoEntregas({ rango: "semana" }, d)).toEqual({
      status: "ok",
      datos: DATOS,
    });
  });

  it("el servicio recibe la consulta YA recortada por el alcance", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    await consultarConteoEntregas({ rango: "semana" }, d);

    expect(service.consultar).toHaveBeenCalledTimes(1);
    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      alcance: { tipo: "tienda", tiendaId: "u1" },
      filtro: { tienda_id: ["u1"] },
    });
  });
});

describe("El borde del conteo — el orden de los pasos", () => {
  // Un filtro malformado se devuelve SIN consultar: el servicio recibe CERO llamadas. Y sin
  // auditar, porque no hay denegado que registrar — y una entrada malformada tampoco puede
  // servir para sondear el modelo de permisos.
  it("un filtro inválido no toca el servicio ni el log", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarConteoEntregas({ rango: "trimestre" }, d);

    expect(res.status).toBe("validation_error");
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError).not.toHaveBeenCalled();
  });

  // Y con el filtro roto, el resultado es el MISMO sin sesión: si el orden se invirtiera, la
  // respuesta delataría si el actor existe.
  it("un filtro inválido es `validation_error` también sin sesión", async () => {
    const { deps: d } = deps(null);
    expect((await consultarConteoEntregas({ rango: "trimestre" }, d)).status).toBe(
      "validation_error",
    );
  });
});

describe("El borde del conteo — quién NO pasa", () => {
  // ⚠ La trampa heredada de la 126: `normalizeError` sólo llama al logger en la rama del
  // error DESCONOCIDO, así que lanzar un `ForbiddenError` daría un 403 MUDO. Por eso este
  // caso espía el LOGGER y no el status.
  it("el mensajero es `forbidden`, y queda AUDITADO", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "m1", rol: "mensajero" });

    const res = await consultarConteoEntregas({ rango: "semana" }, d);

    expect(res).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect(logger.logError.mock.calls[0]?.[0]).toMatchObject({
      evento: "analitica_denegado",
      motivo: "metrica_prohibida",
      rol: "mensajero",
    });
  });

  // «No puedes» y «no sabemos quién eres» piden cosas distintas del usuario: una se arregla
  // volviendo a entrar y la otra no.
  it("sin sesión es `unauthenticated`, no `forbidden`", async () => {
    const { deps: d, logger } = deps(null);

    expect(await consultarConteoEntregas({ rango: "semana" }, d)).toEqual({
      status: "unauthenticated",
    });
    expect(logger.logError).toHaveBeenCalledTimes(1);
  });

  it("pedir datos ajenos es `forbidden` y no un resultado vacío", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    const res = await consultarConteoEntregas({ rango: "semana", tienda_id: ["otra"] }, d);

    expect(res).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
  });

  // NUNCA `ok` con ceros ante un denegado: la pantalla tiene que poder distinguir «prohibido»
  // de «no hubo entregas», que son dos hechos distintos.
  it.each([
    ["mensajero", { usuarioId: "m1", rol: "mensajero" }],
    ["apiKey", { usuarioId: "k1", rol: "apiKey" }],
    ["rol inventado", { usuarioId: "x1", rol: "root" }],
    ["adminSatelite sin zona", { usuarioId: "s1", rol: "adminSatelite", zonaId: null }],
  ])("«%s» no recibe ninguna cifra", async (_caso, actor) => {
    const { deps: d } = deps(actor);
    const res = await consultarConteoEntregas({ rango: "semana" }, d);
    expect(res).not.toHaveProperty("datos");
  });

  // El motivo va al LOG, no al cliente: sería una pista sobre el modelo de permisos.
  it("el motivo concreto no viaja al cliente", async () => {
    const { deps: d } = deps({ usuarioId: "s1", rol: "adminSatelite", zonaId: null });
    expect(await consultarConteoEntregas({ rango: "semana" }, d)).toEqual({ status: "forbidden" });
  });
});
