import type { PrismaClient } from "@prisma/client";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";

type OrdenMensajeroMetaPrismaClient = Pick<PrismaClient, "ordenMensajeroMeta">;

// Feature 115 — acceso a `orden_mensajero_meta`. Solo Prisma, sin logica de negocio ni
// permisos. La feature 116 EXTENDERA esta clase con los metodos `nota` sobre la misma tabla.
export class OrdenMensajeroMetaRepository implements IOrdenMensajeroMetaRepository {
  constructor(private readonly prisma: OrdenMensajeroMetaPrismaClient) {}

  async upsertMarcarLuego(usuarioId: string, ordenId: string, marcarLuego: boolean): Promise<void> {
    // R5/R6/R7: idempotente por el `UNIQUE(usuario_id, orden_id)`. `create` fija `marcar_luego`;
    // `update` SOLO toca `marcar_luego` (no pisa `nota` de la feature 116 si ya existiera).
    await this.prisma.ordenMensajeroMeta.upsert({
      where: { usuarioId_ordenId: { usuarioId, ordenId } },
      create: { usuarioId, ordenId, marcarLuego },
      update: { marcarLuego },
    });
  }

  async findMarcarLuegoByMensajero(usuarioId: string): Promise<Set<string>> {
    // R17/R20: solo las filas del PROPIO mensajero con la marca activa; devuelve el conjunto de
    // `ordenId` para que el llamador resuelva `marcarLuego` por orden en O(1).
    const rows = await this.prisma.ordenMensajeroMeta.findMany({
      where: { usuarioId, marcarLuego: true },
      select: { ordenId: true },
    });
    return new Set(rows.map((r) => r.ordenId));
  }
}
