import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "@/lib/services/AuthService";
import { hashPassword } from "@/lib/utils/password";
import type { IUserRepository, UsuarioConHash } from "@/lib/interfaces/repositories/IUserRepository";
import type { ILoginAttemptRepository } from "@/lib/interfaces/repositories/ILoginAttemptRepository";
import type { ITrustedDeviceRepository } from "@/lib/interfaces/repositories/ITrustedDeviceRepository";
import type { IEmailOtpChallengeRepository } from "@/lib/interfaces/repositories/IEmailOtpChallengeRepository";
import type { ISessionRepository } from "@/lib/interfaces/repositories/ISessionRepository";
import type { IRiskEngine } from "@/lib/interfaces/services/IRiskEngine";
import type { IEmailProvider } from "@/lib/interfaces/external/IEmailProvider";

const REQUEST_CONTEXT = { ipAddress: "1.2.3.4", userAgent: "vitest-agent" };

async function buildUsuario(overrides: Partial<UsuarioConHash> = {}): Promise<UsuarioConHash> {
  return {
    id: "usr-1",
    nombre: "Ana",
    email: "ana@example.com",
    telefono: "0991234567",
    passwordHash: await hashPassword("clave-correcta"),
    estado: "activo",
    cedula: "1710034065",
    tipoIdentificacionId: "tipo-1",
    rolId: "rol-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildMocks() {
  const userRepo: IUserRepository = {
    findByEmailWithHash: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    listMensajeros: vi.fn().mockResolvedValue([]),
  };
  const loginAttemptRepo: ILoginAttemptRepository = {
    registrar: vi.fn(),
    contarFallosConsecutivosRecientes: vi.fn().mockResolvedValue(0),
    ipReconocida: vi.fn().mockResolvedValue(true),
  };
  const trustedDeviceRepo: ITrustedDeviceRepository = {
    findByUsuarioAndDevice: vi.fn().mockResolvedValue({ id: "td-1" }),
    upsert: vi.fn(),
  };
  const otpRepo: IEmailOtpChallengeRepository = {
    create: vi.fn().mockResolvedValue({
      id: "challenge-1",
      usuarioId: "usr-1",
      codeHash: "hash",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
      createdAt: new Date(),
    }),
    findActiveById: vi.fn(),
    markConsumed: vi.fn(),
  };
  const sessionRepo: ISessionRepository = {
    create: vi.fn().mockResolvedValue({
      id: "sess-1",
      userId: "usr-1",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    }),
    findValidById: vi.fn(),
    deleteById: vi.fn(),
  };
  const riskEngine: IRiskEngine = {
    evaluate: vi.fn().mockResolvedValue({ score: 0, reasons: [], isHigh: false }),
  };
  const emailProvider: IEmailProvider = { sendOtpCode: vi.fn() };

  const authService = new AuthService(
    userRepo,
    loginAttemptRepo,
    trustedDeviceRepo,
    otpRepo,
    sessionRepo,
    riskEngine,
    emailProvider,
  );

  return {
    authService,
    userRepo,
    loginAttemptRepo,
    trustedDeviceRepo,
    otpRepo,
    sessionRepo,
    riskEngine,
    emailProvider,
  };
}

describe("AuthService.login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("R12: devuelve invalid_credentials si el email no existe, sin revelar el motivo", async () => {
    const mocks = buildMocks();
    (mocks.userRepo.findByEmailWithHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await mocks.authService.login({
      email: "no-existe@example.com",
      password: "cualquiera",
      ...REQUEST_CONTEXT,
    });

    expect(result).toEqual({ status: "invalid_credentials" });
    expect(mocks.loginAttemptRepo.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: null, exitoso: false }),
    );
  });

  it("R11, R12: devuelve invalid_credentials si la contrasena no coincide", async () => {
    const mocks = buildMocks();
    const usuario = await buildUsuario();
    (mocks.userRepo.findByEmailWithHash as ReturnType<typeof vi.fn>).mockResolvedValue(usuario);

    const result = await mocks.authService.login({
      email: usuario.email,
      password: "clave-incorrecta",
      ...REQUEST_CONTEXT,
    });

    expect(result).toEqual({ status: "invalid_credentials" });
  });

  it("R13: rechaza con account_unavailable si el estado no es activo aunque la contrasena sea correcta", async () => {
    const mocks = buildMocks();
    const usuario = await buildUsuario({ estado: "inactivo" });
    (mocks.userRepo.findByEmailWithHash as ReturnType<typeof vi.fn>).mockResolvedValue(usuario);

    const result = await mocks.authService.login({
      email: usuario.email,
      password: "clave-correcta",
      ...REQUEST_CONTEXT,
    });

    expect(result).toEqual({ status: "account_unavailable" });
  });

  it("R14, R16: concede sesion directa cuando el riesgo es bajo", async () => {
    const mocks = buildMocks();
    const usuario = await buildUsuario();
    (mocks.userRepo.findByEmailWithHash as ReturnType<typeof vi.fn>).mockResolvedValue(usuario);
    (mocks.riskEngine.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({
      score: 0,
      reasons: [],
      isHigh: false,
    });

    const result = await mocks.authService.login({
      email: usuario.email,
      password: "clave-correcta",
      ...REQUEST_CONTEXT,
    });

    expect(result.status).toBe("ok");
    expect(mocks.sessionRepo.create).toHaveBeenCalledWith({ userId: usuario.id, ttlHours: 24 });
    expect(mocks.trustedDeviceRepo.upsert).toHaveBeenCalled();
    expect(mocks.otpRepo.create).not.toHaveBeenCalled();
  });

  it("R17: exige challenge_required cuando el riesgo es alto", async () => {
    const mocks = buildMocks();
    const usuario = await buildUsuario();
    (mocks.userRepo.findByEmailWithHash as ReturnType<typeof vi.fn>).mockResolvedValue(usuario);
    (mocks.riskEngine.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({
      score: 90,
      reasons: ["dispositivo_no_reconocido"],
      isHigh: true,
    });

    const result = await mocks.authService.login({
      email: usuario.email,
      password: "clave-correcta",
      ...REQUEST_CONTEXT,
    });

    expect(result).toEqual({ status: "challenge_required", challengeId: "challenge-1" });
    expect(mocks.otpRepo.create).toHaveBeenCalledTimes(1);
    expect(mocks.emailProvider.sendOtpCode).toHaveBeenCalledTimes(1);
    expect(mocks.sessionRepo.create).not.toHaveBeenCalled();
  });

  it("R21, R21a: el 6to intento dentro de la ventana devuelve account_locked aun con credenciales correctas", async () => {
    const mocks = buildMocks();
    const usuario = await buildUsuario();
    (mocks.userRepo.findByEmailWithHash as ReturnType<typeof vi.fn>).mockResolvedValue(usuario);
    (mocks.loginAttemptRepo.contarFallosConsecutivosRecientes as ReturnType<typeof vi.fn>).mockResolvedValue(5);

    const result = await mocks.authService.login({
      email: usuario.email,
      password: "clave-correcta",
      ...REQUEST_CONTEXT,
    });

    expect(result).toEqual({ status: "account_locked", retryAfterMinutes: 15 });
    expect(mocks.riskEngine.evaluate).not.toHaveBeenCalled();
  });

  it("R21: el bloqueo caduca pasados 15 minutos (ventana ya no reporta 5 fallos)", async () => {
    const mocks = buildMocks();
    const usuario = await buildUsuario();
    (mocks.userRepo.findByEmailWithHash as ReturnType<typeof vi.fn>).mockResolvedValue(usuario);
    // Simula que, tiempo despues, la ventana de 15 min ya no contiene los fallos.
    (mocks.loginAttemptRepo.contarFallosConsecutivosRecientes as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    const result = await mocks.authService.login({
      email: usuario.email,
      password: "clave-correcta",
      ...REQUEST_CONTEXT,
    });

    expect(result.status).toBe("ok");
  });

  it("R22: un intento exitoso registra el intento como exitoso (base del reinicio de contador)", async () => {
    const mocks = buildMocks();
    const usuario = await buildUsuario();
    (mocks.userRepo.findByEmailWithHash as ReturnType<typeof vi.fn>).mockResolvedValue(usuario);

    await mocks.authService.login({
      email: usuario.email,
      password: "clave-correcta",
      ...REQUEST_CONTEXT,
    });

    expect(mocks.loginAttemptRepo.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: usuario.id, exitoso: true }),
    );
  });
});

