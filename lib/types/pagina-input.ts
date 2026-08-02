// Feature 170 — FASE 2 (T J.1, R40) — el schema de ENTRADA de un listado paginado, declarado
// una vez.
//
// `lib/types/listado-paginado.ts` (T H.2) fija lo que SALE (`{ items, page, pageSize, total }`)
// y `lib/utils/rango-pagina.ts` (T I.1) lo que entra al REPOSITORIO (`{ skip, take }`). Faltaba
// la tercera pieza de la misma conversacion: lo que el BORDE acepta.
//
// Ese bloque —`page` positivo con default 1, `pageSize` positivo recortado a `MAX_PAGE_SIZE`,
// `.strict()`— esta hoy escrito a mano DOCE veces (ordenes, usuarios, plantillas, API keys,
// tarifas, zonas, wallet-tienda, gasto fijo y los cuatro de la tanda I) y la tanda J habria
// sumado tres copias mas. Las doce dicen lo mismo, pero un `.strict()` olvidado en una sola de
// ellas no rompe el typecheck: deja pasar en silencio una clave de ALCANCE (`zonaId`,
// `mensajeroId`) hacia un servicio que hoy la ignora, y que manana podria no ignorarla. Por eso
// la lista blanca se declara aqui y no en cada borde.
//
// Se aplica a los cuatro listados de la tanda J y a los tres de la tanda I que viven en los
// mismos archivos. Los otros ocho siguen escritos a mano: reexpresarlos es correcto pero toca
// bordes que esta task no abre (ver la bitacora, pregunta abierta Q-J3).
//
// Modulo del BORDE (`lib/types/`): solo zod. Sin Prisma, sin servicios, sin React.

import { z } from "zod";

/**
 * Lo unico que este schema necesita de un dominio. Cualquier `lib/config/<dominio>.ts` de los
 * que declaro T H.1 encaja aqui por estructura, sin tener que importarlos.
 */
export interface TamanoPaginaConfig {
  /** Tamano de pagina cuando el cliente no pide uno (R40). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima: un `pageSize` mayor NO se rechaza, se recorta a este valor (R40). */
  MAX_PAGE_SIZE: number;
}

/**
 * Entrada de un listado paginado SIN filtros: `{ page?, pageSize? }` y nada mas.
 *
 * Tres decisiones, las tres heredadas de lo que ya hacian ordenes y usuarios:
 *
 *  - **`.strict()`**, que es la barrera de R44 en el borde: un `zonaId`/`mensajeroId`/`tiendaId`
 *    colado en el input muere aqui con `validation_error` en vez de viajar hasta un servicio
 *    que lo ignoraria en silencio. El alcance SIEMPRE sale del actor de la sesion.
 *  - **recorte, no rechazo**: `pageSize: 100000` se acota a `MAX_PAGE_SIZE` (R40). Rechazarlo
 *    convertiria un exceso inocuo en un error de pantalla.
 *  - **`z.coerce`**, porque el mismo input llega tanto de un Server Component (numeros) como de
 *    parametros de URL (strings).
 *
 * Los listados CON filtros (ordenes, satelite en la tanda K) no usan esta funcion tal cual:
 * anaden sus claves y su propia lista blanca.
 */
export function paginaInputSchema(config: TamanoPaginaConfig) {
  return z
    .object({
      page: z.coerce.number().int().positive().default(1),
      pageSize: z.coerce
        .number()
        .int()
        .positive()
        .default(config.DEFAULT_PAGE_SIZE)
        .transform((n) => Math.min(n, config.MAX_PAGE_SIZE)),
    })
    .strict();
}

/** `{ page, pageSize }` ya validado: lo que reciben los servicios paginados. */
export type PaginaInput = z.infer<ReturnType<typeof paginaInputSchema>>;
