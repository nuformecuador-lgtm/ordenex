import { z } from "zod";
import { OTP_CODE_LENGTH } from "@/lib/types/auth";
import { strongPasswordSchema } from "@/lib/types/password-policy";

// Contratos I/O del flujo de recuperacion de contrasena (Feature 20).
// Validacion zod en el borde de las Server Actions. No expone `challengeId`
// (design.md decision 2): el cliente conserva email + codigo entre fases.

/** Paso 1: solicitud por email (R1). */
export const requestResetSchema = z.object({
  email: z.string().email(),
});
export type RequestResetInput = z.infer<typeof requestResetSchema>;

/** Codigo OTP: exactamente OTP_CODE_LENGTH digitos (reusa la constante del login). */
const otpCodeSchema = z
  .string()
  .regex(/^\d+$/, "solo numeros")
  .length(OTP_CODE_LENGTH);

/** Paso 2: verificacion del codigo (R5/R6). */
export const verifyResetCodeSchema = z.object({
  email: z.string().email(),
  code: otpCodeSchema,
});
export type VerifyResetCodeInput = z.infer<typeof verifyResetCodeSchema>;

/**
 * Paso 3: nueva contrasena. Compone la politica fuerte (R8) y exige que
 * `password` y `confirmPassword` coincidan (R7). El error de coincidencia se
 * adjunta al campo `confirmPassword`.
 */
export const resetPasswordSchema = z
  .object({
    email: z.string().email(),
    code: otpCodeSchema,
    password: strongPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contrasenas no coinciden",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Uniones de resultado (nunca lanzan al cliente). Respuestas genericas: no
// revelan la existencia de la cuenta ni el motivo exacto del rechazo.

/** solicitarRecuperacion: solo ok | validation_error (nunca revela existencia). */
export type PasswordResetRequestResult =
  | { status: "ok" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/** verificarCodigoRecuperacion (R5/R6). */
export type VerifyResetCodeResult =
  | { status: "ok" }
  | { status: "invalid_or_expired" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/** restablecerContrasena (R7/R9/R10/R11). */
export type ResetPasswordResult =
  | { status: "ok" }
  | { status: "invalid_or_expired" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
