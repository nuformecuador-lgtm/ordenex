import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { handleLiberarReprogramadas } from "@/app/api/cron/liberar-reprogramadas/route";
import type {
  ILiberacionReprogramadaService,
  LiberacionResult,
} from "@/lib/interfaces/services/ILiberacionReprogramadaService";

// Feature 46 (R6/R7/R19/R20) — Controller de la liberacion programada. Valida el
// CRON_SECRET (401 sin efectos), delega en el service (200 con resumen sin PII) y NUNCA
// loguea el secreto. Se inyecta el secreto + un service fake (sin DB ni entorno). Cubre
// tambien R8: la entrada de cron en vercel.json (path + schedule).

const SECRET = "s3cr3t-cron";

function fakeService(
  spy = vi.fn<(hoyCR: Date) => Promise<LiberacionResult>>(async () => ({
    evaluadas: 5,
    liberadas: 3,
    omitidas: 2,
  })),
): { service: ILiberacionReprogramadaService; spy: typeof spy } {
  return { service: { ejecutarLiberacion: spy }, spy };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/cron/liberar-reprogramadas", { method: "GET", headers });
}

describe("handleLiberarReprogramadas — autorizacion (R6)", () => {
  it("R6: sin header Authorization -> 401 SIN ejecutar la liberacion", async () => {
    const { service, spy } = fakeService();
    const res = await handleLiberarReprogramadas(req(), { getSecret: () => SECRET, service });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R6: token incorrecto -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();
    const res = await handleLiberarReprogramadas(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R6: secreto NO configurado (null) -> 401 aunque venga un token (endpoint no queda abierto)", async () => {
    const { service, spy } = fakeService();
    const res = await handleLiberarReprogramadas(req({ authorization: "Bearer whatever" }), {
      getSecret: () => null,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R7/R19: token correcto -> 200 con resumen SIN PII (solo conteos)", async () => {
    const { service, spy } = fakeService();
    const res = await handleLiberarReprogramadas(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    // FEATURE 276 (T6.2, R12/R13): el cuerpo gana `esperandoCierre`, el conteo AGREGADO de las
    // ordenes que se quedan quietas esperando que alguien apruebe su cierre. Es lo unico que hace
    // observable esa poblacion desde fuera, y sigue siendo un numero: sin PII (R38).
    expect(body).toEqual({ evaluadas: 5, liberadas: 3, omitidas: 2, esperandoCierre: 0 });
    // R19: el cuerpo NO filtra el secreto.
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("R9: pasa 'hoy CR' (medianoche UTC de la fecha CR) al service", async () => {
    const { service, spy } = fakeService();
    // 2026-07-15 00:30 CR == 2026-07-15T06:30:00Z -> hoy CR = 2026-07-15.
    const now = new Date("2026-07-15T06:30:00.000Z");
    await handleLiberarReprogramadas(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => now,
    });
    const hoyArg = spy.mock.calls[0][0] as Date;
    expect(hoyArg.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });
});

describe("handleLiberarReprogramadas — errores del service (R19)", () => {
  it("R19: si el service lanza, responde error controlado sin filtrar el secreto", async () => {
    const boom = vi.fn(async () => {
      throw new Error("db down");
    });
    const res = await handleLiberarReprogramadas(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service: { ejecutarLiberacion: boom },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
  });
});

// Feature 90 (R20/R27) — INVERSION del bloque heredado de la 46: la ruta
// /api/cron/liberar-reprogramadas dejo de tener un `schedule` propio en vercel.json (se
// migro al job recurrente `liberar_reprogramadas` drenado por /api/cron/procesar-jobs). La
// ruta se CONSERVA como disparo manual on-demand (R27, sus tests de auth/conteos arriba
// siguen validos), solo perdio su entrada temporal. La asercion positiva de procesar-jobs
// vive en procesar-jobs-route.test.ts (R20); aqui basta afirmar la AUSENCIA.
describe("R20/R27 — liberar-reprogramadas ya NO tiene schedule en vercel.json", () => {
  it("vercel.json NO define un cron para /api/cron/liberar-reprogramadas (migrado a job recurrente)", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", "vercel.json"), "utf8");
    const cfg = JSON.parse(raw) as { crons: { path: string; schedule: string }[] };
    const cron = cfg.crons.find((c) => c.path === "/api/cron/liberar-reprogramadas");
    expect(cron).toBeUndefined();
    // no rompe el cron existente de la feature 41: corte-diario sigue definido.
    expect(cfg.crons.find((c) => c.path === "/api/cron/corte-diario")).toBeDefined();
  });
});
