import { describe, it, expect, afterEach } from "vitest";
import { loadWebhookConfig } from "@/lib/config/webhook";

// Feature 99 (R28/R32) — la configuracion ausente o vacia se resuelve a defaults sin lanzar;
// la clave de cifrado ausente -> null (no lanza). Patron geocode-config.

const KEYS = ["WEBHOOK_TIMEOUT_MS", "WEBHOOK_REPLAY_WINDOW_S", "WEBHOOK_SECRET_ENC_KEY"] as const;
const snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

describe("R28 — config ausente/vacia -> defaults sin lanzar", () => {
  it("sin ninguna env definida devuelve los defaults y no lanza", () => {
    for (const k of KEYS) delete process.env[k];
    const cfg = loadWebhookConfig();
    expect(cfg.WEBHOOK_TIMEOUT_MS).toBe(10_000);
    expect(cfg.WEBHOOK_REPLAY_WINDOW_S).toBe(300);
    expect(cfg.WEBHOOK_SECRET_ENC_KEY).toBeNull();
  });

  it("valores vacios o invalidos caen a los defaults (no lanza)", () => {
    process.env.WEBHOOK_TIMEOUT_MS = "";
    process.env.WEBHOOK_REPLAY_WINDOW_S = "no-numero";
    process.env.WEBHOOK_SECRET_ENC_KEY = "";
    const cfg = loadWebhookConfig();
    expect(cfg.WEBHOOK_TIMEOUT_MS).toBe(10_000);
    expect(cfg.WEBHOOK_REPLAY_WINDOW_S).toBe(300);
    expect(cfg.WEBHOOK_SECRET_ENC_KEY).toBeNull();
  });

  it("R32: la clave de cifrado ausente resuelve a null sin lanzar", () => {
    delete process.env.WEBHOOK_SECRET_ENC_KEY;
    expect(() => loadWebhookConfig()).not.toThrow();
    expect(loadWebhookConfig().WEBHOOK_SECRET_ENC_KEY).toBeNull();
  });

  it("valores validos se leen tal cual", () => {
    process.env.WEBHOOK_TIMEOUT_MS = "3000";
    process.env.WEBHOOK_REPLAY_WINDOW_S = "120";
    process.env.WEBHOOK_SECRET_ENC_KEY = "una-clave";
    const cfg = loadWebhookConfig();
    expect(cfg.WEBHOOK_TIMEOUT_MS).toBe(3000);
    expect(cfg.WEBHOOK_REPLAY_WINDOW_S).toBe(120);
    expect(cfg.WEBHOOK_SECRET_ENC_KEY).toBe("una-clave");
  });
});
