"use server";

import { cookies, headers } from "next/headers";
import {
  loginInputSchema,
  verifyChallengeInputSchema,
  type LoginResult,
} from "@/lib/types/auth";
import type { IAuthService } from "@/lib/interfaces/services/IAuthService";
import { AuthService } from "@/lib/services/AuthService";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { LoginAttemptRepository } from "@/lib/repositories/LoginAttemptRepository";
import { TrustedDeviceRepository } from "@/lib/repositories/TrustedDeviceRepository";
import { EmailOtpChallengeRepository } from "@/lib/repositories/EmailOtpChallengeRepository";
import { SessionRepository } from "@/lib/repositories/SessionRepository";
import { RiskEngine } from "@/lib/services/RiskEngine";
import { StubEmailProvider } from "@/lib/services/EmailProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { SESSION_COOKIE_NAME } from "@/lib/constants/auth";

export interface RequestContext {
  ipAddress: string;
  userAgent: string;
}

function buildAuthService(): IAuthService {
  const prisma = getPrismaClient();
  const userRepo = new UserRepository(prisma);
  const loginAttemptRepo = new LoginAttemptRepository(prisma);
  const trustedDeviceRepo = new TrustedDeviceRepository(prisma);
  const otpRepo = new EmailOtpChallengeRepository(prisma);
  const sessionRepo = new SessionRepository(prisma);
  const riskEngine = new RiskEngine(loginAttemptRepo, trustedDeviceRepo);
  const emailProvider = new StubEmailProvider();
  return new AuthService(
    userRepo,
    loginAttemptRepo,
    trustedDeviceRepo,
    otpRepo,
    sessionRepo,
    riskEngine,
    emailProvider,
  );
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

async function setSessionCookie(sessionId: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export interface LoginDeps {
  authService?: Pick<IAuthService, "login">;
  getContext?: () => Promise<RequestContext>;
  setCookie?: (sessionId: string, expiresAt: Date) => Promise<void>;
}

/**
 * Server Action de login (R8, R9, R11-R14, R16, R17, R21, R21a, R23).
 * Acepta `deps` opcional para inyeccion en tests; en produccion se llama sin
 * el segundo argumento y usa `headers()`/`cookies()`/Prisma reales.
 */
export async function login(input: unknown, deps: LoginDeps = {}): Promise<LoginResult> {
  const parsed = loginInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const getContext = deps.getContext ?? requestContextFromHeaders;
  const setCookie = deps.setCookie ?? setSessionCookie;
  const authService = deps.authService ?? buildAuthService();

  const context = await getContext();
  const result = await authService.login({ ...parsed.data, ...context });

  switch (result.status) {
    case "ok":
      await setCookie(result.sessionId, result.expiresAt); // R23
      return { status: "ok" };
    case "challenge_required":
      return { status: "challenge_required", challengeId: result.challengeId };
    case "invalid_credentials":
      return { status: "invalid_credentials" };
    case "account_unavailable":
      return { status: "account_unavailable" };
    case "account_locked":
      return { status: "account_locked", retryAfterMinutes: result.retryAfterMinutes };
  }
}

export interface VerifyChallengeDeps {
  authService?: Pick<IAuthService, "verifyChallenge">;
  getContext?: () => Promise<RequestContext>;
  setCookie?: (sessionId: string, expiresAt: Date) => Promise<void>;
}

/** Server Action de verificacion de OTP (R19, R20, R23). */
export async function verifyChallenge(
  input: unknown,
  deps: VerifyChallengeDeps = {},
): Promise<LoginResult> {
  const parsed = verifyChallengeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const getContext = deps.getContext ?? requestContextFromHeaders;
  const setCookie = deps.setCookie ?? setSessionCookie;
  const authService = deps.authService ?? buildAuthService();

  const context = await getContext();
  const result = await authService.verifyChallenge({ ...parsed.data, ...context });

  if (result.status === "ok") {
    await setCookie(result.sessionId, result.expiresAt); // R23
    return { status: "ok" };
  }
  return { status: "otp_invalid" }; // R20
}

export interface LogoutDeps {
  authService?: Pick<IAuthService, "logout">;
  getSessionId?: () => Promise<string | undefined>;
  clearCookie?: () => Promise<void>;
}

/** Server Action de logout (R24). */
export async function logout(deps: LogoutDeps = {}): Promise<void> {
  const authService = deps.authService ?? buildAuthService();
  const getSessionId =
    deps.getSessionId ??
    (async () => {
      const cookieStore = await cookies();
      return cookieStore.get(SESSION_COOKIE_NAME)?.value;
    });
  const clearCookie = deps.clearCookie ?? clearSessionCookie;

  const sessionId = await getSessionId();
  if (sessionId) {
    await authService.logout(sessionId);
  }
  await clearCookie();
}
