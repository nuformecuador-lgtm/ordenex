// Capa generica de notificaciones por correo. Vive en `interfaces/external/`
// (docs/architecture.md §Interfaces) junto a IEmailProvider / IWebhookSender.
//
// Distincion deliberada con IEmailProvider:
//  - IEmailSender es el TRANSPORTE: sabe poner un mensaje en la red, nada mas.
//  - IEmailProvider es un CASO DE USO (enviar un OTP): sabe que texto lleva ese
//    correo, y delega el envio en un IEmailSender.
// Un aviso nuevo (bienvenida, alerta de cierre, ...) se implementa como otro
// caso de uso sobre esta misma interfaz, sin volver a tocar el transporte.

export interface EmailMessage {
  /** Destinatario. Una sola direccion: no hay envio masivo por este canal. */
  to: string;
  /** Asunto ya renderizado. */
  subject: string;
  /** Cuerpo en texto plano. OBLIGATORIO: es el fallback de todo cliente. */
  text: string;
  /** Cuerpo HTML opcional. */
  html?: string;
}

export interface EmailSendResult {
  /**
   * Identificador que devuelve el servidor SMTP. `null` cuando el emisor no
   * toca la red (emisor de consola en dev/tests).
   */
  messageId: string | null;
}

export interface IEmailSender {
  /**
   * Entrega el mensaje. Lanza si el envio falla: el llamador decide si eso
   * aborta la operacion o solo se registra.
   */
  enviar(mensaje: EmailMessage): Promise<EmailSendResult>;
}
