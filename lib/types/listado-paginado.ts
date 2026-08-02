// Feature 170 — FASE 2 (T H.2, design §11.4) — contrato COMUN de un listado paginado.
//
// No es un contrato nuevo: es el que YA devuelven ordenes, usuarios, plantillas y API keys
// (`{ status: "ok", items, page, pageSize, total }`), escrito a mano cuatro veces. La FASE 2
// suma TRECE listados mas (Anexo III). Trece copias mas de la misma forma es trece
// oportunidades de que una devuelva `count` en vez de `total`, o de que se olvide el total y
// la pantalla acabe contando `items.length` — que es exactamente lo que R42 prohibe.
//
// Hermano de `lib/types/descarga-listado.ts` (T0.1, FASE 1), que hizo lo mismo con el modo
// «dataset completo». Los dos juntos cubren las dos lecturas de un mismo listado:
//
//   listar(input, actor)          -> ListarPaginadoServiceResult<T>   (una pagina + el total)
//   listarCompleto(input, actor)  -> ListarCompletoServiceResult<T>   (el dataset, sin recorte)
//
// Modulo de TIPOS: no importa React, Prisma, `lib/services` ni `lib/actions`. La unica
// dependencia es `ActionError`, el union de errores de borde comun del repo, que vive en
// `lib/types/orden` (mismo `import type` que ya hacen `lib/types/descarga-listado` y
// `lib/types/notificacion`). Es `import type`: se borra al compilar.

import type { ActionError } from "@/lib/types/orden";

/**
 * La PAGINA de un listado. Cuatro campos y ni uno mas:
 *
 *  - `items`: las filas de ESTA pagina, en el orden que fija el listado (R51).
 *  - `page` / `pageSize`: el recorte efectivo, ya acotado por `MAX_PAGE_SIZE` del dominio
 *    (R40). Se devuelven porque el cliente los necesita para pintar el control y para
 *    decidir si su `fallbackData` sigue valiendo.
 *  - `total`: las filas que corresponden a los filtros aplicados y al alcance del actor
 *    (R41). NO es `items.length`: es el conteo del CONJUNTO. De el sale el contador de
 *    cabecera (R42) y el numero de paginas.
 *
 * `total >= items.length` siempre, y en la ultima pagina son distintos: esa desigualdad es
 * justo lo que hace que contar el array sea un error visible.
 */
export interface PaginaListado<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Rama de exito de un listado paginado. Se escribe aparte de los unions de abajo porque
 * tambien vale para listados cuyo union de error es propio y no cabe en ninguno de los dos
 * (p. ej. los que anaden `no_encontrada`).
 */
export type PaginaListadoOk<T> = { status: "ok" } & PaginaListado<T>;

/**
 * Resultado del listado paginado en el BORDE (Server Action), tal como lo recibe el cliente.
 *
 * El union de error es un PARAMETRO con `ActionError` por defecto, y eso es deliberado: hay
 * listados cuyo borde declara MENOS errores que `ActionError` (las API keys no devuelven
 * `not_found` ni `conflict` al listar, las zonas tienen su propio `ZonaActionError`).
 * Reexpresarlos sobre un union mas ancho no seria una unificacion, seria obligar a sus
 * pantallas a manejar ramas que ese listado no produce. Aqui se unifica la FORMA DEL EXITO,
 * que es de lo que hablan R41 y R42; los errores los sigue decidiendo cada dominio.
 */
export type ListarPaginadoResult<T, E = ActionError> = PaginaListadoOk<T> | E;

/**
 * El mismo resultado visto desde el SERVICIO, que no conoce el borde: no hay
 * `unauthenticated` (lo resuelve la Server Action antes de llamarlo) ni `validation_error`
 * (lo resuelve zod), pero SI `forbidden`, que es un resultado de DOMINIO —el rol del actor
 * no alcanza ese listado (R44)— y por eso lo devuelve quien conoce el dominio.
 *
 * Igual que su hermano de la FASE 1: `forbidden` NUNCA viaja con filas ni con el total. Un
 * conteo tambien es informacion del conjunto.
 */
export type ListarPaginadoServiceResult<T> = PaginaListadoOk<T> | { status: "forbidden" };
