import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { handleCorteDiario } from "@/app/api/cron/corte-diario/route";
import type { ICorteDiarioService } from "@/lib/interfaces/services/ICorteDiarioService";

// Feature 41/C4/C5 (R5/R11/R24) — Controller del corte diario. Valida el CRON_SECRET
// (401 sin efectos), delega en el service (200 con resumen sin PII) y NUNCA loguea el
// secreto. Se inyecta el secreto + un service fake (sin DB ni entorno).

const SECRET = "s3cr3t-cron";

function fakeService(spy = vi.fn(async () => ({
  mensajerosEvaluados: 3,
  vencidosCreados: 2,
  mensajerosSinZona: 1,
}))): { service: ICorteDiarioService; spy: typeof spy } {
  return { service: { ejecutarCorte: spy }, spy };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/cron/corte-diario", { method: "GET", headers });
}

describe("handleCorteDiario — autorizacion (R5)", () => {
  it("R5: sin header Authorization -> 401 SIN ejecutar el corte", async () => {
    const { service, spy } = fakeService();
    const res = await handleCorteDiario(req(), { getSecret: () => SECRET, service });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R5: token incorrecto -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();
    const res = await handleCorteDiario(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R5: secreto NO configurado (null) -> 401 aunque venga un token (endpoint no queda abierto)", async () => {
    const { service, spy } = fakeService();
    const res = await handleCorteDiario(req({ authorization: "Bearer whatever" }), {
      getSecret: () => null,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R5/R24: token correcto -> 200 con resumen SIN PII (solo conteos expuestos)", async () => {
    const { service, spy } = fakeService();
    const res = await handleCorteDiario(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual({ vencidosCreados: 2, mensajerosEvaluados: 3 });
    // R24: el cuerpo NO filtra el secreto ni datos internos como mensajerosSinZona.
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body).not.toHaveProperty("mensajerosSinZona");
  });
});

describe("handleCorteDiario — errores del service (R24)", () => {
  it("R24: si el service lanza, responde error controlado sin filtrar el secreto", async () => {
    const boom = vi.fn(async () => {
      throw new Error("db down");
    });
    const res = await handleCorteDiario(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service: { ejecutarCorte: boom },
    });
    // withErrorHandler normaliza a un AppErrorShape (5xx), sin exponer el secreto.
    expect(res.status).toBeGreaterThanOrEqual(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
  });
});

describe("R11 — schedule del cron en vercel.json (00:00 CR = 06:00 UTC)", () => {
  it("vercel.json define el cron /api/cron/corte-diario con schedule '0 6 * * *'", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", "vercel.json"), "utf8");
    const cfg = JSON.parse(raw) as { crons: { path: string; schedule: string }[] };
    const cron = cfg.crons.find((c) => c.path === "/api/cron/corte-diario");
    expect(cron).toBeDefined();
    expect(cron?.schedule).toBe("0 6 * * *"); // 06:00 UTC = 00:00 America/Costa_Rica (UTC-6)
  });
});
