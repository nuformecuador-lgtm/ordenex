"use server";

import { headers } from "next/headers";
import {
  requestResetSchema,
  verifyResetCodeSchema,
  resetPasswordSchema,
  type PasswordResetRequestResult,
  type VerifyResetCodeResult,
  type ResetPasswordResult,
} from "@/lib/types/password-reset";
import type { IPasswordResetService } from "@/lib/interfaces/services/IPasswordResetService";
import { PasswordResetService } from "@/lib/services/PasswordResetService";
import { OtpChallengeIssuer } from "@/lib/services/OtpChallengeIssuer";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { EmailOtpChallengeRepository } from "@/lib/repositories/EmailOtpChallengeRepository";
import { crearEmailProvider } from "@/lib/services/EmailProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { computeDeviceHash } from "@/lib/utils/device";
import { ResetRateLimiter } from "@/lib/utils/reset-rate-limit";

export interface RequestContext {
  ipAddress: string;
  userAgent: string;
}

// Limitador de intentos de verificacion (R20): unico por proceso para que la
// ventana deslizante persista entre invocaciones de las Server Actions.
const verifyLimiter = new ResetRateLimiter();

function buildPasswordResetService(): IPasswordResetService {
  const prisma = getPrismaClient();
  const userRepo = new UserRepository(prisma);
  const otpRepo = new EmailOtpChallengeRepository(prisma);
  // El proveedor de correo se elige por entorno (feature 80): con SMTP
  // configurado se envia de verdad por nodemailer; sin el —dev o CI— se
  // degrada a consola. Ver lib/services/EmailProvider.ts y lib/config/email.ts.
  const emailProvider = crearEmailProvider();
  const otpIssuer = new OtpChallengeIssuer(otpRepo, emailProvider);
  return new PasswordResetService(userRepo, otpRepo, otpIssuer, verifyLimiter);
}

async function requestContextFromHeaders(): Promise<RequestContext> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const ipAddress = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : (requestHeaders.get("x-real-ip") ?? "unknown");
  const userAgent = requestHeaders.get("user-agent") ?? "unknown";
  return { ipAddress, userAgent };
}

export interface PasswordResetDeps {
  service?: IPasswordResetService;
  getContext?: () => Promise<RequestContext>;
}

/**
 * Server Action del paso 1 (R1/R12/R19). Valida el email y delega en el
 * servicio. SIEMPRE responde `ok` generico cuando la validacion pasa: nunca
 * revela si la cuenta existe.
 */
export async function solicitarRecuperacion(
  input: unknown,
  deps: PasswordResetDeps = {},
): Promise<PasswordResetRequestResult> {
  const parsed = requestResetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const getContext = deps.getContext ?? requestContextFromHeaders;
  const service = deps.service ?? buildPasswordResetService();
  const context = await getContext();

  await service.solicitar({
    email: parsed.data.email,
    deviceHash: computeDeviceHash(context.userAgent),
    ipAddress: context.ipAddress,
  });
  return { status: "ok" };
}

/**
 * Server Action del paso 2 (R5/R6/R20). Verifica el codigo sin consumir el
 * desafio. Error generico `invalid_or_expired` ante cualquier fallo.
 */
export async function verificarCodigoRecuperacion(
  input: unknown,
  deps: PasswordResetDeps = {},
): Promise<VerifyResetCodeResult> {
  const parsed = verifyResetCodeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const getContext = deps.getContext ?? requestContextFromHeaders;
  const service = deps.service ?? buildPasswordResetService();
  const context = await getContext();

  return service.verificarCodigo({
    email: parsed.data.email,
    code: parsed.data.code,
    ipAddress: context.ipAddress,
  });
}

/**
 * Server Action del paso 3 (R7/R8/R9/R10/R11/R20). Valida coincidencia y
 * politica fuerte; delega el restablecimiento. Si el desafio ya no esta activo
 * responde `invalid_or_expired` sin tocar la contrasena.
 */
export async function restablecerContrasena(
  input: unknown,
  deps: PasswordResetDeps = {},
): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const getContext = deps.getContext ?? requestContextFromHeaders;
  const service = deps.service ?? buildPasswordResetService();
  const context = await getContext();

  return service.restablecer({
    email: parsed.data.email,
    code: parsed.data.code,
    newPassword: parsed.data.password,
    ipAddress: context.ipAddress,
  });
}
