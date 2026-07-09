export interface RiskEvaluationInput {
  usuarioId: string;
  deviceHash: string;
  ipAddress: string;
}

export interface RiskEvaluationResult {
  score: number;
  reasons: string[];
  isHigh: boolean;
}

export interface IRiskEngine {
  /** R15-R17: calcula la senal de riesgo de un intento de login exitoso en credenciales. */
  evaluate(input: RiskEvaluationInput): Promise<RiskEvaluationResult>;
}
