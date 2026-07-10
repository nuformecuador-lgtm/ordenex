import { describe, it, expect } from "vitest";
import { ResetRateLimiter, buildResetRateKey } from "@/lib/utils/reset-rate-limit";

// Feature 20 / R20: limitador de intentos de verificacion, ventana deslizante.

const VENTANA = 10 * 60_000; // 10 min

describe("ResetRateLimiter (R20)", () => {
  it("no supera el limite por debajo del umbral", () => {
    const limiter = new ResetRateLimiter(() => 1000);
    const key = buildResetRateKey("ana@example.com", "1.2.3.4");
    limiter.registrar(key);
    limiter.registrar(key);
    expect(limiter.superaLimite(key, 5, VENTANA)).toBe(false);
  });

  it("supera el limite al alcanzar N intentos dentro de la ventana", () => {
    const limiter = new ResetRateLimiter(() => 1000);
    const key = buildResetRateKey("ana@example.com", "1.2.3.4");
    for (let i = 0; i < 5; i++) limiter.registrar(key);
    expect(limiter.superaLimite(key, 5, VENTANA)).toBe(true);
  });

  it("se reinicia una vez pasada la ventana (reloj inyectado)", () => {
    let now = 0;
    const limiter = new ResetRateLimiter(() => now);
    const key = buildResetRateKey("ana@example.com", "1.2.3.4");
    for (let i = 0; i < 5; i++) limiter.registrar(key);
    expect(limiter.superaLimite(key, 5, VENTANA)).toBe(true);

    now = VENTANA + 1; // toda marca previa cae fuera de la ventana
    expect(limiter.superaLimite(key, 5, VENTANA)).toBe(false);
  });

  it("aisla por clave email|ip distintas", () => {
    const limiter = new ResetRateLimiter(() => 1000);
    const k1 = buildResetRateKey("ana@example.com", "1.2.3.4");
    const k2 = buildResetRateKey("ana@example.com", "9.9.9.9");
    for (let i = 0; i < 5; i++) limiter.registrar(k1);
    expect(limiter.superaLimite(k1, 5, VENTANA)).toBe(true);
    expect(limiter.superaLimite(k2, 5, VENTANA)).toBe(false);
  });
});
