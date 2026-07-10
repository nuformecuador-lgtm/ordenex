// Contrato del servicio de recuperacion de contrasena (Feature 20). La capa
// Service no conoce Next.js: recibe contexto ya resuelto (deviceHash/ip) y
// devuelve resultados de dominio genericos (no enumeracion de usuarios).

export interface SolicitarResetInput {
  email: string;
  deviceHash: string;
  ipAddress: string;
}

export interface VerificarCodigoInput {
  email: string;
  code: string;
  ipAddress: string;
}

export interface RestablecerInput {
  email: string;
  code: string;
  newPassword: string;
  ipAddress: string;
}

/** Respuesta generica de solicitud: nunca revela si la cuenta existe (R1/R3). */
export type SolicitarResetResult = { status: "ok" };

/** Resultado de verificacion/restablecimiento (R5/R6/R9/R10/R11). */
export type ResetOutcome = { status: "ok" } | { status: "invalid_or_expired" };

export interface IPasswordResetService {
  solicitar(input: SolicitarResetInput): Promise<SolicitarResetResult>;
  verificarCodigo(input: VerificarCodigoInput): Promise<ResetOutcome>;
  restablecer(input: RestablecerInput): Promise<ResetOutcome>;
}
