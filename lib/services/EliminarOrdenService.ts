import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type {
  EliminarOrdenInput,
  EliminarOrdenServiceResult,
  IEliminarOrdenService,
} from "@/lib/interfaces/services/IEliminarOrdenService";
import { ESTADOS_CREACION } from "@/lib/types/order-status-transiciones";
import {
  MSG_ORDEN_CON_GESTION,
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

/**
 * El historial, del que sale el UNICO predicado de negocio de la accion. Es un `Pick`, como en
 * `GuiaAsignacionService` / `AsignacionSateliteService`: el service depende del metodo, no del
 * servicio entero.
 */
export type EliminarOrdenHistorial = Pick<
  IOrdenHistorialService,
  "idsConGestionPosteriorEnLote"
>;

/**
 * Estados en los que una orden puede seguir SIN gestionar. Es el mismo conjunto en el que nace
 * (`ESTADOS_CREACION`), leido de la fuente unica y no re-declarado aqui.
 */
const SET_CREACION: ReadonlySet<string> = new Set<string>(ESTADOS_CREACION);

export class EliminarOrdenService implements IEliminarOrdenService {
  constructor(
    private readonly repo: EliminarOrdenRepo,
    private readonly historial: EliminarOrdenHistorial,
  ) {}

  async eliminar(
    input: EliminarOrdenInput,
    actor: Actor,
  ): Promise<EliminarOrdenServiceResult> {
    // 1. Autorizacion por ROL antes de tocar dato alguno. SOLO `maestro` (pedido humano
    // 2026-08-27, que ESTRECHA la regla original de maestro/admin): borrar una orden la retira
    // de TODOS los listados del sistema —incluidos los de la tienda dueña y los del mensajero
    // asignado—, y recuperarla solo se puede desde una pantalla que tambien es suya. Con dos
    // roles capaces de borrar, el rastro de quien lo hizo deja de ser una sola persona.
    // `esAccesoTotal` ya NO sirve aqui a proposito: es "ve y gestiona todos los modulos", que es
    // una pregunta distinta de "puede retirar una orden del sistema".
    if (actor.rol !== "maestro") return { status: "forbidden" };

    const ordenIds = [...new Set(input.ordenIds)];
    if (ordenIds.length === 0) return { status: "ok", eliminadas: 0 };

    // 2. Precarga que INCLUYE borradas, para distinguir los motivos de rechazo, y —en la MISMA
    // ida— el conjunto de las que ya tienen movimiento. Van en paralelo porque son
    // independientes: ninguna decide si la otra hace falta.
    const [ordenes, conGestion] = await Promise.all([
      this.repo.findByIdsForTransicion(ordenIds),
      this.historial.idsConGestionPosteriorEnLote(ordenIds),
    ]);
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
        continue;
      }
      // 3. EL PREDICADO DE NEGOCIO (pedido humano 2026-08-27): solo se elimina el registro que
      // NADIE ha gestionado desde que se creo. Se comprueba por los DOS lados, y las dos
      // condiciones son necesarias:
      //   - sin transicion posterior a la creacion (el historial es la evidencia auditable);
      //   - y todavia en un estado de nacimiento (`ESTADOS_CREACION`).
      // La segunda no sobra: una orden anterior al historial —o cuyo rastro se perdiera— tiene
      // CERO filas de movimiento y aun asi puede estar entregada. Con solo la primera regla, esa
      // orden seria borrable. Falla CERRADO: ante la duda, no se borra.
      if (conGestion.has(id) || !SET_CREACION.has(orden.estatusValue)) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_CON_GESTION });
      }
    }
    // Todo-o-nada por lote, como `deshacerAsignacion`: si UNA orden del lote no se puede borrar,
    // no se borra NINGUNA. Un borrado parcial silencioso dejaria al operador creyendo que borro
    // las N que marco.
    if (detalle.length > 0) return { status: "conflict", detalle };

    // 4. El estado NO cambia y NO se registra transicion en el historial: borrar no es
    // transicionar, y el historial de la orden se conserva intacto por si hay que auditarla.
    const eliminadas = await this.repo.softDelete(ordenIds);
    return { status: "ok", eliminadas };
  }
}
