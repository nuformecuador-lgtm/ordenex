import { Prisma, type PrismaClient } from "@prisma/client";
import type { ISessionRepository, SessionRecord } from "@/lib/interfaces/repositories/ISessionRepository";

type SessionPrismaClient = Pick<PrismaClient, "session">;

export class SessionRepository implements ISessionRepository {
  constructor(private readonly prisma: SessionPrismaClient) {}

  async create(params: { userId: string; ttlHours: number }): Promise<SessionRecord> {
    const expiresAt = new Date(Date.now() + params.ttlHours * 60 * 60 * 1000);
    return this.prisma.session.create({ data: { userId: params.userId, expiresAt } });
  }

  async findValidById(id: string): Promise<SessionRecord | null> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null; // R23a
    return session;
  }

  async deleteById(id: string): Promise<void> {
    try {
      await this.prisma.session.delete({ where: { id } });
    } catch (error) {
      // Idempotente (R24): si ya no existe, el logout no debe fallar.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return;
      }
      throw error;
    }
  }

  /**
   * Feature 287/R16/R19 — TODAS las sesiones del usuario, expiradas o no. Devuelve el `count`.
   *
   * SIN LOGICA DE NEGOCIO: el `where` es el `userId` y nada mas. Que el filtro NO mire
   * `expiresAt` es el requisito (R16), no un descuido — una sesion sin expirar es justo la que
   * hay que cerrar. El `deleteMany` de Prisma no lanza cuando no encuentra filas: devuelve
   * `{ count: 0 }`, asi que el metodo es idempotente sin un `try` que mantener.
   *
   * NOTA MEDIDA (design §4): `Session.userId` NO tiene indice, asi que esto es un recorrido
   * secuencial. Se acepta a sabiendas: es una accion manual y rara, ni ruta caliente ni cron.
   */
  async deleteAllByUserId(userId: string): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({ where: { userId } });
    return count;
  }
}
