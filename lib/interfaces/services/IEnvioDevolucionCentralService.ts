import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 139 — contrato del servicio del ENVIO satelite -> bodega CENTRAL de una orden en
// `por_devolver`: el adminSatelite responsable de la zona pulsa "Enviar a central" (por lote,
// reusando el checkbox existente) y la orden pasa a `devolviendo_a_bodega_central` (en transito a
// la central, donde luego se recibe por QR). Logica de negocio pura (sin HTTP ni Prisma); el borde
// (Server Action) la traduce a resultado tipado. Molde de `IDevolucionOrigenService`. SOLO el
// adminSatelite cuya zona coincide con la de la orden (R13/R14).

// Maquina de resultados de dominio (molde `DevolverATiendaResult`). Todos los rechazos son SIN
// efectos en datos; `ok` transiciona (o es idempotente si ya estaba en
// `devolviendo_a_bodega_central`). `conflict` reporta que la orden no esta en `por_devolver`
// (guardia de estado de origen, R22). `config_error` cubre el catalogo sin
// `devolviendo_a_bodega_central` (seed pendiente del destino). `not_found` = inexistente/borrada
// (o carrera al escribir).
export type EnviarACentralResult =
  | { status: "ok" } // R13 (transiciono) / idempotente si ya estaba devolviendo_a_bodega_central
  | { status: "forbidden" } // R14 (actor no es el adminSatelite de la zona de la orden)
  | { status: "not_found" } // orden inexistente o borrada
  | { status: "conflict"; motivo: string } // R22 (estado != por_devolver)
  | { status: "config_error" }; // catalogo sin devolviendo_a_bodega_central (seed pendiente)

export interface IEnvioDevolucionCentralService {
  /**
   * R13/R14/R22/R23: transiciona una orden `por_devolver` a `devolviendo_a_bodega_central`.
   * Guardia de estado de origen (solo desde `por_devolver`; `devolviendo_a_bodega_central` -> `ok`
   * idempotente; otro estado -> `conflict`). Autoriza SOLO al adminSatelite cuya zona coincide con
   * la de la orden (cualquier otro -> forbidden). Persiste via el choke point de la feature 49
   * (`OrdenRepository.update`, `origen_tipo = ajuste_estado`) en su misma tx.
   */
  enviarACentral(ordenId: string, actor: Actor): Promise<EnviarACentralResult>;
}
