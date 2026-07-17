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
import { StubEmailProvider } from "@/lib/services/EmailProvider";
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
  // TODO(feature 80): NO existe proveedor de correo real. Produccion instancia
  // aqui `StubEmailProvider`, que solo emite un `console.info` con metadata
  // (destinatario y expiracion) y NUNCA envia el email. No hay dependencia de
  // Resend/SendGrid/SES en package.json.
  //
  // Consecuencia real y vigente: la entrega del OTP depende HOY del
  // `console.log("Codigo OTP generado:", code)` de OtpChallengeIssuer.ts:39,
  // es decir, del log del servidor. Sin ese log el flujo de recuperacion es
  // incompletable, y por eso se conserva a proposito (riesgo aceptado).
  //
  // OJO al leer el resto del codigo: los comentarios de EmailProvider.ts:3-9
  // ("nunca el codigo en claro") y de OtpChallengeIssuer.ts:27-30 ("el codigo
  // en claro solo viaja por email") describen un estado que AUN NO EXISTE y
  // quedan desactualizados DELIBERADAMENTE hasta la feature 80. Este TODO es
  // el unico punto del codigo que describe el estado real.
  //
  // lib/interfaces/external/IEmailProvider.ts ya esta lista para la
  // implementacion real: basta sustituir este stub. Saldar todo lo anterior
  // (proveedor real, quitar el log del OTP y corregir esos comentarios) es la
  // feature 80.
  const emailProvider = new StubEmailProvider();
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
