import { describe, it, expect, afterEach } from "vitest";
import { loadJobsConfig } from "@/lib/config/jobs";

// Feature 90 (R21) — `loadJobsConfig()` lee cada env con defaults sensatos; ausente/invalido
// cae al default (nada se hardcodea en el codigo de negocio). El secreto NO vive aqui
// (reutiliza CRON_SECRET via loadCronConfig).

const ENVS = [
  "JOBS_BATCH_SIZE",
  "JOBS_MAX_ATTEMPTS",
  "JOBS_BACKOFF_BASE_MS",
  "JOBS_BACKOFF_CAP_MS",
  "JOBS_VISIBILITY_TIMEOUT_MS",
] as const;

afterEach(() => {
  for (const name of ENVS) delete process.env[name];
});

describe("loadJobsConfig — defaults (R21)", () => {
  it("sin ninguna env, aplica los defaults documentados", () => {
    const cfg = loadJobsConfig();
    expect(cfg).toEqual({
      JOBS_BATCH_SIZE: 10,
      JOBS_MAX_ATTEMPTS: 5,
      JOBS_BACKOFF_BASE_MS: 60_000,
      JOBS_BACKOFF_CAP_MS: 3_600_000,
      JOBS_VISIBILITY_TIMEOUT_MS: 3_600_000,
    });
  });

  it("R21: el visibility timeout por defecto es 1 h (3_600_000 ms)", () => {
    expect(loadJobsConfig().JOBS_VISIBILITY_TIMEOUT_MS).toBe(3_600_000);
  });
});

describe("loadJobsConfig — lectura de env (R21)", () => {
  it("lee cada env cuando esta presente y es un entero positivo", () => {
    process.env.JOBS_BATCH_SIZE = "25";
    process.env.JOBS_MAX_ATTEMPTS = "3";
    process.env.JOBS_BACKOFF_BASE_MS = "1000";
    process.env.JOBS_BACKOFF_CAP_MS = "7200000";
    process.env.JOBS_VISIBILITY_TIMEOUT_MS = "1800000";
    expect(loadJobsConfig()).toEqual({
      JOBS_BATCH_SIZE: 25,
      JOBS_MAX_ATTEMPTS: 3,
      JOBS_BACKOFF_BASE_MS: 1000,
      JOBS_BACKOFF_CAP_MS: 7_200_000,
      JOBS_VISIBILITY_TIMEOUT_MS: 1_800_000,
    });
  });

  it("un valor invalido, vacio o no positivo cae al default", () => {
    process.env.JOBS_BATCH_SIZE = "abc";
    process.env.JOBS_MAX_ATTEMPTS = "";
    process.env.JOBS_BACKOFF_BASE_MS = "0";
    process.env.JOBS_BACKOFF_CAP_MS = "-5";
    const cfg = loadJobsConfig();
    expect(cfg.JOBS_BATCH_SIZE).toBe(10);
    expect(cfg.JOBS_MAX_ATTEMPTS).toBe(5);
    expect(cfg.JOBS_BACKOFF_BASE_MS).toBe(60_000);
    expect(cfg.JOBS_BACKOFF_CAP_MS).toBe(3_600_000);
  });
});
