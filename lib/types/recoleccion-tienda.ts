import { z } from "zod";

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

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

// ---------------------------------------------------------------------------------------
// Feature 167 — LECTURA del apartado propio de recoleccion (`/recoleccion`). La confirmacion
// de arriba NO cambia (R16); lo que se agrega es el contrato de lo que la pagina muestra.
// ---------------------------------------------------------------------------------------

/**
 * Feature 167 (R18) — una orden que el mensajero tiene que ir a RECOLECTAR a la tienda.
 *
 * 2026-08-11 (decision del humano): el apartado debe pintar la MISMA card que «Por recoger»,
 * completa y sin compuertas. Eso RETIRA el recorte que la 167 impuso via R38: el DTO era
 * deliberadamente pobre —sin monto, coordenadas, direccion ni ruta— precisamente para que la
 * card no pudiera mostrarlos, y ese recorte es hoy la unica razon por la que las dos pantallas
 * del portal se ven distintas. Ahora extiende `MiAsignacionDTO` y transporta lo mismo que
 * Entregas; los campos siguen saliendo de la MISMA fila (`MiAsignacionRow`), asi que no hay
 * lectura nueva contra la base.
 *
 * Lo unico propio es `tiendaTelefono`, que aqui es REQUERIDO (en `MiAsignacionDTO` es opcional):
 * sostiene el contacto de la cabecera de cada grupo de tienda (R19/R20), que sigue siendo de
 * esta pantalla y no de Entregas.
 */
export interface RecoleccionOrdenDTO extends MiAsignacionDTO {
  /** `null` = la tienda no tiene telefono registrado -> sin controles de contacto (R20). */
  tiendaTelefono: string | null;
}

/**
 * Feature 167 (R24/R25) — una recoleccion YA hecha HOY por el propio actor.
 *
 * Deriva del HISTORIAL (`orden_historial_estado`, familia `recoleccion_tienda`), no del estado
 * actual de la orden: en cuanto la bodega central recibe el paquete (138) la orden pasa a
 * `en_bodega_central` y desapareceria de cualquier lista derivada del estado, justo cuando el
 * mensajero llega a la central y quiere ver su trabajo del dia (R26).
 *
 * `recolectadaAt` es el `created_at` de esa fila de historial: el instante REAL de la
 * recoleccion, no "ahora" ni la fecha de la orden.
 */
/**
 * 2026-08-11 (decision del humano): «Recolectadas hoy» pinta la MISMA card que el resto del
 * portal, asi que extiende `RecoleccionOrdenDTO` —la orden completa— y agrega lo unico que es
 * suyo: CUANDO se recolecto. El `id` sale de la orden (antes se llamaba `ordenId`).
 *
 * La lista sigue derivando del HISTORIAL: lo que cambia es que a esos ids se les resuelven los
 * datos de la orden (`findMisAsignacionesByIds`), con las mismas guardias de propiedad.
 */
export interface RecolectadaHoyDTO extends RecoleccionOrdenDTO {
  recolectadaAt: Date;
}

/**
 * Resultado expuesto por la Server Action `listarRecoleccion`. Espeja
 * `ListarRecoleccionServiceResult` agregando `unauthenticated` (borde), igual que hace
 * `RecolectarEnTiendaResult` con la confirmacion.
 * - `ok`: las dos listas del apartado + el flag de recorte.
 * - `forbidden`: el actor no es mensajero (misma guardia que `recolectarEnTienda`).
 * - `unauthenticated`: no hay sesion; lo agrega el borde, no el service.
 */
export type ListarRecoleccionResult =
  | {
      status: "ok";
      /** R21: SOLO ordenes del propio actor en el estado de recoleccion asignada. */
      porRecolectar: RecoleccionOrdenDTO[];
      /** R28: de la MAS RECIENTE a la mas antigua; ya viene ordenada del servidor. */
      recolectadasHoy: RecolectadaHoyDTO[];
      /** R31: hoy hay MAS recolecciones de las que se devuelven (la lista esta recortada). */
      recolectadasHoyRecortada: boolean;
    }
  | { status: "forbidden" }
  | { status: "unauthenticated" };
