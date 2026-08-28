import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type {
  EliminarOrdenInput,
  EliminarOrdenServiceResult,
  IEliminarOrdenService,
} from "@/lib/interfaces/services/IEliminarOrdenService";
import { esEstadoEliminable } from "@/lib/types/order-status-eliminables";
import {
  MSG_ORDEN_NO_ELIMINABLE,
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

// FICHA 319 (2026-08-28) — AQUI VIVIA `EliminarOrdenHistorial`, el `Pick` de
// `idsConGestionPosteriorEnLote` con el que este service contaba las transiciones de la orden.
// SE RETIRA con el conteo, no se deja inyectado sin uso: una dependencia que nadie consulta es
// exactamente el cable suelto que hace creer al siguiente lector que la regla sigue mirando el
// historial. Efecto colateral medible: el borrado pasa de DOS consultas a UNA.

export class EliminarOrdenService implements IEliminarOrdenService {
  constructor(private readonly repo: EliminarOrdenRepo) {}

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

    // 2. Precarga que INCLUYE borradas, para distinguir los motivos de rechazo. Desde la ficha
    // 319 es la UNICA consulta de lectura de la accion: el estado de la orden trae toda la
    // informacion que la decision necesita.
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
        continue;
      }
      // 3. EL PREDICADO DE NEGOCIO. FICHA 319 (pedido humano 2026-08-28): manda EL ESTADO, y
      // SOLO el estado. Antes eran dos condiciones y se exigian las dos —sin transicion
      // posterior a la creacion Y todavia en un estado de nacimiento—; el conteo de transiciones
      // SE RETIRA. Motivo del humano: el estado ya dice quien hizo que con el paquete, y el
      // conteo lo contradice al descalificar una orden solo por haberle impreso la etiqueta.
      //
      // Lo que costaba: generar la guia rompia las DOS mitades a la vez (anade fila de historial
      // y mueve a `en_bodega_central`), asi que una orden numerada no se podia borrar nunca. En
      // produccion, el 2026-08-28: CERO eliminables de 429 vivas.
      //
      // La lista y el porque de cada estado viven en `lib/types/order-status-eliminables.ts`, y
      // es la MISMA que consulta `OrdenService` para decidir si ofrece el boton. Sigue fallando
      // CERRADO: es una lista de INCLUSION, lo que no esta en ella no se borra.
      if (!esEstadoEliminable(orden.estatusValue)) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_ELIMINABLE });
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
