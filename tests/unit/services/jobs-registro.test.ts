import { describe, it, expect } from "vitest";
import { buildHandlers, buildRecurrencias } from "@/app/api/cron/procesar-jobs/route";

// Feature 128 / T6.3 — R14 (mitad de REGISTRO).
//
// Un handler que no esta en `buildHandlers` no es un handler: el job encolado por el backfill
// se quedaria `pending` para siempre y la cache seguiria sirviendo las cifras ANTERIORES al
// recomputo hasta que expirase el TTL. Nada falla; el numero se queda quieto.
//
// Y el reverso, que es igual de importante: el tipo NO debe estar en `buildRecurrencias`. Es
// PUNTUAL —lo dispara una corrida de backfill—, como `geocodificacion` o `webhook_estado`.
// Registrarlo alli lo re-agendaria para siempre y vaciaria la cache operativa cada minuto, que
// es justo lo contrario de lo que esta feature compra.
//
// `buildHandlers` construye los servicios reales, pero `getPrismaClient()` es un singleton
// PEREZOSO: llamarlo no abre conexion, asi que esto corre sin `DATABASE_URL` (patron ya usado
// por `tests/unit/api/procesar-jobs-registro.test.ts`).

const AHORA = new Date("2026-08-03T15:00:00.000Z");

describe("R14 · el tipo `analitica_invalidacion_cache` tiene handler registrado", () => {
  it("`buildHandlers` lo incluye", () => {
    expect(
      buildHandlers(() => AHORA).has("analitica_invalidacion_cache"),
      "sin handler registrado, el job que encola el backfill se queda `pending` para siempre " +
        "y el tablero sigue sirviendo las cifras anteriores al recomputo, sin senal.",
    ).toBe(true);
  });

  it("sin perder ninguno de los que ya habia", () => {
    const handlers = buildHandlers(() => AHORA);
    for (const tipo of [
      "liberar_reprogramadas",
      "geocodificacion",
      "optimizacion_ruta",
      "webhook_estado",
      "whatsapp_template_sync",
      "whatsapp_chat_envio",
      "analitica_rollup_diario",
    ] as const) {
      expect(handlers.has(tipo), `se perdio el handler de ${tipo}`).toBe(true);
    }
  });

  it("construir el registro no abre conexion ni lanza", () => {
    expect(() => buildHandlers(() => AHORA)).not.toThrow();
  });
});

describe("R14 · y NO es recurrente", () => {
  it("`buildRecurrencias` no lo lleva: es puntual, disparado por un evento", () => {
    const recurrencias = buildRecurrencias();
    expect(
      recurrencias.has("analitica_invalidacion_cache"),
      "registrarlo como recurrente re-agendaria un job puntual y vaciaria la cache operativa " +
        "cada minuto.",
    ).toBe(false);
    // Los dos que SI lo son siguen estandolo.
    expect([...recurrencias.keys()].sort()).toEqual([
      "analitica_rollup_diario",
      "liberar_reprogramadas",
    ]);
  });
});
