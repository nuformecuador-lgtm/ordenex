import { describe, it, expect, afterEach } from "vitest";
import {
  loadWhatsappWebhookConfig,
  WhatsappNoConfiguradoError,
} from "@/lib/config/whatsapp";

// Feature 109 — B1.T (R12). `loadWhatsappWebhookConfig` lee los dos secretos del webhook y,
// si falta alguno, lanza citando el NOMBRE de la variable, JAMAS su valor.

const VERIFY = "WHATSAPP_WEBHOOK_VERIFY_TOKEN";
const SECRET = "WHATSAPP_APP_SECRET";

const ORIG = { verify: process.env[VERIFY], secret: process.env[SECRET] };

afterEach(() => {
  restore(VERIFY, ORIG.verify);
  restore(SECRET, ORIG.secret);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("loadWhatsappWebhookConfig (R12)", () => {
  it("devuelve verifyToken y appSecret cuando ambos estan presentes", () => {
    process.env[VERIFY] = "token-de-verificacion";
    process.env[SECRET] = "app-secret-super-secreto";

    const config = loadWhatsappWebhookConfig();

    expect(config.verifyToken).toBe("token-de-verificacion");
    expect(config.appSecret).toBe("app-secret-super-secreto");
  });

  it("lanza citando el NOMBRE de la variable ausente, nunca su valor", () => {
    delete process.env[VERIFY];
    process.env[SECRET] = "app-secret-super-secreto";

    try {
      loadWhatsappWebhookConfig();
      throw new Error("no lanzo");
    } catch (e) {
      expect(e).toBeInstanceOf(WhatsappNoConfiguradoError);
      const msg = (e as Error).message;
      expect(msg).toContain(VERIFY); // cita el nombre
      expect(msg).not.toContain("app-secret-super-secreto"); // nunca el valor del otro
    }
  });

  it("lanza por el App Secret ausente citando su nombre", () => {
    process.env[VERIFY] = "token-de-verificacion";
    delete process.env[SECRET];

    expect(() => loadWhatsappWebhookConfig()).toThrow(WhatsappNoConfiguradoError);
    expect(() => loadWhatsappWebhookConfig()).toThrow(SECRET);
  });
});
