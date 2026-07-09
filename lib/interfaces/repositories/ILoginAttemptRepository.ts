export interface RegistrarIntentoInput {
  usuarioId: string | null;
  emailUsado: string;
  exitoso: boolean;
  ipAddress: string;
  userAgent: string;
  riskScore: number;
  riskReason: string;
}

export interface ILoginAttemptRepository {
  registrar(input: RegistrarIntentoInput): Promise<void>;
  /**
   * Cuenta fallos consecutivos mas recientes (desde el ultimo exito hacia
   * atras, o desde el inicio del historial) dentro de la ventana dada.
   * Usado tanto para el bloqueo temporal duro (R21) como para la senal de
   * riesgo de "fallos recientes" (R15).
   */
  contarFallosConsecutivosRecientes(params: {
    usuarioId: string;
    ventanaMinutos: number;
  }): Promise<number>;
  /** Senal de riesgo: si la IP ya tuvo un login exitoso previo del usuario. */
  ipReconocida(params: { usuarioId: string; ipAddress: string }): Promise<boolean>;
}
