import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { handleGenerarGastosFijos } from "@/app/api/cron/generar-gastos-fijos/route";
import type {
  IGeneracionGastosFijosService,
  GeneracionGastosFijosResult,
} from "@/lib/interfaces/services/IGeneracionGastosFijosService";

// Feature 45 (R29/R30) — Controller del cron de gastos fijos. Valida el CRON_SECRET (401 sin
// efectos: ni construye el service ni toca la DB), delega en el service (200 con resumen sin
// PII) y NUNCA loguea el secreto. Se inyecta el secreto + un service fake (sin DB ni entorno).
// Cubre tambien el schedule en vercel.json (dia 1, 00:00 CR = 06:00 UTC).

const SECRET = "s3cr3t-cron";

function fakeService(
  spy = vi.fn<(now: Date) => Promise<GeneracionGastosFijosResult>>(async () => ({
    periodo: "2026-07",
    plantillasActivas: 3,
    egresosGenerados: 3,
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

  it("R29: token correcto -> 200 con resumen SIN PII (solo conteos + periodo)", async () => {
    const { service, spy } = fakeService();
    const res = await handleGenerarGastosFijos(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual({ periodo: "2026-07", plantillasActivas: 3, egresosGenerados: 3 });
    // R29: el cuerpo NO filtra el secreto.
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("R30: pasa `now` al service (que deriva el periodo YYYY-MM en hora CR)", async () => {
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

describe("schedule del cron en vercel.json (dia 1, 00:00 CR = 06:00 UTC)", () => {
  it("vercel.json define /api/cron/generar-gastos-fijos con schedule '0 6 1 * *'", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", "vercel.json"), "utf8");
    const cfg = JSON.parse(raw) as { crons: { path: string; schedule: string }[] };
    const cron = cfg.crons.find((c) => c.path === "/api/cron/generar-gastos-fijos");
    expect(cron).toBeDefined();
    expect(cron?.schedule).toBe("0 6 1 * *"); // dia 1 del mes, 00:00 CR
    // no rompe los crons existentes (41/46).
    expect(cfg.crons.find((c) => c.path === "/api/cron/corte-diario")).toBeDefined();
    // `liberar-reprogramadas` YA NO se agenda por su cuenta: la feature 90 lo
    // migro a la cola de jobs, que drena `/api/cron/procesar-jobs` cada minuto.
    // Se asevera ese cron en su lugar para que la guarda siga cubriendo "no
    // rompas los crons existentes" en vez de fijar un schedule ya eliminado.
    expect(cfg.crons.find((c) => c.path === "/api/cron/procesar-jobs")).toBeDefined();
  });
});
