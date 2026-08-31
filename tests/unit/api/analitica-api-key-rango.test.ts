import { describe, it, expect } from "vitest";

import { resolverRangoApiKey } from "@/lib/api/analitica-api-key-rango";
import { resolverMetricasPedidas } from "@/lib/api/analitica-api-key-metricas";
import { HORIZONTE_HISTORIAL_CR } from "@/lib/analytics/backfill-rango";
import { METRICAS_API_KEY, METRICAS_TODAS } from "@/lib/analytics/publicacion-api-key";

// 2026-08-31 — LO QUE SIGNIFICA NO MANDAR UN PARAMETRO en `GET /api/ordenes/api-key/analitica`.
//
// Los tres parametros del endpoint (`metricas`, `desde`, `hasta`) pasaron a ser opcionales. Que
// significa cada ausencia es una decision de CONTRATO, y este archivo la fija en aislado —sin
// HTTP, sin auth y sin servicio— para que se pueda leer de un vistazo. El recorrido HTTP de los
// mismos casos vive en `analitica-api-key-route.test.ts`.

/** Reloj congelado: 15:00 UTC son las 09:00 en Costa Rica, asi que el dia CR es el 3. */
const AHORA = new Date("2026-08-03T15:00:00.000Z");

describe("resolverRangoApiKey · las fechas que el integrador no manda", () => {
  it("lo que SI llega no se toca, ni siquiera un poco", () => {
    expect(resolverRangoApiKey({ desde: "2026-08-01", hasta: "2026-08-03" }, AHORA)).toEqual({
      desde: "2026-08-01",
      hasta: "2026-08-03",
    });
  });

  it("sin `hasta`: hoy en hora de Costa Rica, no la fecha UTC del instante", () => {
    // El caso que distingue las dos convenciones: 2026-08-04T02:00Z son todavia las 20:00 del
    // dia 3 en Costa Rica. Un `toISOString().slice(0, 10)` habria dicho el 4.
    const casiMedianocheUtc = new Date("2026-08-04T02:00:00.000Z");
    expect(resolverRangoApiKey({ desde: "2026-08-01" }, casiMedianocheUtc).hasta).toBe(
      "2026-08-03",
    );
  });

  it("sin `desde`: el horizonte del historial, tomado de la constante y no de un literal", () => {
    expect(resolverRangoApiKey({ hasta: "2026-08-01" }, AHORA)).toEqual({
      desde: HORIZONTE_HISTORIAL_CR,
      hasta: "2026-08-01",
    });
  });

  it("sin nada: el historico completo, del horizonte a hoy", () => {
    expect(resolverRangoApiKey({}, AHORA)).toEqual({
      desde: HORIZONTE_HISTORIAL_CR,
      hasta: "2026-08-03",
    });
  });

  it("un `hasta` anterior al horizonte NO fabrica un rango invertido", () => {
    // Con el horizonte como default fijo, esto saldria `desde: 2026-07-13, hasta: 2026-01-15`, y
    // el filtro de la 135 lo rechazaria con un 422 de «rango invertido» a quien no mando ningun
    // `desde`. El limite inferior cede al superior: no hay nada que contar antes del horizonte.
    expect(resolverRangoApiKey({ hasta: "2026-01-15" }, AHORA)).toEqual({
      desde: "2026-01-15",
      hasta: "2026-01-15",
    });
  });

  it("un rango invertido ESCRITO por el integrador se conserva invertido: no se corrige aqui", () => {
    // Este modulo COMPLETA, no arregla. Darle la vuelta al rango convertiria un error del cliente
    // en una respuesta plausible que no es la que pidio; el 422 es del filtro de la 135.
    expect(resolverRangoApiKey({ desde: "2026-08-10", hasta: "2026-08-01" }, AHORA)).toEqual({
      desde: "2026-08-10",
      hasta: "2026-08-01",
    });
  });
});

describe("resolverMetricasPedidas · `metricas` vacio es `all`", () => {
  it("la cadena vacia y la de solo espacios sirven la lista blanca entera", () => {
    for (const valor of ["", "   "]) {
      expect(resolverMetricasPedidas(valor), valor).toEqual({ ok: true, ids: [...METRICAS_API_KEY] });
    }
  });

  it("y da EXACTAMENTE lo mismo que `all` explicito, que no se retira", () => {
    expect(resolverMetricasPedidas("")).toEqual(resolverMetricasPedidas(METRICAS_TODAS));
  });

  it("pero un hueco DENTRO de la lista sigue siendo un rechazo", () => {
    // Vacio ENTERO es «no pedi nada»; vacio EN MEDIO es una lista mal escrita. Son dos cosas
    // distintas y solo una de ellas se adivina.
    for (const valor of ["entregas,,devoluciones", ",", "entregas,"]) {
      expect(resolverMetricasPedidas(valor).ok, valor).toBe(false);
    }
  });
});
