/**
 * Ficha 344 (T8.1, design §4) — columnas de EXPORT del DETALLE de una fila del libro de la
 * CAJA PRINCIPAL: las órdenes que componen el importe de ese movimiento.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<…>` del panel, cuyo `render`
 * devuelve un enlace y una celda apilada.
 *
 * MONEY-SAFE (R37): el `aporte` se emite como el STRING que llega del servidor, TAL CUAL. Sin
 * `parseFloat`/`Number`, sin `money` y sin el símbolo de colón — el colón convertiría una celda
 * numérica en texto que la hoja de cálculo no puede sumar, y sumar la columna es exactamente lo
 * que quien descarga este archivo va a hacer para cotejarla con el importe de la fila.
 *
 * LO QUE NO SALE (R36): `ordenId`. Es el `rowKey` de la tabla y un identificador interno; la
 * guardia de columnas sensibles además ejecuta esta proyección con una sonda y falla si una
 * celda tiene forma de uuid.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE Y EL DE LA FICHA 343 NO. Aquel panel era un recorte del MISMO
 * libro que ya se descarga entero con sus filtros, así que una descarga propia habría sido un
 * segundo archivo del mismo hecho. Éste enseña algo que NINGUNA otra descarga produce: el
 * reparto de un importe entre las órdenes que lo componen.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";

import { resultadosTexto } from "./detalle-movimiento-labels";

/**
 * Las CINCO columnas del archivo, en el orden de la pantalla (design §4).
 *
 * Su enumeración es CONTRATO (R35) y se fija con un `toEqual` escrito A MANO en
 * `tests/unit/descarga/detalle-movimiento-descarga-columnas.test.ts`: nunca derivado de esta
 * misma constante, que sería una aserción contra su propia fuente y no podría ponerse roja.
 */
export const COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO: DescargaColumna[] = [
  { clave: "guia", encabezado: "Guía" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "tienda", encabezado: "Tienda" },
  { clave: "resultado", encabezado: "Resultado" },
  { clave: "aporte", encabezado: "Aporte" },
];

/**
 * Proyecta una orden del detalle a una fila de export con valores CRUDOS.
 *
 * El `resultado` sale como su ETIQUETA LEGIBLE, la misma de pantalla: un archivo que dijera
 * `entregada` obligaría a traducir a mano. El `aporte`, en cambio, sale sin adornar (R37).
 */
export function filaDescargaDetalleMovimiento(orden: OrdenAporteDTO): DescargaFila {
  return {
    guia: orden.guia,
    destinatario: orden.destinatario,
    tienda: orden.tiendaNombre,
    resultado: resultadosTexto(orden.resultados),
    aporte: orden.aporte, // STRING tal cual (money-safe, R37)
  };
}
