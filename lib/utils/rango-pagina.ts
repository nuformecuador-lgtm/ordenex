// Feature 170 — FASE 2 (T I.1, design §11.4) — la mitad de SERVIDOR del contrato paginado.
//
// `lib/types/listado-paginado.ts` (T H.2) fija lo que sale hacia el cliente
// (`{ items, page, pageSize, total }`). Este modulo fija lo que entra al REPOSITORIO, que es
// la otra mitad de la misma conversacion y hasta ahora se escribia a mano en cada servicio:
//
//     const skip = (input.page - 1) * input.pageSize;
//
// Esa linea ya existia cuatro veces (ordenes, usuarios, plantillas, API keys) y la FASE 2
// suma trece listados. Un `page` en base 0 en UNA de esas copias no rompe el typecheck: se
// come la primera pagina en silencio. Aqui se escribe UNA vez y se prueba UNA vez.
//
// Helper PURO (`lib/utils/`): sin Prisma, sin React, sin Next. Los contratos de repositorio
// importan `RangoPagina` de aqui, igual que `IGastoFijoPlantillaRepository` importa
// `PeriodicidadUnidad` de `lib/utils/periodicidad`.

/**
 * La ventana que el repositorio traduce a `skip`/`take` de Prisma. Es lo MISMO que
 * `ListUsuariosParams` ya declaraba suelto; se le da nombre para que los siete listados de
 * la tanda I no lo declaren siete veces.
 */
export interface RangoPagina {
  skip: number;
  take: number;
}

/**
 * Lo que devuelve un repositorio paginado: la pagina y el TOTAL del conjunto que casa el
 * WHERE (R41). Los dos juntos y en la MISMA llamada, a proposito: si el total se pidiera
 * por separado, el conteo podria resolverse contra un `where` distinto del de la pagina —
 * que es exactamente la divergencia que R44 prohibe.
 */
export interface PaginaRepositorio<T> {
  items: T[];
  total: number;
}

/**
 * `{ page, pageSize }` (1-based, como lo declara el borde) -> `{ skip, take }` (0-based,
 * como lo quiere Prisma).
 *
 * `page` y `pageSize` llegan YA validados por zod (`.int().positive()` + clamp a
 * `MAX_PAGE_SIZE`). Aun asi el `Math.max(0, ...)` esta escrito: es la unica linea que separa
 * un `page: 0` colado por un camino sin schema de un `skip: -25`, que en Postgres es un
 * error de SQL y en la pantalla un 500 sin explicacion.
 */
export function rangoDePagina(pagina: { page: number; pageSize: number }): RangoPagina {
  return {
    skip: Math.max(0, (pagina.page - 1) * pagina.pageSize),
    take: pagina.pageSize,
  };
}
