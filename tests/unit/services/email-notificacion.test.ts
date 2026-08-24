import { describe, it, expect, vi, afterEach } from "vitest";
import type {
  EmailMessage,
  EmailSendResult,
  IEmailSender,
} from "@/lib/interfaces/external/IEmailSender";
import { EmailNotificacionProvider, crearEmailSender } from "@/lib/services/EmailProvider";
import { ConsoleEmailSender } from "@/lib/services/email/ConsoleEmailSender";
import { NodemailerEmailSender } from "@/lib/services/email/NodemailerEmailSender";
import { plantillaOtpCodigo } from "@/lib/services/email/plantillas/otp-codigo";

// Feature 80 — la capa de notificaciones por correo: plantilla pura, un caso de
// uso (OTP) que compone y delega, y la seleccion de transporte por entorno.

const CODIGO = "045912";

class SenderEspia implements IEmailSender {
  public enviados: EmailMessage[] = [];
  async enviar(mensaje: EmailMessage): Promise<EmailSendResult> {
    this.enviados.push(mensaje);
    return { messageId: "id-de-prueba" };
  }
}

describe("plantillaOtpCodigo", () => {
  it("lleva el codigo y la expiracion en el cuerpo de texto plano", () => {
    const mensaje = plantillaOtpCodigo({
      to: "ana@example.com",
      code: CODIGO,
      expiresInMinutes: 10,
    });
    expect(mensaje.to).toBe("ana@example.com");
    expect(mensaje.text).toContain(CODIGO);
    expect(mensaje.text).toContain("10 minutos");
  });

  it("siempre trae texto plano, aunque haya HTML", () => {
    const mensaje = plantillaOtpCodigo({ to: "ana@example.com", code: CODIGO, expiresInMinutes: 5 });
    expect(mensaje.text.trim().length).toBeGreaterThan(0);
    expect(mensaje.html).toContain(CODIGO);
  });

  it("escapa el codigo al interpolarlo en el HTML", () => {
    const mensaje = plantillaOtpCodigo({
      to: "ana@example.com",
      code: "<script>x</script>",
      expiresInMinutes: 5,
    });
    expect(mensaje.html).not.toContain("<script>");
    expect(mensaje.html).toContain("&lt;script&gt;");
  });
});

describe("EmailNotificacionProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("entrega al transporte el mensaje renderizado con el codigo", async () => {
    const sender = new SenderEspia();
    await new EmailNotificacionProvider(sender).sendOtpCode({
      to: "ana@example.com",
      code: CODIGO,
      expiresInMinutes: 10,
    });
    expect(sender.enviados).toHaveLength(1);
    expect(sender.enviados[0].to).toBe("ana@example.com");
    expect(sender.enviados[0].text).toContain(CODIGO);
  });

  it("no escribe el codigo en el log: solo destinatario y expiracion", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await new EmailNotificacionProvider(new SenderEspia()).sendOtpCode({
      to: "ana@example.com",
      code: CODIGO,
      expiresInMinutes: 10,
    });
    const escrito = [...info.mock.calls, ...log.mock.calls].flat().join(" ");
    expect(escrito).toContain("ana@example.com");
    expect(escrito).not.toContain(CODIGO);
  });

  it("propaga el fallo del transporte en vez de tragarselo", async () => {
    const sender: IEmailSender = {
      enviar: vi.fn().mockRejectedValue(new Error("smtp caido")),
    };
    await expect(
      new EmailNotificacionProvider(sender).sendOtpCode({
        to: "ana@example.com",
        code: CODIGO,
        expiresInMinutes: 10,
      }),
    ).rejects.toThrow("smtp caido");
  });
});

describe("ConsoleEmailSender", () => {
  const ORIG = process.env.AUTH_OTP_DEBUG_LOG;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.AUTH_OTP_DEBUG_LOG;
    else process.env.AUTH_OTP_DEBUG_LOG = ORIG;
    vi.restoreAllMocks();
  });

  const mensaje: EmailMessage = {
    to: "ana@example.com",
    subject: "asunto",
    text: `codigo ${CODIGO}`,
  };

  it("sin el flag de debug no imprime el cuerpo, solo metadata", async () => {
    delete process.env.AUTH_OTP_DEBUG_LOG;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resultado = await new ConsoleEmailSender().enviar(mensaje);
    expect(resultado.messageId).toBeNull();
    expect(info.mock.calls.flat().join(" ")).toContain("ana@example.com");
    expect([...info.mock.calls, ...warn.mock.calls].flat().join(" ")).not.toContain(CODIGO);
  });

  it("con AUTH_OTP_DEBUG_LOG=1 vuelca el cuerpo para poder probar en local", async () => {
    process.env.AUTH_OTP_DEBUG_LOG = "1";
    vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await new ConsoleEmailSender().enviar(mensaje);
    expect(warn.mock.calls.flat().join(" ")).toContain(CODIGO);
  });
});

describe("crearEmailSender", () => {
  const ORIG = { host: process.env.SMTP_HOST, from: process.env.SMTP_FROM };
  afterEach(() => {
    if (ORIG.host === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = ORIG.host;
    if (ORIG.from === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = ORIG.from;
  });

  it("sin SMTP configurado devuelve el emisor de consola", () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    expect(crearEmailSender()).toBeInstanceOf(ConsoleEmailSender);
  });

  it("con SMTP configurado devuelve el emisor de nodemailer", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "no-reply@ordenex.co";
    expect(crearEmailSender()).toBeInstanceOf(NodemailerEmailSender);
  });
});
