import { describe, it, expect, vi } from "vitest";
import { login, verifyChallenge, logout } from "@/lib/actions/auth";
import type { IAuthService } from "@/lib/interfaces/services/IAuthService";

const CONTEXT = { ipAddress: "1.2.3.4", userAgent: "vitest-agent" };

function buildFakeAuthService(overrides: Partial<IAuthService> = {}): IAuthService {
  return {
    login: vi.fn(),
    verifyChallenge: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

describe("Server Action login", () => {
  it("R8: rechaza email invalido con validation_error sin llamar a AuthService", async () => {
    const authService = buildFakeAuthService();

    const result = await login(
      { email: "no-es-un-email", password: "clave123" },
      { authService, getContext: async () => CONTEXT },
    );

    expect(result.status).toBe("validation_error");
    expect(authService.login).not.toHaveBeenCalled();
  });

  it("R9: rechaza password vacia con validation_error sin llamar a AuthService", async () => {
    const authService = buildFakeAuthService();

    const result = await login(
      { email: "ana@example.com", password: "" },
      { authService, getContext: async () => CONTEXT },
    );

    expect(result.status).toBe("validation_error");
    expect(authService.login).not.toHaveBeenCalled();
  });

  it("R12: propaga invalid_credentials", async () => {
    const authService = buildFakeAuthService({
      login: vi.fn().mockResolvedValue({ status: "invalid_credentials" }),
    });

    const result = await login(
      { email: "ana@example.com", password: "clave123" },
      { authService, getContext: async () => CONTEXT },
    );

    expect(result).toEqual({ status: "invalid_credentials" });
  });

  it("R13: propaga account_unavailable", async () => {
    const authService = buildFakeAuthService({
      login: vi.fn().mockResolvedValue({ status: "account_unavailable" }),
    });

    const result = await login(
      { email: "ana@example.com", password: "clave123" },
      { authService, getContext: async () => CONTEXT },
    );

    expect(result).toEqual({ status: "account_unavailable" });
  });

  it("R21a: propaga account_locked con retryAfterMinutes", async () => {
    const authService = buildFakeAuthService({
      login: vi.fn().mockResolvedValue({ status: "account_locked", retryAfterMinutes: 15 }),
    });

    const result = await login(
      { email: "ana@example.com", password: "clave123" },
      { authService, getContext: async () => CONTEXT },
    );

    expect(result).toEqual({ status: "account_locked", retryAfterMinutes: 15 });
  });

  it("R16, R23: sesion concedida setea la cookie httpOnly y devuelve status ok", async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const authService = buildFakeAuthService({
      login: vi.fn().mockResolvedValue({ status: "ok", sessionId: "sess-1", expiresAt }),
    });
    const setCookie = vi.fn();

    const result = await login(
      { email: "ana@example.com", password: "clave123" },
      { authService, getContext: async () => CONTEXT, setCookie },
    );

    expect(result).toEqual({ status: "ok" });
    expect(setCookie).toHaveBeenCalledWith("sess-1", expiresAt);
  });

  it("R17: devuelve challenge_required con el challengeId, sin setear cookie", async () => {
    const authService = buildFakeAuthService({
      login: vi.fn().mockResolvedValue({ status: "challenge_required", challengeId: "challenge-1" }),
    });
    const setCookie = vi.fn();

    const result = await login(
      { email: "ana@example.com", password: "clave123" },
      { authService, getContext: async () => CONTEXT, setCookie },
    );

    expect(result).toEqual({ status: "challenge_required", challengeId: "challenge-1" });
    expect(setCookie).not.toHaveBeenCalled();
  });
});

describe("Server Action verifyChallenge", () => {
  it("R19: OTP valido concede sesion y setea cookie", async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const authService = buildFakeAuthService({
      verifyChallenge: vi.fn().mockResolvedValue({ status: "ok", sessionId: "sess-1", expiresAt }),
    });
    const setCookie = vi.fn();

    const result = await verifyChallenge(
      { challengeId: "challenge-1", code: "123456" },
      { authService, getContext: async () => CONTEXT, setCookie },
    );

    expect(result).toEqual({ status: "ok" });
    expect(setCookie).toHaveBeenCalledWith("sess-1", expiresAt);
  });

  it("R20: OTP invalido/expirado no concede sesion", async () => {
    const authService = buildFakeAuthService({
      verifyChallenge: vi.fn().mockResolvedValue({ status: "invalid_or_expired" }),
    });
    const setCookie = vi.fn();

    const result = await verifyChallenge(
      { challengeId: "challenge-1", code: "000000" },
      { authService, getContext: async () => CONTEXT, setCookie },
    );

    expect(result).toEqual({ status: "otp_invalid" });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("rechaza un codigo con formato invalido sin llamar a AuthService", async () => {
    const authService = buildFakeAuthService();

    const result = await verifyChallenge(
      { challengeId: "challenge-1", code: "abc" },
      { authService, getContext: async () => CONTEXT },
    );

    expect(result.status).toBe("validation_error");
    expect(authService.verifyChallenge).not.toHaveBeenCalled();
  });
});

describe("Server Action logout", () => {
  it("R24: elimina la sesion y limpia la cookie", async () => {
    const authService = buildFakeAuthService({ logout: vi.fn().mockResolvedValue(undefined) });
    const clearCookie = vi.fn();

    await logout({
      authService,
      getSessionId: async () => "sess-1",
      clearCookie,
    });

    expect(authService.logout).toHaveBeenCalledWith("sess-1");
    expect(clearCookie).toHaveBeenCalledTimes(1);
  });

  it("no llama a AuthService.logout si no hay cookie de sesion, pero si limpia la cookie", async () => {
    const authService = buildFakeAuthService({ logout: vi.fn() });
    const clearCookie = vi.fn();

    await logout({
      authService,
      getSessionId: async () => undefined,
      clearCookie,
    });

    expect(authService.logout).not.toHaveBeenCalled();
    expect(clearCookie).toHaveBeenCalledTimes(1);
  });
});
