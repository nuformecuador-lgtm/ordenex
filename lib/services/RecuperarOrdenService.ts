import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type {
  IRecuperarOrdenService,
  RecuperarOrdenInput,
  RecuperarOrdenServiceResult,
} from "@/lib/interfaces/services/IRecuperarOrdenService";
import {
  MSG_ORDEN_NO_BORRADA,
  MSG_ORDEN_NO_EXISTE,
} from "@/lib/services/mensajes-eliminar-orden";

// Pedido humano (2026-08-27) — REVERSION del borrado logico. Espejo de `EliminarOrdenService`:
// mismo rol, misma precarga, mismo todo-o-nada, motivos de la misma fuente. No conoce HTTP ni
// Prisma.

/**
 * Metodos de repo que consume. `findByIdsForTransicion` INCLUYE las borradas —que aqui son
 * justamente las unicas que valen—, asi que es la precarga correcta sin ninguna variante nueva.
 */
export type RecuperarOrdenRepo = Pick<
  IOrdenRepository,
  "findByIdsForTransicion" | "restore"
>;

export class RecuperarOrdenService implements IRecuperarOrdenService {
  constructor(private readonly repo: RecuperarOrdenRepo) {}

  async recuperar(
    input: RecuperarOrdenInput,
    actor: Actor,
  ): Promise<RecuperarOrdenServiceResult> {
    // 1. MISMO rol que el borrado, y por la misma razon: recuperar devuelve la orden a los
    // listados de la tienda dueña y del mensajero asignado. Quien no puede retirarla del sistema
    // tampoco puede devolverla a el.
    if (actor.rol !== "maestro") return { status: "forbidden" };

    const ordenIds = [...new Set(input.ordenIds)];
    if (ordenIds.length === 0) return { status: "ok", recuperadas: 0 };

    const ordenes = await this.repo.findByIdsForTransicion(ordenIds);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    const detalle: DetalleConflicto[] = [];
    for (const id of ordenIds) {
      const orden = ordenMap.get(id);
      if (!orden) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_EXISTE });
        continue;
      }
      // Espejo exacto de la guarda del borrado: alli sobra la ya borrada, aqui sobra la viva.
      if (orden.deletedAt === null) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_BORRADA });
      }
    }
    // NO se comprueba ninguna regla de gestion. Recuperar deshace el BORRADO, no la gestion: la
    // orden vuelve al estado y al historial que ya tenia, que es donde el borrado la dejo. Pedir
    // aqui el «sin gestionar» del borrado dejaria irrecuperable justo la orden borrada por error
    // sobre la que alguien alcanzo a trabajar.
    if (detalle.length > 0) return { status: "conflict", detalle };

    const recuperadas = await this.repo.restore(ordenIds);
    return { status: "ok", recuperadas };
  }
}
