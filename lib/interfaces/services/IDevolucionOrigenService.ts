import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 48 — contrato del servicio de RETORNO a la tienda de origen: la bodega
// responsable ejecuta la accion "Devolver a la tienda" sobre una orden `rechazada`,
// transicionandola a `devolviendo_a_tienda` (el paquete fisico retorno a la tienda que la
// cargo, `orden.tienda_id`). Logica de negocio pura (sin HTTP ni Prisma); el borde
// (Server Action) la traduce a resultado tipado. Solo el administrador de la bodega
// responsable de la orden (maestro/admin en la central, adminSatelite de la zona).

// Maquina de resultados de dominio (patron RecibirServiceResult). Todos los rechazos
// son SIN efectos en datos; `ok` transiciona (o es idempotente si ya estaba en
// `devolviendo_a_tienda`). `conflict` reporta que la orden no esta en `rechazada` (guardia de
// estado de origen, R5). `config_error` cubre el catalogo sin `devolviendo_a_tienda` (seed
// pendiente del destino, R4). `not_found` = inexistente/borrada (o carrera al escribir).
export type DevolverATiendaResult =
  | { status: "ok" } // R4 (transiciono) / R5 (idempotente si ya estaba devolviendo_a_tienda)
  | { status: "forbidden" } // R10/R11 (actor no es la bodega responsable)
  | { status: "not_found" } // orden inexistente o borrada
  | { status: "conflict"; motivo: string } // R5 (estado != rechazada)
  | { status: "config_error" }; // catalogo sin devolviendo_a_tienda (seed pendiente)

export interface IDevolucionOrigenService {
  /**
   * R4/R5/R10/R11: transiciona una orden `rechazada` a `devolviendo_a_tienda`. Elegibilidad
   * por ESTADO (`rechazada`), agnostica del camino (rechazo directo 36 o escalado 47).
   * Guardia de estado de origen (solo desde `rechazada`; `devolviendo_a_tienda` -> `ok`
   * idempotente; otro estado -> `conflict`). Autoriza SOLO al administrador de la bodega
   * responsable de la zona de la orden. Persiste via el choke point de la feature 49.
   */
  devolverATienda(ordenId: string, actor: Actor): Promise<DevolverATiendaResult>;
}
