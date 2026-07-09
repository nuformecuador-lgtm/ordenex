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
}
