import { describe, it, expect, vi } from "vitest";
import { AuthService } from "@/lib/services/AuthService";
import { hashPassword } from "@/lib/utils/password";
import type { IUserRepository, UsuarioConHash } from "@/lib/interfaces/repositories/IUserRepository";
import type { ILoginAttemptRepository } from "@/lib/interfaces/repositories/ILoginAttemptRepository";
import type { ITrustedDeviceRepository } from "@/lib/interfaces/repositories/ITrustedDeviceRepository";
import type { IEmailOtpChallengeRepository } from "@/lib/interfaces/repositories/IEmailOtpChallengeRepository";
import type { ISessionRepository } from "@/lib/interfaces/repositories/ISessionRepository";
import type { IRiskEngine } from "@/lib/interfaces/services/IRiskEngine";
import type { IEmailProvider } from "@/lib/interfaces/external/IEmailProvider";

// Feature 21 / R23 (regresion, NO reimplementa): una cuenta recien postulada
// queda en estado `pendiente` y el login existente la rechaza como
// `account_unavailable` (no puede iniciar sesion hasta ser aprobada en la f22).

async function buildPendiente(): Promise<UsuarioConHash> {
  return {
    id: "usr-pend",
    nombre: "Nuevo",
    email: "nuevo@example.com",
    telefono: "0991234567",
    passwordHash: await hashPassword("Abcdef1!"),
    estado: "pendiente",
    cedula: "1710034065",
    tipoIdentificacionId: "tipo-1",
    rolId: "rol-mensajero",
    fulfillment: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("R23: login de cuenta pendiente", () => {
  it("devuelve account_unavailable y no concede sesion", async () => {
    const usuario = await buildPendiente();
    const userRepo: IUserRepository = {
      findByEmailWithHash: vi.fn().mockResolvedValue(usuario),
      findById: vi.fn(),
      findByEmail: vi.fn(),
      create: vi.fn(),
      listByRol: vi.fn().mockResolvedValue([]),
      listMensajeros: vi.fn().mockResolvedValue([]),
      listAdminTiendas: vi.fn().mockResolvedValue([]),
      updatePasswordHash: vi.fn(),
      list: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      setEstado: vi.fn(),
      listTiposIdentificacion: vi.fn(),
      listRoles: vi.fn(),
    };
    const loginAttemptRepo: ILoginAttemptRepository = {
      registrar: vi.fn(),
      contarFallosConsecutivosRecientes: vi.fn().mockResolvedValue(0),
      ipReconocida: vi.fn().mockResolvedValue(true),
    };
    const trustedDeviceRepo: ITrustedDeviceRepository = {
      findByUsuarioAndDevice: vi.fn(),
      upsert: vi.fn(),
    };
    const otpRepo: IEmailOtpChallengeRepository = {
      create: vi.fn(),
      findActiveById: vi.fn(),
      markConsumed: vi.fn(),
      findLatestActiveByUsuarioId: vi.fn(),
      contarRecientesPorUsuario: vi.fn().mockResolvedValue(0),
    };
    const sessionRepo: ISessionRepository = {
      create: vi.fn(),
      findValidById: vi.fn(),
      deleteById: vi.fn(),
    };
    const riskEngine: IRiskEngine = {
      evaluate: vi.fn().mockResolvedValue({ score: 0, reasons: [], isHigh: false }),
    };
    const emailProvider: IEmailProvider = { sendOtpCode: vi.fn() };

    const auth = new AuthService(
      userRepo,
      loginAttemptRepo,
      trustedDeviceRepo,
      otpRepo,
      sessionRepo,
      riskEngine,
      emailProvider,
    );

    const result = await auth.login({
      email: usuario.email,
      password: "Abcdef1!",
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
    });

    expect(result).toEqual({ status: "account_unavailable" });
    expect(sessionRepo.create).not.toHaveBeenCalled();
  });
});
