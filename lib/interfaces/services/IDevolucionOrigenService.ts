import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 48 (repurposada por la 139) — contrato del servicio del ENVIO central -> tienda:
// maestro/admin (bodega central) ejecuta "Enviar a la tienda" sobre una orden
// `por_devolver_a_tienda`, transicionandola a `devolviendo_a_tienda` (el paquete sale de la central
// hacia la tienda que la cargo, `orden.tienda_id`). Feature 139/R9: el ORIGEN paso de `rechazada` a
// `por_devolver_a_tienda` (la unica salida de `rechazada` es ahora la aprobacion del cierre) y la
// autz paso de bodega-responsable-por-zona a maestro/admin CENTRAL DIRECTO (`por_devolver_a_tienda`
// es, por construccion, un estado siempre fisicamente en la central). Logica de negocio pura (sin
// HTTP ni Prisma); el borde (Server Action) la traduce a resultado tipado.

// Maquina de resultados de dominio (patron RecibirServiceResult). Todos los rechazos son SIN efectos
// en datos; `ok` transiciona (o es idempotente si ya estaba en `devolviendo_a_tienda`). `conflict`
// reporta que la orden no esta en `por_devolver_a_tienda` (guardia de estado de origen, R22).
// `config_error` cubre el catalogo sin `devolviendo_a_tienda` (seed pendiente del destino).
// `not_found` = inexistente/borrada (o carrera al escribir).
export type DevolverATiendaResult =
  | { status: "ok" } // R15 (transiciono) / idempotente si ya estaba devolviendo_a_tienda
  | { status: "forbidden" } // R16 (actor no es maestro/admin central)
  | { status: "not_found" } // orden inexistente o borrada
  | { status: "conflict"; motivo: string } // R22 (estado != por_devolver_a_tienda)
  | { status: "config_error" }; // catalogo sin devolviendo_a_tienda (seed pendiente)

export interface IDevolucionOrigenService {
  /**
   * R9/R15/R16/R22: transiciona una orden `por_devolver_a_tienda` a `devolviendo_a_tienda`. Guardia
   * de estado de origen (solo desde `por_devolver_a_tienda`; `devolviendo_a_tienda` -> `ok`
   * idempotente; otro estado -> `conflict`, incluida `rechazada`, cuya unica salida es ahora el
   * cierre, R9). Autoriza SOLO a maestro/admin (bodega central). Persiste via el choke point 49.
   */
  devolverATienda(ordenId: string, actor: Actor): Promise<DevolverATiendaResult>;
}
