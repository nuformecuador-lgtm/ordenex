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
  it("es false sin credencial, para que el flujo degrade en dev", () => {
    limpiar();
    expect(emailSmtpConfigurado()).toBe(false);
  });

  it("sigue siendo false con usuario pero sin contrasena de aplicacion", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    expect(emailSmtpConfigurado()).toBe(false);
  });

  it("es true con usuario y contrasena, sin necesidad de declarar el host", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    process.env.SMTP_PASSWORD = "abcd efgh ijkl mnop";
    expect(emailSmtpConfigurado()).toBe(true);
  });

  it("trata el valor vacio como ausente", () => {
    limpiar();
    process.env.SMTP_USER = "   ";
    process.env.SMTP_PASSWORD = "abcdefghijklmnop";
    expect(emailSmtpConfigurado()).toBe(false);
  });
});

describe("loadEmailConfig", () => {
  it("lanza citando el nombre de la variable ausente, no su valor", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    try {
      loadEmailConfig();
      expect.unreachable("deberia haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(EmailNoConfiguradoError);
      expect((error as Error).message).toContain("SMTP_PASSWORD");
      expect((error as Error).message).not.toContain("no-reply@ordenex.co");
    }
  });

  it("nunca filtra la contrasena en el mensaje de error", () => {
    limpiar();
    process.env.SMTP_PASSWORD = "s3cr3t0-que-no-debe-salir";
    try {
      loadEmailConfig();
      expect.unreachable("deberia haber lanzado por falta de SMTP_USER");
    } catch (error) {
      expect((error as Error).message).toContain("SMTP_USER");
      expect((error as Error).message).not.toContain("s3cr3t0-que-no-debe-salir");
    }
  });

  it("asume Google: host, puerto y TLS salen del proveedor sin declararlos", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    process.env.SMTP_PASSWORD = "abcdefghijklmnop";
    const config = loadEmailConfig();
    expect(config.host).toBe("smtp.gmail.com");
    expect(config.port).toBe(587);
    expect(config.secure).toBe(false);
    expect(config.rejectUnauthorized).toBe(true);
    expect(config.fromName).toBe("Ordenex");
  });

  it("usa la cuenta autenticada como remitente cuando no se declara SMTP_FROM", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    process.env.SMTP_PASSWORD = "abcdefghijklmnop";
    expect(loadEmailConfig().from).toBe("no-reply@ordenex.co");
  });

  it("respeta SMTP_FROM explicito para el caso del alias verificado", () => {
    limpiar();
    process.env.SMTP_USER = "bot@ordenex.co";
    process.env.SMTP_PASSWORD = "abcdefghijklmnop";
    process.env.SMTP_FROM = "hola@ordenex.co";
    expect(loadEmailConfig().from).toBe("hola@ordenex.co");
  });

  it("quita los espacios con que Google muestra la contrasena de aplicacion", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    process.env.SMTP_PASSWORD = "abcd efgh ijkl mnop";
    expect(loadEmailConfig().password).toBe("abcdefghijklmnop");
  });

  it("permite mudarse de proveedor sobreescribiendo el host", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    process.env.SMTP_PASSWORD = "abcdefghijklmnop";
    process.env.SMTP_HOST = "smtp-relay.gmail.com";
    expect(loadEmailConfig().host).toBe("smtp-relay.gmail.com");
  });

  it("deriva secure=true del puerto 465 sin necesidad de SMTP_SECURE", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    process.env.SMTP_PASSWORD = "abcdefghijklmnop";
    process.env.SMTP_PORT = "465";
    expect(loadEmailConfig().secure).toBe(true);
  });

  it("respeta SMTP_SECURE explicito por encima del puerto", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    process.env.SMTP_PASSWORD = "abcdefghijklmnop";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "false";
    expect(loadEmailConfig().secure).toBe(false);
  });

  it("solo desactiva la validacion del certificado con un 0 explicito", () => {
    limpiar();
    process.env.SMTP_USER = "no-reply@ordenex.co";
    process.env.SMTP_PASSWORD = "abcdefghijklmnop";
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
