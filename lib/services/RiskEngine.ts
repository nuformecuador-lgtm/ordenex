import type { ILoginAttemptRepository } from "@/lib/interfaces/repositories/ILoginAttemptRepository";
import type { ITrustedDeviceRepository } from "@/lib/interfaces/repositories/ITrustedDeviceRepository";
import type {
  IRiskEngine,
  RiskEvaluationInput,
  RiskEvaluationResult,
} from "@/lib/interfaces/services/IRiskEngine";
import { authConfig } from "@/lib/config/auth";

// Pesos conceptuales de cada senal (design.md). El umbral de decision, en
// cambio, viene de configuracion (RISK_THRESHOLD), nunca hardcodeado.
const WEIGHT_DEVICE_NO_RECONOCIDO = 40;
const WEIGHT_IP_NO_RECONOCIDA = 30;
const WEIGHT_FALLOS_RECIENTES = 40;

export class RiskEngine implements IRiskEngine {
  constructor(
    private readonly loginAttemptRepo: ILoginAttemptRepository,
    private readonly trustedDeviceRepo: ITrustedDeviceRepository,
    private readonly riskThreshold: number = authConfig.RISK_THRESHOLD,
    private readonly ventanaFallosMinutos: number = authConfig.LOCKOUT_MINUTES,
  ) {}

  async evaluate(input: RiskEvaluationInput): Promise<RiskEvaluationResult> {
    const reasons: string[] = [];
    let score = 0;

    const dispositivoReconocido = await this.trustedDeviceRepo.findByUsuarioAndDevice(
      input.usuarioId,
      input.deviceHash,
    );
    if (!dispositivoReconocido) {
      score += WEIGHT_DEVICE_NO_RECONOCIDO;
      reasons.push("dispositivo_no_reconocido");
    }

    const ipReconocida = await this.loginAttemptRepo.ipReconocida({
      usuarioId: input.usuarioId,
      ipAddress: input.ipAddress,
    });
    if (!ipReconocida) {
      score += WEIGHT_IP_NO_RECONOCIDA;
      reasons.push("ip_no_reconocida");
    }

    const fallosRecientes = await this.loginAttemptRepo.contarFallosConsecutivosRecientes({
      usuarioId: input.usuarioId,
      ventanaMinutos: this.ventanaFallosMinutos,
    });
    if (fallosRecientes > 0) {
      score += WEIGHT_FALLOS_RECIENTES;
      reasons.push(`fallos_recientes:${fallosRecientes}`);
    }

    return { score, reasons, isHigh: score >= this.riskThreshold };
  }
}
