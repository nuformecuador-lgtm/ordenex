import { describe, it, expect, vi } from "vitest";
import {
  crearLiberarReprogramadasHandler,
  recurrenciaLiberarReprogramadas,
  proximaCorridaLiberarCR,
  dedupeKeyLiberar,
} from "@/lib/services/jobs/liberar-reprogramadas-handler";
import { startOfDayCR } from "@/lib/utils/fecha-cr";
import type { ILiberacionReprogramadaService } from "@/lib/interfaces/services/ILiberacionReprogramadaService";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

// Feature 90 (R22/R23) — el handler DELEGA en `ejecutarLiberacion` (no reimplementa la
// clasificacion de bodega) y la recurrencia preserva 00:00 America/Costa_Rica (gate F1.4-1).

const job: JobDTO = {
  id: "j1",
  tipo: "liberar_reprogramadas",
  payload: {},
  estado: "processing",
  intentos: 1,
  maxIntentos: 5,
  runAfter: new Date(),
  lockedAt: new Date(),
  lastError: null,
  dedupeKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("crearLiberarReprogramadasHandler (R22)", () => {
  it("invoca ejecutarLiberacion UNA vez con startOfDayCR(now)", async () => {
    const now = new Date("2026-07-19T18:00:00.000Z"); // 12:00 CR del 19
    const spy = vi.fn(async () => ({ evaluadas: 2, liberadas: 2, omitidas: 0 }));
    const service: ILiberacionReprogramadaService = { ejecutarLiberacion: spy };
    const handler = crearLiberarReprogramadasHandler(service, () => now);

    await handler(job);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(startOfDayCR(now));
  });
});

describe("proximaCorridaLiberarCR — preserva 00:00 CR = 06:00 UTC (gate F1.4-1)", () => {
  it("desde el 19 CR agenda el 20 a las 06:00 UTC (00:00 CR del 20)", () => {
    // 2026-07-19T18:00Z = 12:00 CR del 19 -> proxima = 2026-07-20T06:00Z
    const next = proximaCorridaLiberarCR(new Date("2026-07-19T18:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-07-20T06:00:00.000Z");
  });

  it("justo tras 00:00 CR (06:00 UTC) del 19 -> proxima es el 20 (no re-agenda hoy)", () => {
    const next = proximaCorridaLiberarCR(new Date("2026-07-19T06:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-07-20T06:00:00.000Z");
  });

  it("cruce de fin de mes: 31 jul CR -> 1 ago 06:00 UTC", () => {
    const next = proximaCorridaLiberarCR(new Date("2026-07-31T18:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-08-01T06:00:00.000Z");
  });
});

describe("recurrenciaLiberarReprogramadas.siguiente (R23)", () => {
  it("dedupe_key es de la fecha CALENDARIO CR de la proxima corrida", () => {
    const now = new Date("2026-07-19T18:00:00.000Z");
    const { runAfter, dedupeKey } = recurrenciaLiberarReprogramadas.siguiente(now);
    expect(runAfter.toISOString()).toBe("2026-07-20T06:00:00.000Z");
    expect(dedupeKey).toBe("liberar_reprogramadas:2026-07-20");
    // coherencia con el helper de clave
    expect(dedupeKey).toBe(dedupeKeyLiberar(runAfter));
  });
});
