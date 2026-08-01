// Feature 170 — FASE 2 (T I.2): fixture de la PÁGINA que un Server Component pre-carga y
// pasa a un módulo cliente paginado (`{ items, total, pageSize }`, contrato de T H.2).
//
// Existe porque la tanda I cambia la forma de esa prop en siete pantallas y varias decenas de
// puntos de montaje en la suite. Escrito a mano en cada uno, el `total` acabaría siendo
// `items.length` por inercia en todos —y entonces ningún test podría distinguir «el total del
// conjunto» de «las filas de la página», que es justo lo que R41/R42 separan—.
//
// Por eso `total` se puede fijar aparte: un test que quiera una página 1 de 25 filas dentro de
// un conjunto de 300 lo dice con `paginaInicial(filas, { total: 300 })`.

/** Tamaño de página por defecto de todos los dominios paginados (`lib/config/<dominio>.ts`). */
export const PAGE_SIZE_TEST = 25;

export interface PaginaInicial<T> {
  items: T[];
  total: number;
  pageSize: number;
}

/**
 * Página inicial con `items` y, por defecto, el total del propio array (el caso «cabe entero
 * en una página»). `total` y `pageSize` se pueden fijar para representar un conjunto mayor.
 */
export function paginaInicial<T>(
  items: T[],
  overrides: { total?: number; pageSize?: number } = {},
): PaginaInicial<T> {
  return {
    items,
    total: overrides.total ?? items.length,
    pageSize: overrides.pageSize ?? PAGE_SIZE_TEST,
  };
}
