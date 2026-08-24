import nodemailer, { type Transporter } from "nodemailer";
import type { EmailConfig } from "@/lib/config/email";
import type {
  EmailMessage,
  EmailSendResult,
  IEmailSender,
} from "@/lib/interfaces/external/IEmailSender";

/**
 * Fallo al entregar un correo por SMTP. Envuelve el error de nodemailer citando
 * QUE operacion fallo y a QUE destinatario (docs/conventions.md §Manejo de
 * errores), sin filtrar la credencial: `cause` conserva el original para el log.
 */
export class EmailEnvioError extends Error {
  constructor(destinatario: string, causa: unknown) {
    super(`email: fallo el envio SMTP a ${destinatario}`);
    this.name = "EmailEnvioError";
    this.cause = causa;
  }
}

/**
 * Emisor real por SMTP (nodemailer). Un unico transporte reutilizado: nodemailer
 * mantiene el pool de conexiones, asi que crear uno por envio pagaria el saludo
 * TLS en cada OTP.
 */
export class NodemailerEmailSender implements IEmailSender {
  private transporter: Transporter | null = null;

  constructor(private readonly config: EmailConfig) {}

  private getTransporter(): Transporter {
    if (this.transporter !== null) return this.transporter;
    const { config } = this;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth:
        config.user !== null && config.password !== null
          ? { user: config.user, pass: config.password }
          : undefined,
      connectionTimeout: config.timeoutMs,
      greetingTimeout: config.timeoutMs,
      socketTimeout: config.timeoutMs,
      tls: { rejectUnauthorized: config.rejectUnauthorized },
    });
    return this.transporter;
  }

  async enviar(mensaje: EmailMessage): Promise<EmailSendResult> {
    try {
      const info = await this.getTransporter().sendMail({
        from: { name: this.config.fromName, address: this.config.from },
        to: mensaje.to,
        subject: mensaje.subject,
        text: mensaje.text,
        html: mensaje.html,
      });
      return { messageId: info.messageId ?? null };
    } catch (causa) {
      throw new EmailEnvioError(mensaje.to, causa);
    }
  }
}
