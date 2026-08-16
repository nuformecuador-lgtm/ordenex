import type { PrismaClient } from "@prisma/client";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";

type OrdenMensajeroMetaPrismaClient = Pick<PrismaClient, "ordenMensajeroMeta">;

// Feature 115 — acceso a `orden_mensajero_meta`. Solo Prisma, sin logica de negocio ni
// permisos.
//
// Feature 227 (R20/R23): los metodos `nota` que la feature 116 habia añadido aqui
// (`upsertNota`/`limpiarNota`/`findNotasByMensajero`) se RETIRARON junto con la columna
// `orden_mensajero_meta.nota` (migracion `*_orden_mensajero_meta_drop_nota`). La conversacion
// entre tienda y mensajero vive ahora en la tabla `orden_nota`. Esta clase vuelve a ser
// EXCLUSIVAMENTE la de `marcar_luego` (115), que no cambia (R24).
export class OrdenMensajeroMetaRepository implements IOrdenMensajeroMetaRepository {
  constructor(private readonly prisma: OrdenMensajeroMetaPrismaClient) {}

  async upsertMarcarLuego(usuarioId: string, ordenId: string, marcarLuego: boolean): Promise<void> {
    // R5/R6/R7: idempotente por el `UNIQUE(usuario_id, orden_id)`. `create` fija `marcar_luego`;
    // `update` SOLO toca `marcar_luego`, que desde la 227 es lo unico que la fila guarda.
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
