// Feature 274 (design.md §3.5) — mensajes FIJOS del hueco de tarifa en las dos APIs por key.
//
// Viven aqui, en `lib/`, y NO inline en cada service, por la misma razon que ya esta escrita en
// `mensajes-cotizacion.ts`: son cadenas publicadas que la carga y la cotizacion emiten POR
// SEPARADO. Duplicar el literal en los dos services lo convertiria en dos cadenas que divergen a
// la primera errata corregida, y R38 pide exactamente lo contrario: que una integracion que
// reconozca el error en una API lo reconozca en la otra. Un solo dueño de la cadena.

/** R38 — error de FILA: el par (tienda, zona) de esta fila no resuelve tarifa. Mismo literal
 *  en la carga y en la cotizacion: una integracion que lo reconozca lo reconoce en las dos. */
export const MSG_FILA_SIN_TARIFA =
  "no hay tarifa vigente para la zona de esta fila";

/** R29 — error de LOTE de la CARGA: ninguna fila resolvio tarifa -> 409. Constante nueva: el
 *  literal de cotizacion dice "no se puede cotizar" y aqui no se cotiza nada. Sin
 *  interpolacion, como su hermano: no nombra tienda, key ni fila (misma regla que R49/255). */
export const MSG_CARGA_SIN_TARIFA =
  "la tienda no tiene una tarifa vigente asociada: no se pueden crear órdenes";
