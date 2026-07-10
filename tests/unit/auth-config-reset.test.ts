import { describe, it, expect, afterEach } from "vitest";

// Feature 20 / R15, R19, R20: constantes de rate-limit configurables por env.

const ENV_KEYS = [
  "AUTH_RESET_REQUEST_WINDOW_MINUTES",
  "AUTH_RESET_MAX_REQUESTS",
  "AUTH_RESET_VERIFY_WINDOW_MINUTES",
  "AUTH_RESET_MAX_VERIFY_ATTEMPTS",
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("authConfig reset rate-limit", () => {
  afterEach(() => {
    clearEnv();
  });

  it("usa los defaults cuando no hay overrides de entorno", async () => {
    clearEnv();
    const { loadAuthConfig } = await import("@/lib/config/auth");
    const config = loadAuthConfig();
    expect(config.RESET_REQUEST_WINDOW_MINUTES).toBe(15);
    expect(config.RESET_MAX_REQUESTS).toBe(3);
    expect(config.RESET_VERIFY_WINDOW_MINUTES).toBe(10);
    expect(config.RESET_MAX_VERIFY_ATTEMPTS).toBe(5);
  });

  it("respeta los overrides de entorno", async () => {
    process.env.AUTH_RESET_REQUEST_WINDOW_MINUTES = "30";
    process.env.AUTH_RESET_MAX_REQUESTS = "7";
    process.env.AUTH_RESET_VERIFY_WINDOW_MINUTES = "20";
    process.env.AUTH_RESET_MAX_VERIFY_ATTEMPTS = "9";
    const { loadAuthConfig } = await import("@/lib/config/auth");
    const config = loadAuthConfig();
    expect(config.RESET_REQUEST_WINDOW_MINUTES).toBe(30);
    expect(config.RESET_MAX_REQUESTS).toBe(7);
    expect(config.RESET_VERIFY_WINDOW_MINUTES).toBe(20);
    expect(config.RESET_MAX_VERIFY_ATTEMPTS).toBe(9);
  });
});
