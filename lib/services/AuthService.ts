import bcrypt from "bcryptjs";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type {
  ILoginAttemptRepository,
  RegistrarIntentoInput,
} from "@/lib/interfaces/repositories/ILoginAttemptRepository";
import type { ITrustedDeviceRepository } from "@/lib/interfaces/repositories/ITrustedDeviceRepository";
import type { IEmailOtpChallengeRepository } from "@/lib/interfaces/repositories/IEmailOtpChallengeRepository";
import type { ISessionRepository } from "@/lib/interfaces/repositories/ISessionRepository";
import type { IRiskEngine } from "@/lib/interfaces/services/IRiskEngine";
import type { IEmailProvider } from "@/lib/interfaces/external/IEmailProvider";
import type {
  IAuthService,
  LoginCommandInput,
  LoginCommandResult,
  VerifyChallengeCommandInput,
  VerifyChallengeCommandResult,
} from "@/lib/interfaces/services/IAuthService";
import { verifyPassword } from "@/lib/utils/password";
import { computeDeviceHash } from "@/lib/utils/device";
import { OtpChallengeIssuer } from "@/lib/services/OtpChallengeIssuer";
import { authConfig } from "@/lib/config/auth";

export class AuthService implements IAuthService {
  private readonly otpIssuer: OtpChallengeIssuer;

  constructor(
    private readonly userRepo: IUserRepository,
    private readonly loginAttemptRepo: ILoginAttemptRepository,
    private readonly trustedDeviceRepo: ITrustedDeviceRepository,
    private readonly otpRepo: IEmailOtpChallengeRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly riskEngine: IRiskEngine,
    private readonly emailProvider: IEmailProvider,
  ) {
    this.otpIssuer = new OtpChallengeIssuer(this.otpRepo, this.emailProvider);
  }

  /**
   * Registra un intento de login rellenando el contexto comun (email, IP,
   * userAgent) y aceptando solo las partes que varian entre call sites.
   */
  private registrarIntento(
    contexto: Pick<RegistrarIntentoInput, "emailUsado" | "ipAddress" | "userAgent">,
    variable: Pick<
      RegistrarIntentoInput,
      "usuarioId" | "exitoso" | "riskScore" | "riskReason"
    >,
  ): Promise<void> {
    return this.loginAttemptRepo.registrar({ ...contexto, ...variable });
  }

  async login(input: LoginCommandInput): Promise<LoginCommandResult> {
    const deviceHash = computeDeviceHash(input.userAgent);
    const contexto = {
      emailUsado: input.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    };
    const usuario = await this.userRepo.findByEmailWithHash(input.email);

    if (!usuario) {
      // R12: no revelar si fue el email o la contrasena lo que fallo.
      await this.registrarIntento(contexto, {
        usuarioId: null,
        exitoso: false,
        riskScore: 0,
        riskReason: "usuario_no_encontrado",
      });
      return { status: "invalid_credentials" };
    }

    // R21/R21a: el bloqueo temporal duro se evalua antes que credenciales o riesgo.
    const fallosConsecutivos = await this.loginAttemptRepo.contarFallosConsecutivosRecientes({
      usuarioId: usuario.id,
      ventanaMinutos: authConfig.LOCKOUT_MINUTES,
    });
    if (fallosConsecutivos >= authConfig.MAX_FAILED_ATTEMPTS) {
      return { status: "account_locked", retryAfterMinutes: authConfig.LOCKOUT_MINUTES };
    }

    const passwordValida = await verifyPassword(input.password, usuario.passwordHash);
    if (!passwordValida) {
      await this.registrarIntento(contexto, {
        usuarioId: usuario.id,
        exitoso: false,
        riskScore: 0,
        riskReason: "password_incorrecta",
      });
      return { status: "invalid_credentials" }; // R12
    }

    if (usuario.estado !== "activo") {
      await this.registrarIntento(contexto, {
        usuarioId: usuario.id,
        exitoso: false,
        riskScore: 0,
        riskReason: `estado_no_activo:${usuario.estado}`,
      });
      return { status: "account_unavailable" }; // R13
    }

    // R14: credenciales validas y cuenta activa -> evaluacion de riesgo (RBA).
    const risk = await this.riskEngine.evaluate({
      usuarioId: usuario.id,
      deviceHash,
      ipAddress: input.ipAddress,
    });

    if (!risk.isHigh) {
      // R16/R22: riesgo bajo -> sesion directa, se confia el dispositivo y se
      // reinicia el contador de fallos (implicito: el intento se registra exitoso).
      await this.trustedDeviceRepo.upsert({
        usuarioId: usuario.id,
        deviceHash,
        ipAddress: input.ipAddress,
      });
      await this.registrarIntento(contexto, {
        usuarioId: usuario.id,
        exitoso: true,
        riskScore: risk.score,
        riskReason: risk.reasons.join(",") || "ninguno",
      });
      const session = await this.sessionRepo.create({
        userId: usuario.id,
        ttlHours: authConfig.SESSION_TTL_HOURS,
      });
      return { status: "ok", sessionId: session.id, expiresAt: session.expiresAt };
    }

    // R17: riesgo alto -> exige OTP por email antes de conceder sesion.
    const { challengeId } = await this.otpIssuer.emitir({
      usuarioId: usuario.id,
      email: usuario.email,
      deviceHash,
      ipAddress: input.ipAddress,
    });
    await this.registrarIntento(contexto, {
      usuarioId: usuario.id,
      exitoso: false,
      riskScore: risk.score,
      riskReason: risk.reasons.join(","),
    });
    return { status: "challenge_required", challengeId };
  }

  async verifyChallenge(
    input: VerifyChallengeCommandInput,
  ): Promise<VerifyChallengeCommandResult> {
    const challenge = await this.otpRepo.findActiveById(input.challengeId);
    if (!challenge) {
      return { status: "invalid_or_expired" }; // R20
    }

    const codigoValido = await bcrypt.compare(input.code, challenge.codeHash);
    if (!codigoValido) {
      return { status: "invalid_or_expired" }; // R20
    }

    await this.otpRepo.markConsumed(challenge.id);

    // R19: OTP superado -> concede sesion y confia el dispositivo/IP.
    await this.trustedDeviceRepo.upsert({
      usuarioId: challenge.usuarioId,
      deviceHash: challenge.deviceHash,
      ipAddress: challenge.ipAddress,
    });

    const usuario = await this.userRepo.findById(challenge.usuarioId);
    await this.registrarIntento(
      {
        emailUsado: usuario?.email ?? "",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      {
        usuarioId: challenge.usuarioId,
        exitoso: true,
        riskScore: 0,
        riskReason: "otp_verificado",
      },
    );

    const session = await this.sessionRepo.create({
      userId: challenge.usuarioId,
      ttlHours: authConfig.SESSION_TTL_HOURS,
    });
    return { status: "ok", sessionId: session.id, expiresAt: session.expiresAt };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionRepo.deleteById(sessionId); // R24
  }
}
