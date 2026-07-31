import { z } from "zod";

// Feature 157 — RECOLECCION EN TIENDA por el mensajero: validacion de borde (zod) y resultado
// tipado expuesto por la Server Action. Espejo de `lib/types/recepcion-bodega-central.ts`.
//
// Cierra el dead-end que abrio la 155: una orden de tienda SIN fulfillment nace en
// `por_recolectar_en_tienda` —ya con `num_guia` y etiqueta, pero con el paquete todavia en la
// tienda— y esa arista (#43, declarada por la 154) no tenia productor. Aqui lo gana: el mensajero
// va a la tienda, escanea el QR de cada etiqueta y la orden pasa a `en_ruta_bodega_central`, donde
// empalma con el tramo que ya existe (la bodega central la recibe por QR, feature 138).

// El QR de la etiqueta codifica la URL `/paquete/<numGuia>`; el escaner extrae el `num_guia`
// (Int UNIQUE de `orden`) y lo manda aqui. Se exige entero positivo; un valor ilegible (el
// escaner ya lo resuelve a null) -> ZodError -> validation_error ANTES del service, sin tocar
// datos (R20).
export const recolectarEnTiendaSchema = z.object({
  numGuia: z.number().int().positive(),
});
export type RecolectarEnTiendaActionInput = z.infer<typeof recolectarEnTiendaSchema>;

/**
 * Resultado expuesto por `recolectarEnTiendaPorQr`. Espeja `RecolectarEnTiendaServiceResult`
 * agregando `unauthenticated` (borde, R29).
 * - `ok`: transiciono a `en_ruta_bodega_central` (R27). Par origen->destino UNICO: a diferencia
 *   de la 138, aqui no hay resolucion state-aware que hacer.
 * - `ya_recolectada`: ya estaba en el destino -> idempotente, sin escritura (R32).
 * - `estado_invalido`: no esta en `por_recolectar_en_tienda`; lleva el estado actual para que la
 *   UI pueda nombrarlo (R33).
 * - `no_encontrada`: FUSIONA inexistente, borrada y AJENA a proposito (R30). Un resultado propio
 *   para la orden de otro mensajero filtraria su existencia; es la misma opacidad que ya aplica
 *   `MisAsignacionesService` (36/R31), adaptada a un identificador publico (`num_guia`).
 * - `forbidden`: el actor no es mensajero (R29). El acto fisico es suyo.
 * - `conflict`: el mensajero esta bloqueado por un cierre abierto (R31) o perdio una carrera
 *   (el estado cambio entre la lectura y el UPDATE) (R34). Lleva `motivo` para distinguirlos.
 * - `validation_error`: `num_guia` invalido en el borde (R20) o el catalogo no tiene el estado
 *   destino (config; seed pendiente).
 */
export type RecolectarEnTiendaResult =
  | { status: "ok"; ordenId: string; estado: "en_ruta_bodega_central" }
  | { status: "ya_recolectada" }
  | { status: "estado_invalido"; estado: string }
  | { status: "no_encontrada" }
  | { status: "forbidden" }
  | { status: "conflict"; motivo: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
