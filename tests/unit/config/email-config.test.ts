import { describe, it, expect, afterEach } from "vitest";
import {
  loadEmailConfig,
  emailSmtpConfigurado,
  otpDebugLogHabilitado,
  EmailNoConfiguradoError,
} from "@/lib/config/email";

// Feature 80 — la config SMTP se lee en un unico sitio, decide por si sola si
// hay envio real y, si falta una pieza, cita el NOMBRE de la variable, jamas su
// valor (mismo invariante que lib/config/whatsapp.ts).

const VARS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SMTP_FROM_NAME",
  "SMTP_TIMEOUT_MS",
  "SMTP_TLS_REJECT_UNAUTHORIZED",
  "AUTH_OTP_DEBUG_LOG",
] as const;

const ORIG = new Map(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS) {
    const original = ORIG.get(v);
    if (original === undefined) delete process.env[v];
    else process.env[v] = original;
  }
});

function limpiar() {
  for (const v of VARS) delete process.env[v];
}

describe("emailSmtpConfigurado", () => {
  it("es false sin host ni remitente, para que el flujo degrade en dev", () => {
    limpiar();
    expect(emailSmtpConfigurado()).toBe(false);
  });

  it("sigue siendo false con host pero sin remitente", () => {
    limpiar();
    process.env.SMTP_HOST = "smtp.example.com";
    expect(emailSmtpConfigurado()).toBe(false);
  });

  it("es true con host y remitente", () => {
    limpiar();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "no-reply@ordenex.co";
    expect(emailSmtpConfigurado()).toBe(true);
  });

  it("trata el valor vacio como ausente", () => {
    limpiar();
    process.env.SMTP_HOST = "   ";
    process.env.SMTP_FROM = "no-reply@ordenex.co";
    expect(emailSmtpConfigurado()).toBe(false);
  });
});

describe("loadEmailConfig", () => {
  it("lanza citando el nombre de la variable ausente, no su valor", () => {
    limpiar();
    process.env.SMTP_FROM = "no-reply@ordenex.co";
    try {
      loadEmailConfig();
      expect.unreachable("deberia haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(EmailNoConfiguradoError);
      expect((error as Error).message).toContain("SMTP_HOST");
      expect((error as Error).message).not.toContain("no-reply@ordenex.co");
    }
  });

  it("nunca filtra la contrasena en el mensaje de error", () => {
    limpiar();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PASSWORD = "s3cr3t0-que-no-debe-salir";
    try {
      loadEmailConfig();
      expect.unreachable("deberia haber lanzado por falta de SMTP_FROM");
    } catch (error) {
      expect((error as Error).message).toContain("SMTP_FROM");
      expect((error as Error).message).not.toContain("s3cr3t0-que-no-debe-salir");
    }
  });

  it("aplica los defaults: puerto 587, sin TLS implicito y validando certificado", () => {
    limpiar();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "no-reply@ordenex.co";
    const config = loadEmailConfig();
    expect(config.port).toBe(587);
    expect(config.secure).toBe(false);
    expect(config.rejectUnauthorized).toBe(true);
    expect(config.fromName).toBe("Ordenex");
    expect(config.user).toBeNull();
    expect(config.password).toBeNull();
  });

  it("deriva secure=true del puerto 465 sin necesidad de SMTP_SECURE", () => {
    limpiar();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "no-reply@ordenex.co";
    process.env.SMTP_PORT = "465";
    expect(loadEmailConfig().secure).toBe(true);
  });

  it("respeta SMTP_SECURE explicito por encima del puerto", () => {
    limpiar();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "no-reply@ordenex.co";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "false";
    expect(loadEmailConfig().secure).toBe(false);
  });

  it("solo desactiva la validacion del certificado con un 0 explicito", () => {
    limpiar();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "no-reply@ordenex.co";
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED = "0";
    expect(loadEmailConfig().rejectUnauthorized).toBe(false);
  });
});

describe("otpDebugLogHabilitado", () => {
  it("esta apagado por defecto: el codigo no se imprime sin pedirlo", () => {
    limpiar();
    expect(otpDebugLogHabilitado()).toBe(false);
  });

  it("no se enciende con un valor cualquiera, solo con 1 o true", () => {
    limpiar();
    process.env.AUTH_OTP_DEBUG_LOG = "no";
    expect(otpDebugLogHabilitado()).toBe(false);
    process.env.AUTH_OTP_DEBUG_LOG = "1";
    expect(otpDebugLogHabilitado()).toBe(true);
    process.env.AUTH_OTP_DEBUG_LOG = "true";
    expect(otpDebugLogHabilitado()).toBe(true);
  });
});
