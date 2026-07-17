import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { handleGenerarGastosFijos } from "@/app/api/cron/generar-gastos-fijos/route";
import type {
  IGeneracionGastosFijosService,
  GeneracionGastosFijosResult,
} from "@/lib/interfaces/services/IGeneracionGastosFijosService";

// Feature 45 + 84 (R29/R30) — Controller del cron de gastos fijos. Valida el CRON_SECRET (401 sin
// efectos: ni construye el service ni toca la DB), delega en el service (200 con resumen sin
// PII) y NUNCA loguea el secreto. Se inyecta el secreto + un service fake (sin DB ni entorno).
// Feature 84: el cron es DIARIO (`0 6 * * *`) y el body lleva conteos + la fecha CR de la corrida
// (ya no un unico `periodo`).

const SECRET = "s3cr3t-cron";

function fakeService(
  spy = vi.fn<(now: Date) => Promise<GeneracionGastosFijosResult>>(async () => ({
    fecha: "2026-07-15",
    plantillasActivas: 3,
    plantillasQueAplicanHoy: 2,
    egresosGenerados: 2,
  })),
): { service: IGeneracionGastosFijosService; spy: typeof spy } {
  return { service: { ejecutarGeneracion: spy }, spy };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/cron/generar-gastos-fijos", { method: "GET", headers });
}

describe("handleGenerarGastosFijos — autorizacion (R29)", () => {
  it("R29: sin header Authorization -> 401 SIN construir el service ni tocar la DB", async () => {
    const { service, spy } = fakeService();
    const res = await handleGenerarGastosFijos(req(), { getSecret: () => SECRET, service });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R29: token incorrecto -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();
    const res = await handleGenerarGastosFijos(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R29: secreto NO configurado (null) -> 401 aunque venga un token (endpoint no queda abierto)", async () => {
    const { service, spy } = fakeService();
    const res = await handleGenerarGastosFijos(req({ authorization: "Bearer whatever" }), {
      getSecret: () => null,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R29: token correcto -> 200 con resumen SIN PII (conteos + fecha CR)", async () => {
    const { service, spy } = fakeService();
    const res = await handleGenerarGastosFijos(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual({
      fecha: "2026-07-15",
      plantillasActivas: 3,
      plantillasQueAplicanHoy: 2,
      egresosGenerados: 2,
    });
    // R29: el cuerpo NO filtra el secreto.
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("R30: pasa `now` al service (que decide, en hora CR, que plantillas aplican hoy)", async () => {
    const { service, spy } = fakeService();
    const now = new Date("2026-07-01T06:30:00.000Z");
    await handleGenerarGastosFijos(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => now,
    });
    expect((spy.mock.calls[0][0] as Date).toISOString()).toBe("2026-07-01T06:30:00.000Z");
  });
});

describe("handleGenerarGastosFijos — errores del service (R29)", () => {
  it("R29: si el service lanza, responde error controlado sin filtrar el secreto", async () => {
    const boom = vi.fn(async () => {
      throw new Error("db down");
    });
    const res = await handleGenerarGastosFijos(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service: { ejecutarGeneracion: boom },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
  });
});

describe("schedule del cron en vercel.json (feature 84: DIARIO 00:00 CR = 06:00 UTC)", () => {
  it("vercel.json define /api/cron/generar-gastos-fijos con schedule DIARIO '0 6 * * *'", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", "vercel.json"), "utf8");
    const cfg = JSON.parse(raw) as { crons: { path: string; schedule: string }[] };
    const cron = cfg.crons.find((c) => c.path === "/api/cron/generar-gastos-fijos");
    expect(cron).toBeDefined();
    expect(cron?.schedule).toBe("0 6 * * *"); // feature 84: diario (el service filtra que aplica hoy)
    // no rompe los crons existentes (41/46).
    expect(cfg.crons.find((c) => c.path === "/api/cron/corte-diario")).toBeDefined();
    expect(cfg.crons.find((c) => c.path === "/api/cron/liberar-reprogramadas")).toBeDefined();
  });
});
