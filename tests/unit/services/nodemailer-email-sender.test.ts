import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmailConfig } from "@/lib/config/email";

const sendMail = vi.fn();
const createTransport = vi.fn((opts: unknown) => ({ sendMail, opts }));

vi.mock("nodemailer", () => ({
  default: { createTransport: (opts: unknown) => createTransport(opts) },
  createTransport: (opts: unknown) => createTransport(opts),
}));

const { NodemailerEmailSender, EmailEnvioError } = await import(
  "@/lib/services/email/NodemailerEmailSender"
);

// Feature 80 — el transporte SMTP real: reutiliza una sola conexion, envuelve el
// fallo citando la operacion y NUNCA deja escapar la credencial.

const PASSWORD = "s3cr3t0-que-no-debe-salir";

const config: EmailConfig = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "bot@ordenex.co",
  password: PASSWORD,
  from: "no-reply@ordenex.co",
  fromName: "Ordenex",
  timeoutMs: 10_000,
  rejectUnauthorized: true,
};

const mensaje = { to: "ana@example.com", subject: "asunto", text: "cuerpo" };

beforeEach(() => {
  sendMail.mockReset();
  createTransport.mockClear();
  sendMail.mockResolvedValue({ messageId: "<abc@ordenex.co>" });
});

describe("NodemailerEmailSender", () => {
  it("envia con el remitente configurado y devuelve el messageId del servidor", async () => {
    const resultado = await new NodemailerEmailSender(config).enviar(mensaje);
    expect(resultado.messageId).toBe("<abc@ordenex.co>");
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: "Ordenex", address: "no-reply@ordenex.co" },
        to: "ana@example.com",
        subject: "asunto",
        text: "cuerpo",
      }),
    );
  });

  it("reutiliza el mismo transporte entre envios en vez de rehacer el saludo TLS", async () => {
    const sender = new NodemailerEmailSender(config);
    await sender.enviar(mensaje);
    await sender.enviar(mensaje);
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("omite la autenticacion cuando no hay usuario ni contrasena", async () => {
    await new NodemailerEmailSender({ ...config, user: null, password: null }).enviar(mensaje);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it("envuelve el fallo citando el destinatario y sin filtrar la contrasena", async () => {
    sendMail.mockRejectedValue(new Error(`535 auth failed for ${PASSWORD}`));
    const sender = new NodemailerEmailSender(config);
    await expect(sender.enviar(mensaje)).rejects.toBeInstanceOf(EmailEnvioError);
    try {
      await sender.enviar(mensaje);
      expect.unreachable("deberia haber lanzado");
    } catch (error) {
      expect((error as Error).message).toContain("ana@example.com");
      expect((error as Error).message).not.toContain(PASSWORD);
    }
  });
});
