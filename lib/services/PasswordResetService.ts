import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IEmailOtpChallengeRepository } from "@/lib/interfaces/repositories/IEmailOtpChallengeRepository";
import type { OtpChallengeIssuer } from "@/lib/services/OtpChallengeIssuer";
import type { AuthConfig } from "@/lib/config/auth";
import { authConfig } from "@/lib/config/auth";
import { hashPassword, verifyPassword } from "@/lib/utils/password";
import { ResetRateLimiter, buildResetRateKey } from "@/lib/utils/reset-rate-limit";
import type {
  IPasswordResetService,
  RestablecerInput,
  ResetOutcome,
  SolicitarResetInput,
  SolicitarResetResult,
  VerificarCodigoInput,
} from "@/lib/interfaces/services/IPasswordResetService";

/** Dependencias del servicio, todas inyectables para test. */
type ResetUserRepo = Pick<IUserRepository, "findByEmail" | "updatePasswordHash">;
type ResetOtpRepo = Pick<
  IEmailOtpChallengeRepository,
  "findLatestActiveByUsuarioId" | "contarRecientesPorUsuario" | "markConsumed"
>;
type ResetOtpIssuer = Pick<OtpChallengeIssuer, "emitir">;

/**
 * Logica de negocio del reset de contrasena (Feature 20). Servicio dedicado
 * (design.md decision 1): solo depende de usuario + OTP + emisor + limitador.
 * No crea sesion, no evalua riesgo, no confia dispositivos, no escribe en
 * `login_attempt` y nunca bloquea la cuenta (R20). Respuestas genericas para
 * no filtrar existencia de cuentas (R1/R3/R6). No loguea email ni codigo (R14).
 */
export class PasswordResetService implements IPasswordResetService {
  constructor(
    private readonly userRepo: ResetUserRepo,
    private readonly otpRepo: ResetOtpRepo,
    private readonly otpIssuer: ResetOtpIssuer,
    private readonly verifyLimiter: ResetRateLimiter = new ResetRateLimiter(),
    private readonly config: AuthConfig = authConfig,
  ) {}

  /**
   * R1/R2/R3/R19: si el email existe y no supero el limite de solicitudes,
   * emite un OTP; en cualquier otro caso no hace nada. SIEMPRE devuelve la
   * misma respuesta generica.
   */
  async solicitar(input: SolicitarResetInput): Promise<SolicitarResetResult> {
    const usuario = await this.userRepo.findByEmail(input.email);
    if (usuario) {
      const recientes = await this.otpRepo.contarRecientesPorUsuario(
        usuario.id,
        this.config.RESET_REQUEST_WINDOW_MINUTES,
      );
      if (recientes < this.config.RESET_MAX_REQUESTS) {
        await this.otpIssuer.emitir({
          usuarioId: usuario.id,
          email: usuario.email,
          deviceHash: input.deviceHash,
          ipAddress: input.ipAddress,
        });
      }
    }
    return { status: "ok" };
  }

  /**
   * R5/R6/R20: verifica el codigo contra el desafio activo del usuario. No
   * consume el desafio (design.md decision 3). Aplica el limitador por email/IP.
   */
  async verificarCodigo(input: VerificarCodigoInput): Promise<ResetOutcome> {
    if (this.limiteVerificacionSuperado(input.email, input.ipAddress)) {
      return { status: "invalid_or_expired" };
    }
    this.registrarIntento(input.email, input.ipAddress);

    const valido = await this.codigoCoincideConDesafioActivo(input.email, input.code);
    return valido ? { status: "ok" } : { status: "invalid_or_expired" };
  }

  /**
   * R9/R10/R11/R13/R20: re-verifica el desafio activo y, si es valido, hashea
   * la nueva contrasena, la persiste y marca el desafio como consumido. Si el
   * desafio ya no esta activo, no toca la contrasena.
   */
  async restablecer(input: RestablecerInput): Promise<ResetOutcome> {
    if (this.limiteVerificacionSuperado(input.email, input.ipAddress)) {
      return { status: "invalid_or_expired" };
    }
    this.registrarIntento(input.email, input.ipAddress);

    const usuario = await this.userRepo.findByEmail(input.email);
    if (!usuario) return { status: "invalid_or_expired" };

    const challenge = await this.otpRepo.findLatestActiveByUsuarioId(usuario.id);
    if (!challenge) return { status: "invalid_or_expired" };

    const codigoValido = await verifyPassword(input.code, challenge.codeHash);
    if (!codigoValido) return { status: "invalid_or_expired" };

    const nuevoHash = await hashPassword(input.newPassword);
    await this.userRepo.updatePasswordHash(usuario.id, nuevoHash); // R9
    await this.otpRepo.markConsumed(challenge.id); // R10
    return { status: "ok" };
  }

  private limiteVerificacionSuperado(email: string, ip: string): boolean {
    return this.verifyLimiter.superaLimite(
      buildResetRateKey(email, ip),
      this.config.RESET_MAX_VERIFY_ATTEMPTS,
      this.config.RESET_VERIFY_WINDOW_MINUTES * 60_000,
    );
  }

  private registrarIntento(email: string, ip: string): void {
    this.verifyLimiter.registrar(buildResetRateKey(email, ip));
  }

  private async codigoCoincideConDesafioActivo(
    email: string,
    code: string,
  ): Promise<boolean> {
    const usuario = await this.userRepo.findByEmail(email);
    if (!usuario) return false;
    const challenge = await this.otpRepo.findLatestActiveByUsuarioId(usuario.id);
    if (!challenge) return false;
    return verifyPassword(code, challenge.codeHash);
  }
}
