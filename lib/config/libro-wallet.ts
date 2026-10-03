// FICHA 463 (design §2.1/§2.2, R24/R33/R40) — el buscador y el orden del LIBRO de las wallets: la
// caja (`/wallet`) y los cuatro estados de cuenta (tienda, mensajero, bodega satelite y `/mi-wallet`).
//
// Un solo origen para los dos numeros y para la lista blanca de campos de orden: el borde (zod) y la
// pantalla (el aviso de «faltan N caracteres» del buscador) leen ESTOS valores, y no un 3 escrito en
// cada sitio que se desincroniza a la primera.

/**
 * Minimo de caracteres del termino del libro (R24). El mismo valor que `BUSQUEDA_MIN_CHARS` de
 * `/ordenes`: por debajo, la pantalla no manda el termino y el borde lo rechaza (`validation_error`).
 */
export const BUSQUEDA_LIBRO_MIN_CHARS = 3;

/**
 * Maximo del termino. No protege al motor (un termino largo es mas selectivo): acota el peso de la
 * clave de cache de la pantalla y evita que el campo se use como canal de datos.
 */
export const BUSQUEDA_LIBRO_MAX_CHARS = 100;

/**
 * Los campos por los que se puede ordenar el libro (R33/R40): SOLO la fecha del movimiento (pregunta
 * abierta 3, decidida por defecto al aprobar el spec). Tupla `as const` porque `z.enum` exige
 * literales: cualquier otro `sortBy` es `validation_error` en el borde. El desempate (`created_at`,
 * `id`) lo pone el repositorio y nunca cruza la frontera.
 */
export const CAMPOS_ORDEN_LIBRO = ["fecha"] as const;
export type CampoOrdenLibro = (typeof CAMPOS_ORDEN_LIBRO)[number];
