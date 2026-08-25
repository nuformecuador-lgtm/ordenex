import type {
  EmailMessage,
  EmailSendResult,
  IEmailSender,
} from "@/lib/interfaces/external/IEmailSender";
import { otpDebugLogHabilitado } from "@/lib/config/email";

/**
 * Emisor de respaldo para desarrollo y tests: no toca la red. Registra solo
 * metadata (destinatario y asunto). El CUERPO —que en el caso del OTP contiene
 * el codigo en claro— se imprime unicamente con AUTH_OTP_DEBUG_LOG=1, para poder
 * completar el flujo de recuperacion en una maquina sin relay SMTP.
 */
export class ConsoleEmailSender implements IEmailSender {
  async enviar(mensaje: EmailMessage): Promise<EmailSendResult> {
    console.info(`[email] sin SMTP configurado; no se envia. to=${mensaje.to} asunto="${mensaje.subject}"`);
    if (otpDebugLogHabilitado()) {
      console.warn(`[email][debug] cuerpo:\n${mensaje.text}`);
    }
    return { messageId: null };
  }
}
