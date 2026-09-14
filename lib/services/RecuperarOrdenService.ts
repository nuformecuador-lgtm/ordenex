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

// Pedido humano (2026-08-27) — REVERSION del borrado logico. Espejo de `EliminarOrdenService` en
// la FORMA: misma precarga, mismo todo-o-nada, motivos de la misma fuente. No conoce HTTP ni
// Prisma.
//
// ⚠️ PERO YA NO ES ESPEJO EN EL ROL, y decirlo aqui evita la deduccion equivocada: el borrado se
// abrio a la TIENDA (ficha 358, 2026-09-02) y al `admin` (ficha 424, 2026-09-14); recuperar se
// queda EN EL `maestro` y solo en el. Ver el paso 1.

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
    // 1. SOLO EL `maestro`. Esto decia «MISMO rol que el borrado», y dejo de ser cierto: el
    // borrado se abrio a la TIENDA (ficha 358) y al `admin` (ficha 424), y recuperar NO.
    //
    // ⭑ Y ES UNA DECISION, no un resto. El humano la cerro el 2026-09-14 al pedir la reversion
    // del `admin` (424/D1): «que borre»; la papelera no se le abre, y si se equivoca se lo pide
    // al `maestro`. Dejar la recuperacion en UNA sola persona conserva ademas la mitad de lo que
    // protegia la decision del 2026-08-27 —que estrecho el borrado para que el rastro fuera una
    // persona—, ahora que el borrado ya no lo cumple.
    //
    // El motivo original sigue en pie: recuperar devuelve la orden a los listados de la tienda
    // dueña y del mensajero asignado. NO se resuelve con `resolverAlcanceBorradoOrden` a
    // proposito: es OTRA pregunta y tiene que poder divergir de aquella (es justo lo que hace
    // hoy). La misma separacion que `puedeEliminar` / `puedeVerEliminadas` en la pantalla.
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

    // FICHA 362 (R3/R9/R12): QUIEN recupera, congelado en la misma transaccion. El registro
    // lleva UNA fila por orden EFECTIVAMENTE recuperada.
    const recuperadas = await this.repo.restore(ordenIds, actor.usuarioId);
    return { status: "ok", recuperadas };
  }
}
