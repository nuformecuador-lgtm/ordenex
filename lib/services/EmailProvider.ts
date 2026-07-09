import type { IEmailProvider, SendOtpCodeParams } from "@/lib/interfaces/external/IEmailProvider";

/**
 * Implementacion de arranque para envio de OTP por email. No integra un
 * proveedor externo real todavia (fuera de alcance de esta feature); registra
 * solo metadata de auditoria, nunca el codigo en claro (evita loguear un
 * secreto). Reemplazar por un proveedor real (Resend/SendGrid/SES) via env
 * cuando esa integracion se aborde.
 */
export class StubEmailProvider implements IEmailProvider {
  async sendOtpCode(params: SendOtpCodeParams): Promise<void> {
    console.info(
      `[auth] OTP emitido para ${params.to}, expira en ${params.expiresInMinutes} min`,
    );
  }
}
