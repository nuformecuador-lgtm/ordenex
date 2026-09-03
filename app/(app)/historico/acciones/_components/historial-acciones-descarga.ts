/**
 * FICHA 362 / T6.2 — los DOS textos de la descarga del registro que el adaptador comun no
 * puede producir, porque el contrato de esta ficha declara esas dos formas distintas.
 *
 * Modulo PURO: sin React, sin DOM y sin logica de adaptacion. Quien adapta es
 * `obtenerFilasDescargaHistorial`, en `HistorialAccionesModule.tsx`, y lo hace delegando en
 * `filasDesdeResultado` —el adaptador COMUN de la 170— para todo lo que ese adaptador si sabe
 * traducir. Es el mismo reparto que `DetalleMiMovimientoCierre.obtenerFilasDescarga` con su
 * estado `sin_reparto`: la forma ajena se resuelve en una linea y el resto va al comun.
 *
 * ⚠️ POR QUE `limite_excedido` NO PUEDE PASAR POR `filasDesdeResultado`. Ese adaptador redacta
 * el aviso con `mensajeLimite(total, limite)`, y el `limite_excedido` de esta ficha lleva
 * `{ maximo }` — sin `total`. Pasarselo produciria «supera el maximo de 5000 filas (hay
 * undefined)»; e inventar el total —repetir `maximo`, o usar el de la pagina visible, que es
 * de otro instante— seria peor: en una descarga de auditoria, un numero inventado es
 * indistinguible de uno medido.
 */

/**
 * El mensaje del tope. ACCIONABLE: dice cual es el tope y que hacer para bajar de el.
 *
 * ⚠️ `limite_excedido` ES UN ERROR, NO UN EXITO PARCIAL. Quien lo trate como `ok` —con las
 * filas que hubiera, o con ninguna— le entrega al usuario un archivo INCOMPLETO que el cree
 * completo, y en un registro de auditoria lo que no esta en el archivo se da por no ocurrido.
 */
export function mensajeLimiteHistorial(maximo: number): string {
  return `La descarga supera el máximo de ${maximo} filas. Acota los filtros —por ejemplo, el rango de fechas o el tipo de acción— y vuelve a intentarlo.`;
}

/**
 * El aviso de un filtro que el borde rechaza. NO ecoa el `motivo` que devuelve el servidor: ese
 * texto lo redacta zod, viene en ingles y nombra claves internas del esquema.
 */
export const MENSAJE_FILTROS_INVALIDOS = "Los filtros aplicados no son válidos.";
