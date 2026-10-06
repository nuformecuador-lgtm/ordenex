import { describe, it, expect } from "vitest";
import { buildHandlers, buildRecurrencias } from "@/app/api/cron/procesar-jobs/route";

// Ficha 474 (T8.2, R22) — los cinco tipos de los envios por WhatsApp estan enganchados al drenador
// (que corre cada minuto: R22, «en los 2 minutos siguientes» sin un cron propio por envio), y SOLO
// el mantenimiento es recurrente, con la proxima corrida a las 09:30 UTC (03:30 CR).

const AHORA = new Date("2026-10-05T12:00:00.000Z");

describe("474/R22 — registro en el drenador", () => {
  it("buildHandlers registra los cinco tipos", () => {
    const h = buildHandlers(() => AHORA);
    for (const t of [
      "whatsapp_envio_programado",
      "whatsapp_envio_evento",
      "whatsapp_envio_ejecucion",
      "whatsapp_envio_reintento",
      "whatsapp_envio_mantenimiento",
    ] as const) {
      expect(h.has(t), t).toBe(true);
    }
  });

  it("solo el mantenimiento es recurrente, a las 09:30 UTC del dia siguiente si ya paso", () => {
    const r = buildRecurrencias();
    expect(r.has("whatsapp_envio_programado")).toBe(false);
    expect(r.has("whatsapp_envio_evento")).toBe(false);
    expect(r.has("whatsapp_envio_ejecucion")).toBe(false);
    expect(r.has("whatsapp_envio_reintento")).toBe(false);
    const sig = r.get("whatsapp_envio_mantenimiento")?.siguiente(AHORA);
    expect(sig).toEqual({
      runAfter: new Date("2026-10-06T09:30:00.000Z"),
      dedupeKey: "whatsapp_envio_mantenimiento:2026-10-06",
    });
    expect(r.get("whatsapp_envio_mantenimiento")?.siguiente(new Date("2026-10-05T08:00:00.000Z")).runAfter).toEqual(
      new Date("2026-10-05T09:30:00.000Z"),
    );
  });
});
