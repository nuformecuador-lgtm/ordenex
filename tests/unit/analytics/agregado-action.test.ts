import { describe, it, expect, vi } from "vitest";
import type { ErrorLogger } from "@/lib/errors/logger";
import { consultarAgregadoOperativo } from "@/lib/actions/analitica-operativa";
import { AHORA, MAESTRO, TIENDA, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 176 / T4.8 (segunda mitad) — R14, EN EL BORDE DEL AGREGADO.
//
// ⚠ ESTE TEST ESPIA EL LOGGER, NO EL STATUS, y el motivo esta verificado en el codigo de la
// 126 (`lib/actions/analitica-operativa.ts:38-42`): `normalizeError` devuelve la shape del
// `AppError` en su PRIMERA linea y solo llama a `logger.logError` en la rama del error
// DESCONOCIDO. Un borde que lanzara `ForbiddenError` y confiara en `withErrorHandler`
// responderia 403 correctamente y NO dejaria rastro: el 403 MUDO. Un test que mirase el
// status aprobaria a los dos.
//
// El agregado no estrena una segunda forma de responder 403: reusa el `denegar()` de la 126,
// que es justo lo que impide que exista una via de denegado que alguien olvide auditar.

function bordeCon(actor = MAESTRO) {
  const rollup = rollupFalso([cubo({ fecha: "2026-08-01", entregas: 3, devoluciones: 1 })]);
  const logError = vi.fn();
  const logger: ErrorLogger = { logError };
  return {
    rollup,
    logError,
    opciones: {
      service: servicioCon(rollup),
      logger,
      now: () => AHORA,
      getActor: async () => actor,
    },
  };
}

describe("R14 · el denegado del agregado se audita ANTES de responder", () => {
  it("un denegado se audita antes de responder forbidden y viaja sin datos ni motivo", async () => {
    // Un `adminTienda` pidiendo una metrica del dinero: `metrica_prohibida`, garantizado.
    const { rollup, logError, opciones } = bordeCon(TIENDA);
    const r = await consultarAgregadoOperativo(
      { metricaId: "egresos", raw: { rango: "dia" } },
      opciones,
    );

    // (1) EL RASTRO. Es la mitad que un test de status no ve.
    expect(logError).toHaveBeenCalledTimes(1);
    const registro = logError.mock.calls[0][0] as Record<string, unknown>;
    expect(registro.evento).toBe("analitica_denegado");
    expect(registro.motivo).toBe("metrica_prohibida");
    expect(registro.rol).toBe("adminTienda");
    expect(registro.usuarioId).toBe(TIENDA.usuarioId);

    // (2) LA RESPUESTA: sin datos y sin motivo. Nunca `ok` con ceros, nunca cubos vacios.
    expect(r).toEqual({ status: "forbidden" });
    expect(JSON.stringify(r)).not.toContain("metrica_prohibida");
    expect("datos" in r).toBe(false);

    // (3) Y el repositorio no se llego a tocar.
    expect(rollup.llamadasAgregar).toHaveLength(0);
  });

  it("sin sesion se deniega y se audita como `sin_sesion`", async () => {
    const logError = vi.fn();
    const rollup = rollupFalso([]);
    const r = await consultarAgregadoOperativo(
      { metricaId: "tasa_entrega", raw: { rango: "dia" } },
      {
        service: servicioCon(rollup),
        logger: { logError },
        now: () => AHORA,
        getActor: async () => null,
      },
    );
    expect(r).toEqual({ status: "forbidden" });
    expect((logError.mock.calls[0][0] as Record<string, unknown>).motivo).toBe("sin_sesion");
    expect(rollup.llamadasAgregar).toHaveLength(0);
  });

  it("una entrada invalida es `validation_error`, no toca la base y NO se audita", async () => {
    // No hay denegado que registrar: un filtro malformado no es un intento de acceso a datos
    // ajenos, y responder `forbidden` aqui permitiria sondear el catalogo.
    const { rollup, logError, opciones } = bordeCon();
    const r = await consultarAgregadoOperativo(
      { metricaId: "tasa_entrega", raw: { rango: "quincena" } },
      opciones,
    );
    expect(r.status).toBe("validation_error");
    expect(rollup.llamadasAgregar).toHaveLength(0);
    expect(logError).not.toHaveBeenCalled();
  });

  it("el camino feliz devuelve `ok` con el agregado y sin rastro en el logger", async () => {
    const { rollup, logError, opciones } = bordeCon();
    const r = await consultarAgregadoOperativo(
      { metricaId: "tasa_entrega", raw: { rango: "dia" }, grano: "semana" },
      opciones,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("no es ok");
    expect(r.datos.metricaId).toBe("tasa_entrega");
    // El grano pedido llega hasta el servicio y viaja de vuelta declarado.
    expect(r.datos.grano).toBe("semana");
    expect(rollup.llamadasAgregar).toHaveLength(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it("y la desagregacion pedida llega al servicio como grano del repositorio", async () => {
    const { rollup, opciones } = bordeCon();
    await consultarAgregadoOperativo(
      { metricaId: "tasa_entrega", raw: { rango: "dia" }, desagregacion: "zona" },
      opciones,
    );
    expect(rollup.llamadasAgregar[0].granos).toEqual(["zona"]);
  });
});
