import type { IEmailProvider, SendOtpCodeParams } from "@/lib/interfaces/external/IEmailProvider";
import type { IEmailSender } from "@/lib/interfaces/external/IEmailSender";
import { emailSmtpConfigurado, loadEmailConfig } from "@/lib/config/email";
import { NodemailerEmailSender } from "@/lib/services/email/NodemailerEmailSender";
import { ConsoleEmailSender } from "@/lib/services/email/ConsoleEmailSender";
import { plantillaOtpCodigo } from "@/lib/services/email/plantillas/otp-codigo";

/**
 * Caso de uso "enviar el OTP por correo": compone la plantilla y delega el
 * transporte en un IEmailSender. No sabe si detras hay SMTP o consola, de modo
 * que el mensaje se puede afirmar en un test con un emisor falso.
 *
 * El codigo en claro viaja SOLO en el cuerpo del correo: aqui se registra
 * unicamente metadata (destinatario y expiracion), nunca el codigo.
 */
export class EmailNotificacionProvider implements IEmailProvider {
  constructor(private readonly sender: IEmailSender) {}

  async sendOtpCode(params: SendOtpCodeParams): Promise<void> {
    await this.sender.enviar(plantillaOtpCodigo(params));
    console.info(
      `[auth] OTP enviado a ${params.to}, expira en ${params.expiresInMinutes} min`,
    );
  }
}

/**
 * Implementacion inerte: no envia nada y no imprime el codigo. Se conserva para
 * los tests que solo necesitan una dependencia que cumpla el contrato.
 */
export class StubEmailProvider implements IEmailProvider {
  async sendOtpCode(params: SendOtpCodeParams): Promise<void> {
    console.info(
      `[auth] OTP emitido para ${params.to}, expira en ${params.expiresInMinutes} min (stub: no se envia)`,
    );
  }
}

/**
 * Selecciona el emisor segun el entorno (feature 80): con SMTP configurado se
 * envia de verdad; sin el —dev o CI— se degrada al emisor de consola en vez de
 * reventar. La decision se toma aqui, en un unico sitio, y no en cada Server
 * Action.
 */
export function crearEmailSender(): IEmailSender {
  return emailSmtpConfigurado()
    ? new NodemailerEmailSender(loadEmailConfig())
    : new ConsoleEmailSender();
}

/** Proveedor de OTP por correo ya cableado con el emisor que toque. */
export function crearEmailProvider(): IEmailProvider {
  return new EmailNotificacionProvider(crearEmailSender());
}
