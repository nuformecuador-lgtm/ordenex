import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { IEmailOtpChallengeRepository } from "@/lib/interfaces/repositories/IEmailOtpChallengeRepository";
import type { IEmailProvider } from "@/lib/interfaces/external/IEmailProvider";
import { authConfig } from "@/lib/config/auth";

const OTP_SALT_ROUNDS = 10;
const OTP_LENGTH = 6;

/** Codigo OTP numerico de 6 digitos, con padding a la izquierda. */
export function generarCodigoOtp(): string {
  const max = 10 ** OTP_LENGTH;
  return crypto.randomInt(0, max).toString().padStart(OTP_LENGTH, "0");
}

export interface EmitirOtpParams {
  usuarioId: string;
  email: string;
  deviceHash: string;
  ipAddress: string;
}

export interface EmitirOtpResult {
  challengeId: string;
}

/**
 * Genera y envia el OTP del paso de verificacion RBA (R17-R20). El codigo en
 * claro solo viaja por email; en DB unicamente se persiste `codeHash`, y nunca
 * se escribe en un log (feature 80).
 */
export class OtpChallengeIssuer {
  constructor(
    private readonly otpRepo: IEmailOtpChallengeRepository,
    private readonly emailProvider: IEmailProvider,
  ) {}

  async emitir(params: EmitirOtpParams): Promise<EmitirOtpResult> {
    const code = generarCodigoOtp();
    const codeHash = await bcrypt.hash(code, OTP_SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + authConfig.OTP_TTL_MINUTES * 60_000);

    const challenge = await this.otpRepo.create({
      usuarioId: params.usuarioId,
      codeHash,
      deviceHash: params.deviceHash,
      ipAddress: params.ipAddress,
      expiresAt,
    });

    await this.emailProvider.sendOtpCode({
      to: params.email,
      code,
      expiresInMinutes: authConfig.OTP_TTL_MINUTES,
    });

    return { challengeId: challenge.id };
  }
}
