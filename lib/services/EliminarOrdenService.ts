import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type {
  EliminarOrdenInput,
  EliminarOrdenServiceResult,
  IEliminarOrdenService,
} from "@/lib/interfaces/services/IEliminarOrdenService";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  MSG_ORDEN_NO_EXISTE,
  MSG_ORDEN_YA_BORRADA,
} from "@/lib/services/mensajes-eliminar-orden";

// Feature «eliminar orden» — logica de negocio del BORRADO LOGICO. No conoce HTTP ni Prisma: se
// instancia con dobles en los tests.

/**
 * Metodos de repo que consume el service. `findByIdsForTransicion` es la MISMA precarga que usan
 * las demas acciones por lote, y se elige justamente porque INCLUYE las borradas: es lo que
 * permite distinguir «no existe» de «ya borrada» en el detalle del conflicto.
 */
export type EliminarOrdenRepo = Pick<
  IOrdenRepository,
  "findByIdsForTransicion" | "softDelete"
>;

export class EliminarOrdenService implements IEliminarOrdenService {
  constructor(private readonly repo: EliminarOrdenRepo) {}

  async eliminar(
    input: EliminarOrdenInput,
    actor: Actor,
  ): Promise<EliminarOrdenServiceResult> {
    // 1. Autorizacion por ROL antes de tocar dato alguno. SOLO maestro/admin: borrar una orden
    // la retira de TODOS los listados del sistema —incluidos los de la tienda duena y los del
    // mensajero asignado—, asi que no es una decision que pueda tomar quien solo ve su propio
    // subconjunto. El adminSatelite tampoco: su alcance es una zona, y la orden que borre deja
    // de existir para la central. Sin excepcion por «es de mi tienda».
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const ordenIds = [...new Set(input.ordenIds)];
    if (ordenIds.length === 0) return { status: "ok", eliminadas: 0 };

    // 2. Precarga que INCLUYE borradas, para distinguir los dos motivos de rechazo.
    const ordenes = await this.repo.findByIdsForTransicion(ordenIds);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    const detalle: DetalleConflicto[] = [];
    for (const id of ordenIds) {
      const orden = ordenMap.get(id);
      if (!orden) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_EXISTE });
        continue;
      }
      if (orden.deletedAt !== null) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_YA_BORRADA });
      }
    }
    // Todo-o-nada por lote, como `deshacerAsignacion`: si UNA orden del lote no se puede borrar,
    // no se borra NINGUNA. Un borrado parcial silencioso dejaria al operador creyendo que borro
    // las N que marco, y el borrado no se deshace desde ninguna pantalla.
    if (detalle.length > 0) return { status: "conflict", detalle };

    // 3. NO se filtra por estado: una orden se elimina este donde este (es la retirada de un
    // registro creado por error, y esos aparecen en cualquier punto del flujo). El estado NO
    // cambia y NO se registra transicion en el historial: borrar no es transicionar, y el
    // historial de la orden se conserva intacto por si hay que auditarla.
    const eliminadas = await this.repo.softDelete(ordenIds);
    return { status: "ok", eliminadas };
  }
}