describe("AuthService.verifyChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("R19: OTP valido concede sesion y confia el dispositivo", async () => {
    const mocks = buildMocks();
    const code = "654321";
    const bcrypt = await import("bcryptjs");
    const codeHash = await bcrypt.default.hash(code, 10);
    (mocks.otpRepo.findActiveById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "challenge-1",
      usuarioId: "usr-1",
      codeHash,
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
      createdAt: new Date(),
    });
    (mocks.userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(await buildUsuario());

    const result = await mocks.authService.verifyChallenge({
      challengeId: "challenge-1",
      code,
      ...REQUEST_CONTEXT,
    });

    expect(result.status).toBe("ok");
    expect(mocks.otpRepo.markConsumed).toHaveBeenCalledWith("challenge-1");
    expect(mocks.trustedDeviceRepo.upsert).toHaveBeenCalledWith({
      usuarioId: "usr-1",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
    });
  });

  it("R20: OTP invalido no concede sesion", async () => {
    const mocks = buildMocks();
    const bcrypt = await import("bcryptjs");
    const codeHash = await bcrypt.default.hash("111111", 10);
    (mocks.otpRepo.findActiveById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "challenge-1",
      usuarioId: "usr-1",
      codeHash,
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
      createdAt: new Date(),
    });

    const result = await mocks.authService.verifyChallenge({
      challengeId: "challenge-1",
      code: "999999",
      ...REQUEST_CONTEXT,
    });

    expect(result).toEqual({ status: "invalid_or_expired" });
    expect(mocks.sessionRepo.create).not.toHaveBeenCalled();
  });

  it("R20: OTP expirado (challenge inactivo) no concede sesion", async () => {
    const mocks = buildMocks();
    (mocks.otpRepo.findActiveById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await mocks.authService.verifyChallenge({
      challengeId: "challenge-vencido",
      code: "123456",
      ...REQUEST_CONTEXT,
    });

    expect(result).toEqual({ status: "invalid_or_expired" });
    expect(mocks.sessionRepo.create).not.toHaveBeenCalled();
  });
});

describe("AuthService.logout", () => {
  it("R24: elimina el registro de sesion", async () => {
    const mocks = buildMocks();
    await mocks.authService.logout("sess-1");
    expect(mocks.sessionRepo.deleteById).toHaveBeenCalledWith("sess-1");
  });
});
