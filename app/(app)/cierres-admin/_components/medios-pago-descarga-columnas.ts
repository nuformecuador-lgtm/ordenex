/**
 * Una COLUMNA POR MEDIO DE PAGO para las descargas de gestiones (2026-08-19).
 *
 * Sustituye a la celda única «Método», que llevaba el desglose CONCATENADO
 * («Efectivo 100 + SINPE 50»): una hoja de cálculo no puede sumar eso. Ahora hay una columna
 * por medio —«Efectivo», «SINPE», «Transferencia»—, cada una con SU monto y nada más.
 *
 * **Vive en su propio `*-descarga-columnas.ts` a propósito** (R48/R49 de la 230): esa es la
 * CONVENCIÓN por la que `columnas-sensibles.guardia.test.ts` descubre las declaraciones de
 * columnas del árbol. Declararlas en `desglose-pago.ts` —que es donde vive el resto de la
 * lógica de pagos— las habría dejado fuera del descubrimiento, y la guardia lo dice en rojo.
 *
 * **Una sola declaración para los dos módulos de descarga** (el de las cinco secciones de un
 * cierre y el de la hoja fundida): las dos hojas tienen que llevar las MISMAS columnas con los
 * MISMOS encabezados, y dos listas «iguales» divergen al primer medio nuevo.
 *
 * ⚠️ **Lo que la SONDA de la guardia ya no ve.** La celda concatenada leía `pagos[].metodo` y
 * `pagos[].monto` y esas lecturas quedaban rastreadas. Una búsqueda POR CLAVE no: bajo la sonda
 * el medio de la línea no es ninguno de los tres valores del enum, así que las tres celdas
 * salen `null` y sin origen. No es un agujero de la lista negra —lo que se emite sigue siendo
 * un monto del snapshot, y la única lectura posible es `pagos[].monto`—, pero conviene saberlo
 * antes de dar por vigilada esta proyección.
 *
 * Módulo PURO: sin React y sin runtime de `@prisma/client`, como sus dos consumidores.
 * MONEY-SAFE: el monto es el STRING del snapshot TAL CUAL, sin `parseFloat` y sin símbolo.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

import { METODO_LABEL } from "./cierre-labels";
import { CLAVE_MEDIO_PAGO, MEDIOS_PAGO, montoPorMetodo, type LineaPagoDTO } from "./desglose-pago";

/**
 * Las columnas de los medios, en el orden de `MEDIOS_PAGO` —el de declaración del enum, que es
 * el mismo que el servidor garantiza en `pagos` (R24)—. El encabezado es la ETIQUETA LEGIBLE
 * del medio (R8), nunca el value del enum.
 */
export const COLUMNAS_MEDIOS_PAGO: DescargaColumna[] = MEDIOS_PAGO.map((metodo) => ({
  clave: CLAVE_MEDIO_PAGO[metodo],
  encabezado: METODO_LABEL[metodo],
}));

/**
 * Las celdas de esas columnas para una gestión, listas para expandir en la fila. El medio por
 * el que no entró dinero deja la celda VACÍA (`null`, R30), que NO es un cero: es «por ahí no
 * entró dinero».
 */
export function celdasMediosPago(pagos: readonly LineaPagoDTO[]): DescargaFila {
  const porMetodo = montoPorMetodo(pagos);
  const celdas: DescargaFila = {};
  for (const metodo of MEDIOS_PAGO) celdas[CLAVE_MEDIO_PAGO[metodo]] = porMetodo[metodo];
  return celdas;
}
