export interface EmailOtpChallengeRecord {
  id: string;
  usuarioId: string;
  codeHash: string;
  deviceHash: string;
  ipAddress: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface CreateEmailOtpChallengeInput {
  usuarioId: string;
  codeHash: string;
  deviceHash: string;
  ipAddress: string;
  expiresAt: Date;
}

export interface IEmailOtpChallengeRepository {
  create(input: CreateEmailOtpChallengeInput): Promise<EmailOtpChallengeRecord>;
  /** Devuelve null si no existe, ya fue consumido, o ya expiro (R20). */
  findActiveById(id: string): Promise<EmailOtpChallengeRecord | null>;
  markConsumed(id: string): Promise<void>;
  /**
   * Feature 20/R5/R13: desafio mas reciente del usuario que NO esta consumido
   * ni expirado (`consumedAt = null` y `expiresAt > now`), o `null`.
   */
  findLatestActiveByUsuarioId(usuarioId: string): Promise<EmailOtpChallengeRecord | null>;
  /**
   * Feature 20/R19: cuenta los desafios creados para el usuario dentro de la
   * ventana (por `createdAt`), base del rate-limit durable de solicitudes.
   */
  contarRecientesPorUsuario(usuarioId: string, ventanaMinutos: number): Promise<number>;
}
