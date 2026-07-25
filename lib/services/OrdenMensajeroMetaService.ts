import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenMensajeroMetaService } from "@/lib/interfaces/services/IOrdenMensajeroMetaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MarcarLuegoInput, MarcarLuegoResult } from "@/lib/types/orden-mensajero-meta";

// R11/R12: unico rol que puede marcar/desmarcar sus ordenes.
const ALLOWED_ROL = "mensajero";

/**
 * Feature 115 — logica de negocio del toggle "gestionar mas tarde" (marca PRIVADA por
 * mensajero, solo informativa). Recibe el meta-repo (escritura) y el `OrdenRepository`
 * (SOLO lectura, `findById`, para la guarda de propiedad) por constructor (DI). No conoce
 * HTTP ni Prisma; testeable con dobles sin red/DB.
 *
 * Escribe UNICAMENTE en `orden_mensajero_meta`: NO toca `estatus`/`prioridad`/ruta ni el
 * historial de estados de la orden (R15/R16). El `usuario_id` es SIEMPRE el del actor
 * autenticado (R8/R12), nunca un dato del input.
 */
export class OrdenMensajeroMetaService implements IOrdenMensajeroMetaService {
  constructor(
    private readonly metaRepo: IOrdenMensajeroMetaRepository,
    // Solo lectura para la guarda de propiedad; `findById` excluye borradas (null = no existe
    // o borrada -> not_found, R14) y trae `mensajeroAsignadoId` (guarda de propiedad, R13).
    private readonly ordenRepo: Pick<IOrdenRepository, "findById">,
  ) {}

  async marcarGestionarLuego(input: MarcarLuegoInput, actor: Actor): Promise<MarcarLuegoResult> {
    if (actor.rol !== ALLOWED_ROL) return { status: "forbidden" }; // R11

    // R14: la orden no existe o esta borrada (findById filtra `deleted_at`).
    const orden = await this.ordenRepo.findById(input.ordenId);
    if (!orden) return { status: "not_found" };

    // R13: no se marcan ordenes ajenas (ni sin mensajero asignado).
    if (orden.mensajeroAsignadoId !== actor.usuarioId) return { status: "forbidden" };

    // R5/R6/R8/R12: `usuario_id` SIEMPRE del actor; el input solo aporta `ordenId`/`marcarLuego`.
    // Idempotente por el UNIQUE (R7). No hay ningun otro efecto sobre la orden (R15/R16).
    await this.metaRepo.upsertMarcarLuego(actor.usuarioId, input.ordenId, input.marcarLuego);

    return { status: "ok", ordenId: input.ordenId, marcarLuego: input.marcarLuego };
  }
}
