import { describe, it, expect, vi } from "vitest";

import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import { consultarConteoHoyGestion } from "@/lib/actions/conteo-hoy-gestion";
import type { ConteoHoyGestionDTO } from "@/lib/types/conteo-hoy-gestion";

// El borde de la CUARTA lectura de la pantalla. Recorre los mismos cuatro pasos que las otras
// tres y REUSA `prepararConteoEntregas`: no es parecido, es el mismo código.

const AHORA = new Date("2026-08-18T12:00:00.000Z");

const DATOS: ConteoHoyGestionDTO = {
  sinGestion: 12,
  conGestion: 30,
  total: 42,
  fecha: "2026-08-18",
  lastSync: "2026-08-18T12:00:00.000Z",
};

function deps(actor: unknown) {
  const service = { consultar: vi.fn(async (_c: ConsultaConteoEntregas) => DATOS) };
  const logger = { logError: vi.fn() };
  return {
    deps: { service, logger, getActor: async () => actor as never, now: () => AHORA },
    service,
    logger,
  };
}

describe("El borde de cargadas hoy — el camino feliz", () => {
  it("devuelve las dos cifras, su total y el día contado", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect(await consultarConteoHoyGestion({}, d)).toEqual({ status: "ok", datos: DATOS });
  });

  it("el servicio recibe la consulta YA recortada por el alcance", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    await consultarConteoHoyGestion({}, d);

    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      alcance: { tipo: "tienda", tiendaId: "u1" },
      filtro: { tienda_id: ["u1"] },
    });
  });

  // ⚠ EL FILTRO SE VALIDA ENTERO aunque esta lectura ignore la ventana y el mensajero. Aceptar
  // aquí un `rango` que las otras tres rechazan haría que la misma barra diera error en tres
  // gráficas y no en la cuarta, que es un síntoma imposible de diagnosticar.
  it("un `rango` inválido se rechaza aunque esta lectura no use la ventana", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "u1", rol: "maestro" });

    expect((await consultarConteoHoyGestion({ rango: "trimestre" }, d)).status).toBe(
      "validation_error",
    );
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError).not.toHaveBeenCalled();
  });

  // Y una ventana VÁLIDA se acepta y viaja: quien decide ignorarla es el servicio, no el borde.
  // Si el borde la recortara, el filtro dejaría de ser el mismo para las cuatro lecturas.
  it("una ventana válida pasa: ignorarla es cosa del servicio, no del borde", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarConteoHoyGestion(
      { rango: "personalizado", desde: "2026-08-01", hasta: "2026-08-16", mensajero_id: ["m1"] },
      d,
    );

    expect(res.status).toBe("ok");
    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      filtro: { rango: "personalizado", mensajero_id: ["m1"] },
    });
  });
});

describe("El borde de cargadas hoy — quién NO pasa", () => {
  // ⚠ La trampa heredada de la 126: `normalizeError` sólo llama al logger en la rama del error
  // DESCONOCIDO, así que lanzar un `ForbiddenError` daría un 403 MUDO. Este caso espía el
  // LOGGER, no el status.
  it("el mensajero es `forbidden` y queda AUDITADO, con su propio nombre", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "m1", rol: "mensajero" });

    expect(await consultarConteoHoyGestion({}, d)).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError.mock.calls[0]?.[0]).toMatchObject({
      evento: "analitica_denegado",
      motivo: "metrica_prohibida",
      // Distinto al de las otras tres: si compartieran nombre, una denegación no diría cuál de
      // las cuatro puertas se tocó.
      metricaId: "conteo_hoy_gestion",
    });
  });

  it("sin sesión es `unauthenticated`, no `forbidden`", async () => {
    const { deps: d } = deps(null);

    expect(await consultarConteoHoyGestion({}, d)).toEqual({ status: "unauthenticated" });
  });

  it("pedir datos ajenos es `forbidden` y no dos ceros", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    const res = await consultarConteoHoyGestion({ tienda_id: ["otra"] }, d);

    expect(res).toEqual({ status: "forbidden" });
    expect(res).not.toHaveProperty("datos");
    expect(service.consultar).not.toHaveBeenCalled();
  });
});
