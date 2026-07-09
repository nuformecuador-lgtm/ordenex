import { describe, it, expect, afterEach } from "vitest";

const ENV_KEYS = [
  "AUTH_MAX_FAILED_ATTEMPTS",
  "AUTH_LOCKOUT_MINUTES",
  "AUTH_SESSION_TTL_HOURS",
  "AUTH_OTP_TTL_MINUTES",
  "AUTH_RISK_THRESHOLD",
  "AUTH_ID_MIN_LENGTH",
  "AUTH_ID_MAX_LENGTH",
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("lib/config/auth", () => {
  afterEach(() => {
    clearEnv();
  });

  it("usa los valores por defecto cuando no hay overrides de entorno", async () => {
    clearEnv();
    const { loadAuthConfig } = await import("@/lib/config/auth");
    const config = loadAuthConfig();
    expect(config.MAX_FAILED_ATTEMPTS).toBe(5);
    expect(config.LOCKOUT_MINUTES).toBe(15);
    expect(config.SESSION_TTL_HOURS).toBe(24);
  });

  it("lee overrides validos desde variables de entorno", async () => {
    process.env.AUTH_MAX_FAILED_ATTEMPTS = "3";
    process.env.AUTH_LOCKOUT_MINUTES = "30";
    process.env.AUTH_RISK_THRESHOLD = "70";
    const { loadAuthConfig } = await import("@/lib/config/auth");
    const config = loadAuthConfig();
    expect(config.MAX_FAILED_ATTEMPTS).toBe(3);
    expect(config.LOCKOUT_MINUTES).toBe(30);
    expect(config.RISK_THRESHOLD).toBe(70);
  });

  it("ignora overrides invalidos y cae al valor por defecto", async () => {
    process.env.AUTH_MAX_FAILED_ATTEMPTS = "no-es-un-numero";
    const { loadAuthConfig } = await import("@/lib/config/auth");
    const config = loadAuthConfig();
    expect(config.MAX_FAILED_ATTEMPTS).toBe(5);
  });
});
