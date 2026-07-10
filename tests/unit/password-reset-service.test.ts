import { describe, it, expect, vi } from "vitest";
import { PasswordResetService } from "@/lib/services/PasswordResetService";
import { hashPassword } from "@/lib/utils/password";
import { ResetRateLimiter } from "@/lib/utils/reset-rate-limit";
import type { AuthConfig } from "@/lib/config/auth";

// Feature 20 / R1, R2, R3, R5, R6, R9, R10, R11, R13, R14, R15, R19, R20.

const CONFIG: AuthConfig = {
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_MINUTES: 15,
  SESSION_TTL_HOURS: 24,
  OTP_TTL_MINUTES: 10,
  RISK_THRESHOLD: 50,
  CEDULA_TELEFONO_MIN_LENGTH: 7,
  CEDULA_TELEFONO_MAX_LENGTH: 15,
  RESET_REQUEST_WINDOW_MINUTES: 15,
  RESET_MAX_REQUESTS: 3,
  RESET_VERIFY_WINDOW_MINUTES: 10,
  RESET_MAX_VERIFY_ATTEMPTS: 5,
};

const USUARIO = {
  id: "usr-1",
  nombre: "Ana",
  email: "ana@example.com",
  telefono: "0991234567",
  estado: "activo" as const,
  cedula: "1710034065",
  tipoIdentificacionId: "tipo-1",
  rolId: "rol-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildChallenge(codeHash: string, overrides: Partial<{ id: string }> = {}) {
  return {
    id: overrides.id ?? "otp-1",
    usuarioId: "usr-1",
    codeHash,
    deviceHash: "dh",
    ipAddress: "1.2.3.4",
    expiresAt: new Date(Date.now() + 600_000),
    consumedAt: null,
    createdAt: new Date(),
  };
}

function buildDeps() {
  const userRepo = {
    findByEmail: vi.fn(),
    updatePasswordHash: vi.fn().mockResolvedValue(undefined),
  };
  const otpRepo = {
    findLatestActiveByUsuarioId: vi.fn(),
    contarRecientesPorUsuario: vi.fn().mockResolvedValue(0),
    markConsumed: vi.fn().mockResolvedValue(undefined),
  };
  const otpIssuer = { emitir: vi.fn().mockResolvedValue({ challengeId: "otp-1" }) };
  const limiter = new ResetRateLimiter(() => 1000);
  return { userRepo, otpRepo, otpIssuer, limiter };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  return new PasswordResetService(
    deps.userRepo,
    deps.otpRepo,
    deps.otpIssuer,
    deps.limiter,
    CONFIG,
  );
}

const CTX = { deviceHash: "dh", ipAddress: "1.2.3.4" };

