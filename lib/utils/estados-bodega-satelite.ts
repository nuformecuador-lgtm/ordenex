// Feature 170 — FASE 2 (T K.1, R44/R45/R51) — los CINCO estados del listado «Órdenes de la
// bodega» del `adminSatelite`, EN EL ORDEN EN QUE LA PANTALLA LOS PRESENTA.
//
// Hasta ahora esa lista vivia DOS veces, y las dos en sitios que no se hablan:
//
//   RecepcionSateliteService  cinco constantes sueltas + un `if/else if` que parte las filas
//                             en cinco arrays (`recibidas`, `asignadas`, `porDevolver`,
//                             `enTransitoACentral`, `devueltas`).
//   satelite-ordenes-filtros  `ESTADOS_SATELITE`, las cinco opciones del desplegable de
//                             estado, en el orden del flujo de la bodega.
//
// Y el ORDEN que el usuario ve no lo declara ninguna de las dos: emerge de que el modulo
// CONCATENA esos cinco arrays (`RecepcionSateliteModule`, `ordenesBodega`). Mientras la
// pantalla recibia el conjunto entero eso bastaba. Al paginar en el servidor deja de bastar:
// el recorte lo hace ahora la base, asi que la secuencia de grupos tiene que viajar al
// `ORDER BY` o las filas cambian de pagina —y de orden— sin que nadie lo pida (R51).
//
// De ahi este modulo: la secuencia se declara UNA vez y la leen el servicio (lista blanca de
// estados, R44) y el repositorio (rango de grupo del `ORDER BY`, R51).
//
// Helper PURO (`lib/utils/`): sin Prisma, sin servicios, sin React.

/**
 * Los cinco estados del listado, en el orden del flujo de la bodega: lo que esta guardado, lo
 * que ya tiene mensajero pero sigue aqui, lo que sale, lo que va en camino y lo que volvio.
 *
 * Es EXACTAMENTE el orden en que `RecepcionSateliteModule` concatena hoy los cinco grupos, y
 * por tanto el orden en que el usuario los ve. Cambiar esta lista de sitio cambia la pantalla.
 *
 * `en_ruta_bodega_satelite` NO esta aqui a proposito: esas son las «Por recibir», que viven en
 * su propia seccion (se aceptan por escaner/lote) y nunca han entrado en este listado.
 */
export const ESTADOS_BODEGA_SATELITE = [
  "en_bodega_satelite", // Recibidas
  "por_recoger", // Asignadas (por recoger) — feature 149/R35
  "por_devolver", // Por devolver — feature 139/R21
  "devolviendo_a_bodega_central", // En transito a central (informativo) — feature 139/R21
  "devuelta", // Devueltas — feature 100/R12
] as const;

/** `value` de estatus que el listado de la bodega satelite admite. */
export type EstadoBodegaSatelite = (typeof ESTADOS_BODEGA_SATELITE)[number];

/**
 * R44/R45 — traduce la SELECCION del filtro de estado a la lista de estados que se consulta.
 *
 * Dos reglas, las dos copiadas del filtro de cliente que sustituye:
 *
 *  - **seleccion vacia = «todos»** (el desplegable sin nada marcado no filtra). Es el
 *    `estadosElegidos.length > 0` de `SateliteOrdenesListado`.
 *  - **la seleccion INTERSECA la lista blanca, nunca la amplia**: un `estados: ["entregada"]`
 *    no devuelve entregadas, devuelve NADA. La diferencia importa: un `estado` colado por el
 *    borde no puede convertir este listado en una ventana al resto de las ordenes de la zona.
 *    Por eso la interseccion vacia NO cae a «todos» — eso seria justo lo contrario.
 *
 * El resultado sale SIEMPRE en el orden canonico, sea cual sea el orden en que llegue la
 * seleccion: el usuario no puede reordenar la pantalla marcando los filtros al reves.
 */
export function estadosDelListado(
  seleccion?: readonly string[],
): EstadoBodegaSatelite[] {
  if (seleccion === undefined || seleccion.length === 0) {
    return [...ESTADOS_BODEGA_SATELITE];
  }
  return ESTADOS_BODEGA_SATELITE.filter((estado) => seleccion.includes(estado));
}
