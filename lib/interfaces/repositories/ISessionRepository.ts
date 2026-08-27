export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ISessionRepository {
  create(params: { userId: string; ttlHours: number }): Promise<SessionRecord>;
  /** Devuelve null si no existe o si `expiresAt` ya paso (R23a). */
  findValidById(id: string): Promise<SessionRecord | null>;
  /** Idempotente: no falla si la sesion ya no existe (R24). */
  deleteById(id: string): Promise<void>;
  /**
   * Feature 287/R16/R19 — borra TODAS las sesiones del usuario, incluidas las que aun no han
   * expirado, y devuelve cuantas borro (el numero que se le informa al maestro, R19).
   *
   * POR QUE **TODAS** Y NO SOLO LAS VIVAS. La sesion es un PORTADOR de acceso: una cookie con
   * el `id` de la fila basta para actuar como esa persona hasta `AUTH_SESSION_TTL_HOURS` (24 h
   * por defecto). Rotar la contrasena dejando sesiones vivas deja un agujero de hasta 24 horas
   * en el que la contrasena vieja «sigue sirviendo» en la practica, y el maestro cree haber
   * cortado el acceso sin haber cortado nada.
   *
   * Idempotente por construccion: cero filas es un `0`, no un error.
   */
  deleteAllByUserId(userId: string): Promise<number>;
}
