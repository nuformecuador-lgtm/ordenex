/**
 * Ficha 344 (T8.1, design §4) — columnas de EXPORT del DETALLE de una fila del libro de LA
 * PROPIA TIENDA: las órdenes que componen el importe de ese movimiento.
 *
 * Módulo PURO: sin React ni DOM.
 *
 * CUATRO columnas y no cinco: aquí NO sale «Tienda» (R14). Todas las órdenes del archivo son de
 * la misma tienda —el servidor lo acota con el `tienda_id` del actor escrito al final del
 * `where`—, así que la columna repetiría el mismo nombre en cada fila. Tampoco sale el mensajero
 * (R15), que ni siquiera llega a esta pantalla.
 *
 * MONEY-SAFE (R37): el `aporte` se emite como el STRING que llega del servidor, TAL CUAL. Sin
 * `parseFloat`/`Number`, sin `money` y sin el símbolo de colón — el colón convertiría una celda
 * numérica en texto que la hoja de cálculo no puede sumar, y sumar la columna es exactamente lo
 * que quien descarga este archivo va a hacer para cotejarla con el importe de la fila.
 *
 * LO QUE NO SALE (R36): `ordenId`, ni ningún otro identificador interno.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";

import { resultadosTexto } from "./detalle-mi-movimiento-labels";

/**
 * Las CUATRO columnas del archivo, en el orden de la pantalla (design §4).
 *
 * Su enumeración es CONTRATO (R35) y se fija con un `toEqual` escrito A MANO en
 * `tests/unit/descarga/detalle-mi-movimiento-descarga-columnas.test.ts`: nunca derivado de esta
 * misma constante, que sería una aserción contra su propia fuente y no podría ponerse roja.
 */
export const COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO: DescargaColumna[] = [
  { clave: "guia", encabezado: "Guía" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "resultado", encabezado: "Resultado" },
  { clave: "aporte", encabezado: "Aporte" },
];

/**
 * Proyecta una orden del detalle a una fila de export con valores CRUDOS.
 *
 * El `resultado` sale como su ETIQUETA LEGIBLE, la misma de pantalla. El `aporte`, en cambio,
 * sale sin adornar (R37). `tiendaNombre` llega en el DTO y aquí se descarta a propósito.
 */
export function filaDescargaDetalleMiMovimiento(orden: OrdenAporteDTO): DescargaFila {
  return {
    guia: orden.guia,
    destinatario: orden.destinatario,
    resultado: resultadosTexto(orden.resultados),
    aporte: orden.aporte, // STRING tal cual (money-safe, R37)
  };
}
