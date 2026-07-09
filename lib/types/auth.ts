import { z } from "zod";
import { authConfig } from "@/lib/config/auth";

// Limite practico de longitud de contrasena: bcrypt ignora bytes mas alla de
// 72; se rechaza antes de tocar AuthService (R9).
export const MAX_PASSWORD_LENGTH = 72;

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const OTP_CODE_LENGTH = 6;

export const verifyChallengeInputSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d+$/, "solo numeros").length(OTP_CODE_LENGTH),
});
export type VerifyChallengeInput = z.infer<typeof verifyChallengeInputSchema>;

/**
 * Validacion generica de cedula/telefono (R10a): solo numerico y longitud
 * configurable. Sin digito verificador ni formato especifico de pais.
 */
export function numericIdentifierSchema(
  min: number = authConfig.CEDULA_TELEFONO_MIN_LENGTH,
  max: number = authConfig.CEDULA_TELEFONO_MAX_LENGTH,
) {
  return z
    .string()
    .regex(/^\d+$/, "solo se permiten digitos")
    .min(min, `debe tener al menos ${min} digitos`)
    .max(max, `debe tener como maximo ${max} digitos`);
}

export const cedulaSchema = numericIdentifierSchema();
export const telefonoSchema = numericIdentifierSchema();

export type LoginResult =
  | { status: "ok" }
  | { status: "challenge_required"; challengeId: string }
  | { status: "invalid_credentials" }
  | { status: "account_unavailable" }
  | { status: "account_locked"; retryAfterMinutes: number }
  | { status: "otp_invalid" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