describe("PasswordResetService", () => {
  it("R1/R3: email inexistente devuelve respuesta generica y no emite OTP", async () => {
    const deps = buildDeps();
    deps.userRepo.findByEmail.mockResolvedValue(null);
    const service = buildService(deps);

    const result = await service.solicitar({ email: "no@existe.com", ...CTX });

    expect(result).toEqual({ status: "ok" });
    expect(deps.otpIssuer.emitir).not.toHaveBeenCalled();
  });

  it("R2/R4: email existente emite OTP (el hash lo maneja el issuer)", async () => {
    const deps = buildDeps();
    deps.userRepo.findByEmail.mockResolvedValue(USUARIO);
    const service = buildService(deps);

    const result = await service.solicitar({ email: USUARIO.email, ...CTX });

    expect(result).toEqual({ status: "ok" });
    expect(deps.otpIssuer.emitir).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "usr-1", email: USUARIO.email }),
    );
  });

  it("R5/R6: verificar codigo incorrecto o expirado devuelve error generico", async () => {
    const deps = buildDeps();
    deps.userRepo.findByEmail.mockResolvedValue(USUARIO);
    deps.otpRepo.findLatestActiveByUsuarioId.mockResolvedValue(null); // sin desafio activo
    const service = buildService(deps);

    const result = await service.verificarCodigo({
      email: USUARIO.email,
      code: "000000",
      ipAddress: "1.2.3.4",
    });

    expect(result).toEqual({ status: "invalid_or_expired" });
  });

  it("R5: verificar codigo correcto devuelve ok sin consumir el desafio", async () => {
    const deps = buildDeps();
    const codeHash = await hashPassword("123456");
    deps.userRepo.findByEmail.mockResolvedValue(USUARIO);
    deps.otpRepo.findLatestActiveByUsuarioId.mockResolvedValue(buildChallenge(codeHash));
    const service = buildService(deps);

    const result = await service.verificarCodigo({
      email: USUARIO.email,
      code: "123456",
      ipAddress: "1.2.3.4",
    });

    expect(result).toEqual({ status: "ok" });
    expect(deps.otpRepo.markConsumed).not.toHaveBeenCalled();
  });

  it("R9/R10: restablecer con codigo valido hashea, persiste y marca consumido", async () => {
    const deps = buildDeps();
    const codeHash = await hashPassword("123456");
    deps.userRepo.findByEmail.mockResolvedValue(USUARIO);
    deps.otpRepo.findLatestActiveByUsuarioId.mockResolvedValue(buildChallenge(codeHash));
    const service = buildService(deps);

    const result = await service.restablecer({
      email: USUARIO.email,
      code: "123456",
      newPassword: "Abcdef1!",
      ipAddress: "1.2.3.4",
    });

    expect(result).toEqual({ status: "ok" });
    expect(deps.userRepo.updatePasswordHash).toHaveBeenCalledTimes(1);
    const [, hash] = deps.userRepo.updatePasswordHash.mock.calls[0];
    expect(hash).not.toBe("Abcdef1!"); // se persiste el hash, no el texto plano
    expect(deps.otpRepo.markConsumed).toHaveBeenCalledWith("otp-1");
  });

  it("R11: restablecer con desafio ya consumido/expirado no modifica la contrasena", async () => {
    const deps = buildDeps();
    deps.userRepo.findByEmail.mockResolvedValue(USUARIO);
    deps.otpRepo.findLatestActiveByUsuarioId.mockResolvedValue(null);
    const service = buildService(deps);

    const result = await service.restablecer({
      email: USUARIO.email,
      code: "123456",
      newPassword: "Abcdef1!",
      ipAddress: "1.2.3.4",
    });

    expect(result).toEqual({ status: "invalid_or_expired" });
    expect(deps.userRepo.updatePasswordHash).not.toHaveBeenCalled();
    expect(deps.otpRepo.markConsumed).not.toHaveBeenCalled();
  });

  it("R13: un OTP con codigo de otro no restablece (codigo no coincide)", async () => {
    const deps = buildDeps();
    const codeHash = await hashPassword("111111"); // desafio real del usuario
    deps.userRepo.findByEmail.mockResolvedValue(USUARIO);
    deps.otpRepo.findLatestActiveByUsuarioId.mockResolvedValue(buildChallenge(codeHash));
    const service = buildService(deps);

    const result = await service.restablecer({
      email: USUARIO.email,
      code: "999999", // codigo ajeno
      newPassword: "Abcdef1!",
      ipAddress: "1.2.3.4",
    });

    expect(result).toEqual({ status: "invalid_or_expired" });
    expect(deps.userRepo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("R14: no registra el codigo ni la contrasena en claro", async () => {
    const deps = buildDeps();
    const codeHash = await hashPassword("123456");
    deps.userRepo.findByEmail.mockResolvedValue(USUARIO);
    deps.otpRepo.findLatestActiveByUsuarioId.mockResolvedValue(buildChallenge(codeHash));
    const service = buildService(deps);

    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];

    await service.restablecer({
      email: USUARIO.email,
      code: "123456",
      newPassword: "Abcdef1!",
      ipAddress: "1.2.3.4",
    });

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const texto = call.map((a) => String(a)).join(" ");
        expect(texto).not.toContain("123456");
        expect(texto).not.toContain("Abcdef1!");
      }
      spy.mockRestore();
    }
  });

  it("R19: supera RESET_MAX_REQUESTS -> no emite OTP pero responde generico", async () => {
    const deps = buildDeps();
    deps.userRepo.findByEmail.mockResolvedValue(USUARIO);
    deps.otpRepo.contarRecientesPorUsuario.mockResolvedValue(3); // == RESET_MAX_REQUESTS
    const service = buildService(deps);

    const result = await service.solicitar({ email: USUARIO.email, ...CTX });

    expect(result).toEqual({ status: "ok" });
    expect(deps.otpIssuer.emitir).not.toHaveBeenCalled();
  });

  it("R20: supera RESET_MAX_VERIFY_ATTEMPTS -> invalid_or_expired sin tocar repos", async () => {
    const deps = buildDeps();
    const codeHash = await hashPassword("123456");
    deps.userRepo.findByEmail.mockResolvedValue(USUARIO);
    deps.otpRepo.findLatestActiveByUsuarioId.mockResolvedValue(buildChallenge(codeHash));
    const service = buildService(deps);

    // Consume el cupo (5) con intentos previos.
    for (let i = 0; i < 5; i++) {
      await service.verificarCodigo({
        email: USUARIO.email,
        code: "000000",
        ipAddress: "1.2.3.4",
      });
    }
    deps.otpRepo.findLatestActiveByUsuarioId.mockClear();

    // El 6.o intento debe cortar antes de mirar el desafio.
    const result = await service.verificarCodigo({
      email: USUARIO.email,
      code: "123456",
      ipAddress: "1.2.3.4",
    });

    expect(result).toEqual({ status: "invalid_or_expired" });
    expect(deps.otpRepo.findLatestActiveByUsuarioId).not.toHaveBeenCalled();
    expect(deps.userRepo.updatePasswordHash).not.toHaveBeenCalled();
  });
});
