// Feature 155 (design §2) — EL PUNTO UNICO DE DECISION de donde nace una orden (R1/R6).
//
// Modulo PURO: sin Prisma, sin HTTP, sin `process.env`, sin `next/*`. Lo consumen las TRES vias
// de creacion (alta manual, carga masiva por UI y carga por API key) y ninguna replica la regla
// por su cuenta.
//
// Sustituye a las TRES reglas de nacimiento que convivian antes:
//   - `ordenesConfig.DEFAULT_ESTATUS_VALUE`      (default global, retirada por esta feature)
//   - `ordenesConfig.FULFILLMENT_ESTATUS_VALUE`  (mapeo del flag, retirada por esta feature)
//   - `BulkOrdenService.ESTATUS_INICIAL_API`     (estado fijo del canal API, retirada)
//
// El UNICO predicado es el flag `fulfillment` del usuario DUEÑO de la orden (el que queda en
// `orden.tienda_id`). Ni el payload de la peticion, ni la via de carga, ni el rol del actor que
// ejecuta influyen en la decision (R1/R5).
import type { OrderStatusValue } from "@/lib/types/order-status";

/**
 * Donde nace una orden y con que. Las tres propiedades viajan JUNTAS a proposito: son las tres
 * caras de la MISMA decision, y separarlas es exactamente como se degrada a "tres reglas que hay
 * que mantener sincronizadas a mano" — el estado del que esta feature viene a sacarnos.
 */
export interface DestinoCreacion {
  /** Estado inicial de la orden. Siempre uno de `ESTADOS_CREACION` (R31). */
  readonly estatus: OrderStatusValue;
  /** `true` => se asigna `num_guia` en la MISMA transaccion de la creacion (R3/R8). */
  readonly conGuia: boolean;
  /** `true` => el lote emite manifiesto de la rama (b) (R24); `false` => no lo emite (R26). */
  readonly emiteManifiesto: boolean;
}

/**
 * R1/R2/R3/R6 — resuelve el destino de creacion a partir del UNICO predicado admitido.
 *
 * @param fulfillmentDeLaTienda flag `Usuario.fulfillment` de la tienda DUEÑA de la orden
 *   (feature 27). `true` = el paquete YA esta en nuestra bodega.
 *
 * - `true`  → `en_preparacion`, SIN guia (la genera despues la feature 156) y sin manifiesto: el
 *   paquete ya esta en la bodega, no hay ningun movimiento fisico que documentar (R2/R26).
 * - `false` → `por_recolectar_en_tienda`, CON guia en el acto y con manifiesto: el paquete espera
 *   en la tienda y el manifiesto es el papel que se firma al entregar los bultos (R3/R24).
 */
export function resolverDestinoCreacion(fulfillmentDeLaTienda: boolean): DestinoCreacion {
  return fulfillmentDeLaTienda
    ? { estatus: "en_preparacion", conGuia: false, emiteManifiesto: false }
    : { estatus: "por_recolectar_en_tienda", conGuia: true, emiteManifiesto: true };
}
