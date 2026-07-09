export interface SendOtpCodeParams {
  to: string;
  code: string;
  expiresInMinutes: number;
}

export interface IEmailProvider {
  /** Envia el codigo OTP en claro por email. El codigo NUNCA se persiste (solo su hash). */
  sendOtpCode(params: SendOtpCodeParams): Promise<void>;
}
