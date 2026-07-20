import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { handleProcesarJobs } from "@/app/api/cron/procesar-jobs/route";
import type { IJobQueueService, DrenarResult } from "@/lib/interfaces/services/IJobQueueService";

// Feature 90 (R17/R18/R19/R20) — Controller del drenador de la cola. Valida el CRON_SECRET
// (401 sin efectos), delega en el service (200 con conteos sin PII) y NUNCA loguea el
// secreto. Se inyecta el secreto + un service fake (sin DB ni entorno). Clon estructural de
// `corte-diario-route.test.ts`.

const SECRET = "s3cr3t-cron";

const CONTEOS: DrenarResult = {
  procesados: 4,
  ok: 2,
  fallidos: 1,
  reintentados: 1,
  muertos: 0,
};

function fakeService(spy = vi.fn(async () => CONTEOS)): {
  service: IJobQueueService;
  spy: typeof spy;
} {
  return { service: { drenar: spy }, spy };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/cron/procesar-jobs", { method: "GET", headers });
}

describe("handleProcesarJobs — autorizacion (R17)", () => {
  it("R17: sin header Authorization -> 401 SIN drenar", async () => {
    const { service, spy } = fakeService();
    const res = await handleProcesarJobs(req(), { getSecret: () => SECRET, service });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R17: token incorrecto -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();
    const res = await handleProcesarJobs(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("R17: secreto NO configurado (null) -> 401 aunque venga token (endpoint no abierto)", async () => {
    const { service, spy } = fakeService();
    const res = await handleProcesarJobs(req({ authorization: "Bearer whatever" }), {
      getSecret: () => null,
      service,
    });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("handleProcesarJobs — drenado (R18)", () => {
  it("R18: token correcto -> 200 con conteos agregados SIN PII", async () => {
    const { service, spy } = fakeService();
    const res = await handleProcesarJobs(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual(CONTEOS);
    // R18/R19: el cuerpo no filtra el secreto ni expone claves de dominio/PII.
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET);
    expect(Object.keys(body).sort()).toEqual(
      ["fallidos", "muertos", "ok", "procesados", "reintentados"],
    );
  });
});

describe("handleProcesarJobs — errores del service (R19)", () => {
  it("R19: si el service lanza, responde error controlado (>=500) sin filtrar el secreto", async () => {
    const boom = vi.fn(async () => {
      throw new Error("db down");
    });
    const res = await handleProcesarJobs(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service: { drenar: boom },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
  });
});

describe("R20 — crons en vercel.json (drenado cada minuto; liberar-reprogramadas sin schedule)", () => {
  const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", "vercel.json"), "utf8");
  const cfg = JSON.parse(raw) as { crons: { path: string; schedule: string }[] };

  it("R20: /api/cron/procesar-jobs presente con schedule '* * * * *'", () => {
    const cron = cfg.crons.find((c) => c.path === "/api/cron/procesar-jobs");
    expect(cron).toBeDefined();
    expect(cron?.schedule).toBe("* * * * *");
  });

  it("R20/R27: /api/cron/liberar-reprogramadas YA NO figura en crons (pierde su schedule)", () => {
    const cron = cfg.crons.find((c) => c.path === "/api/cron/liberar-reprogramadas");
    expect(cron).toBeUndefined();
  });

  it("conserva corte-diario y generar-gastos-fijos (fuera de alcance)", () => {
    expect(cfg.crons.some((c) => c.path === "/api/cron/corte-diario")).toBe(true);
    expect(cfg.crons.some((c) => c.path === "/api/cron/generar-gastos-fijos")).toBe(true);
  });
});
