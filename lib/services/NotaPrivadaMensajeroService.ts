import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { INotaPrivadaMensajeroService } from "@/lib/interfaces/services/INotaPrivadaMensajeroService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GuardarNotaResult, LimpiarNotaResult } from "@/lib/types/nota-privada-mensajero";

// R10: unico rol que puede escribir/limpiar su nota privada.
const ALLOWED_ROL = "mensajero";

/**
 * Feature 116 — logica de negocio de la NOTA PRIVADA del mensajero por orden. Recibe el
 * meta-repo (el de la feature 115) por constructor (DI) y solo usa sus metodos `nota`. No
 * conoce HTTP ni Prisma; testeable con un doble del repo sin red/DB.
 *
 * Escribe UNICAMENTE en `orden_mensajero_meta.nota`: NO toca `orden.notas` (nota de la tienda,
 * R7) ni `marcar_luego` (R3, lo preserva el `upsertNota` del repo). El `usuario_id` es SIEMPRE
 * el del actor autenticado (R6/R8/R9), nunca un dato del input: la privacidad es estructural
 * por la clave (usuario_id, orden_id).
 */
export class NotaPrivadaMensajeroService implements INotaPrivadaMensajeroService {
  constructor(
    private readonly metaRepo: Pick<IOrdenMensajeroMetaRepository, "upsertNota" | "limpiarNota">,
  ) {}

  async guardar(ordenId: string, nota: string, actor: Actor): Promise<GuardarNotaResult> {
    if (actor.rol !== ALLOWED_ROL) return { status: "forbidden" }; // R10

    // R5: una nota que queda VACIA tras recortar espacios equivale a limpiar (nota = NULL), no
    // a persistir texto en blanco. Se delega en `limpiar` (misma preservacion de marcar_luego).
    const recortada = nota.trim();
    if (recortada.length === 0) {
      const limpiado = await this.limpiar(ordenId, actor);
      if (limpiado.status !== "ok") return limpiado; // solo puede ser `forbidden` (ya chequeado)
      return { status: "ok", nota: null };
    }

    try {
      // R1/R2/R3/R9: upsert por (usuario_id, orden_id); `usuario_id` del actor. El repo actualiza
      // SOLO `nota` en conflicto -> preserva `marcar_luego` (R3). Crea la fila si no existia (R1).
      await this.metaRepo.upsertNota(actor.usuarioId, ordenId, recortada);
    } catch (error) {
      // R16: si `ordenId` no existe, la FK `orden_id -> orden` (de la 115) impide la fila
      // huerfana con una violacion P2003. Se traduce a resultado de dominio `forbidden` (mismo
      // trato que "orden ajena o inexistente"), NUNCA se deja escapar como excepcion cruda.
      if (esViolacionFkOrden(error)) return { status: "forbidden" };
      throw error; // un fallo EXCEPCIONAL real (caida de DB) sube al withErrorHandler del borde.
    }

    return { status: "ok", nota: recortada };
  }

  async limpiar(ordenId: string, actor: Actor): Promise<LimpiarNotaResult> {
    if (actor.rol !== ALLOWED_ROL) return { status: "forbidden" }; // R10

    // R4/R9: `updateMany SET nota = NULL` sobre la fila del actor. NO borra la fila (preserva
    // `marcar_luego`, 115) y es no-op idempotente si no hay fila (`count = 0`). El `usuario_id`
    // del actor acota la operacion a su propia fila (nunca la de otro mensajero).
    await this.metaRepo.limpiarNota(actor.usuarioId, ordenId);
    return { status: "ok" };
  }
}

/**
 * R16: `true` si `error` es una violacion de FK de Prisma (codigo `P2003`), p. ej. al intentar
 * insertar la nota sobre una `orden_id` inexistente. Se detecta por el `code` de forma
 * DUCK-TYPED (sin acoplar el service al tipo runtime del cliente Prisma), robusto a nativo y al
 * driver-adapter (`code` es estable en ambos). Cualquier otro error se re-lanza (no se traga).
 */
function esViolacionFkOrden(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2003"
  );
}
