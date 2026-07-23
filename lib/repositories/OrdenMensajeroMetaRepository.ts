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

  // --- Feature 116: nota privada del mensajero sobre la MISMA tabla/columna (`nota`) ---

  async upsertNota(usuarioId: string, ordenId: string, nota: string): Promise<void> {
    // R1/R2/R3/R9: upsert por el `UNIQUE(usuario_id, orden_id)`. `create` fija `nota` (marcar_luego
    // toma su default `false`); `update` toca SOLO `nota` -> PRESERVA el `marcar_luego` de la 115
    // si la fila ya existia (R3). La FK `orden_id -> orden` impide la fila huerfana (R16): si la
    // orden no existe el upsert lanza P2003 y el service lo traduce a `forbidden`.
    await this.prisma.ordenMensajeroMeta.upsert({
      where: { usuarioId_ordenId: { usuarioId, ordenId } },
      create: { usuarioId, ordenId, nota },
      update: { nota },
    });
  }

  async limpiarNota(usuarioId: string, ordenId: string): Promise<void> {
    // R4/R9: `updateMany SET nota = NULL` sobre la fila del actor. NO borra la fila (preserva
    // `marcar_luego`) y es no-op idempotente si no hay fila (`count = 0`), a diferencia de `update`
    // que lanzaria. El WHERE por `usuarioId` acota a la fila del actor (nunca la de otro).
    await this.prisma.ordenMensajeroMeta.updateMany({
      where: { usuarioId, ordenId },
      data: { nota: null },
    });
  }

  async findNotasByMensajero(usuarioId: string): Promise<Map<string, string>> {
    // R6/R8: solo las filas del PROPIO mensajero (`usuario_id = usuarioId`) que tienen nota
    // (`nota IS NOT NULL`); devuelve el mapa `ordenId -> nota` para que el llamador resuelva
    // `notaPrivada` por orden en O(1). Nunca lee la nota de otro mensajero para la misma orden.
    const rows = await this.prisma.ordenMensajeroMeta.findMany({
      where: { usuarioId, nota: { not: null } },
      select: { ordenId: true, nota: true },
    });
    const notas = new Map<string, string>();
    for (const r of rows) {
      if (r.nota !== null) notas.set(r.ordenId, r.nota);
    }
    return notas;
  }
}
