import { describe, it, expect, vi } from "vitest";

import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import { consultarConteoCargadasPorDia } from "@/lib/actions/conteo-cargadas-por-dia";
import type { ConteoCargadasPorDiaDTO } from "@/lib/types/conteo-cargadas";

// El borde de la TERCERA lectura de la pantalla. Recorre los mismos cuatro pasos que las otras
// dos y REUSA `prepararConteoEntregas`: no es parecido, es el mismo código. Duplicar aquí el
// resolutor de alcance sería abrir una tercera puerta a la misma frontera multi-tenant.

const AHORA = new Date("2026-08-17T12:00:00.000Z");

const DATOS: ConteoCargadasPorDiaDTO = {
  porDia: [
    { fecha: "2026-08-16", conteo: 7 },
    { fecha: "2026-08-17", conteo: 3 },
  ],
  total: 10,
  lastSync: "2026-08-17T12:00:00.000Z",
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

describe("El borde de cargadas por día — el camino feliz", () => {
  it("devuelve la serie y su total", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect(await consultarConteoCargadasPorDia({}, d)).toEqual({ status: "ok", datos: DATOS });
  });

  it("acepta las MISMAS siete facetas que las otras dos lecturas", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarConteoCargadasPorDia(
      {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-16",
        zona_id: ["z1"],
        provincia_id: ["p1"],
        canton_id: ["c1"],
        distrito_id: ["d1"],
        tienda_id: ["t1"],
        mensajero_id: ["m1"],
      },
      d,
    );

    expect(res.status).toBe("ok");
    expect(service.consultar).toHaveBeenCalledTimes(1);
  });

  it("el servicio recibe la consulta YA recortada por el alcance", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    await consultarConteoCargadasPorDia({}, d);

    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      alcance: { tipo: "tienda", tiendaId: "u1" },
      filtro: { tienda_id: ["u1"] },
    });
  });
});

describe("El borde de cargadas por día — quién NO pasa", () => {
  it("un filtro inválido no toca el servicio ni el log", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "u1", rol: "maestro" });

    expect((await consultarConteoCargadasPorDia({ rango: "trimestre" }, d)).status).toBe(
      "validation_error",
    );
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError).not.toHaveBeenCalled();
  });

  // ⚠ La trampa heredada de la 126: `normalizeError` sólo llama al logger en la rama del error
  // DESCONOCIDO, así que lanzar un `ForbiddenError` daría un 403 MUDO. Por eso este caso espía
  // el LOGGER y no el status.
  it("el mensajero es `forbidden` y queda AUDITADO, con su propio nombre", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "m1", rol: "mensajero" });

    expect(await consultarConteoCargadasPorDia({}, d)).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError.mock.calls[0]?.[0]).toMatchObject({
      evento: "analitica_denegado",
      motivo: "metrica_prohibida",
      // Distinto al de las otras dos acciones: si compartieran nombre, una denegación no diría
      // cuál de las tres puertas se tocó.
      metricaId: "conteo_cargadas_por_dia",
    });
  });

  it("sin sesión es `unauthenticated`, no `forbidden`", async () => {
    const { deps: d } = deps(null);

    expect(await consultarConteoCargadasPorDia({}, d)).toEqual({ status: "unauthenticated" });
  });

  it("pedir datos ajenos es `forbidden` y no una serie vacía", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    const res = await consultarConteoCargadasPorDia({ tienda_id: ["otra"] }, d);

    expect(res).toEqual({ status: "forbidden" });
    expect(res).not.toHaveProperty("datos");
    expect(service.consultar).not.toHaveBeenCalled();
  });
});
