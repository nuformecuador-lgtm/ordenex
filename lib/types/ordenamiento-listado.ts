// FICHA 352 — CONTRATO DE ORDENAMIENTO DE UN LISTADO PAGINADO.
//
// Pedido humano (2026-08-29): «es importante que las tablas se puedan ordenar de fecha mas
// reciente a mas lejana y viceversa». Este modulo es la parte del contrato que NO es de
// `/ordenes`: la direccion, el desempate obligatorio y la clave de cache. `/ordenes` es la
// primera superficie que lo consume (`lib/types/orden.ts` + `OrdenRepository.list`); las
// demas tablas se suman declarando SU lista blanca de campos y SU columna de desempate.
//
// POR QUE EL ORDEN VIAJA HASTA LA CONSULTA Y NO SE RESUELVE EN EL CLIENTE. Estas tablas
// PAGINAN EN EL SERVIDOR: ordenar en el navegador ordenaria las 25 filas de la pagina, no las
// 300 del conjunto, y el resultado PARECERIA correcto — el usuario veria una fila arriba,
// creeria que es «la mas reciente» y seria mentira. Un fallo mudo, que es la familia mas cara
// de este repo.
//
// Modulo de TIPOS y funciones PURAS: no importa Prisma, ni React, ni `lib/services`. La unica
// dependencia es `zod`, para el fragmento de schema que comparten los bordes.

import { z } from "zod";

/**
 * Las DOS direcciones, y no hay mas. Fuente unica: `lib/types/orden.ts` reexporta esto como
 * `SORT_DIRS`/`SortDir` para no romper a sus importadores, y la siguiente tabla que se sume
 * importa de aqui en vez de escribir su propio par de literales. Dos listas de direcciones es
 * la forma silenciosa de que una superficie acepte lo que la otra rechaza.
 */
export const DIRECCIONES_ORDEN = ["asc", "desc"] as const;
export type DireccionOrden = (typeof DIRECCIONES_ORDEN)[number];

/** El fragmento de zod de la direccion. Union CERRADA de literales: nada de texto libre. */
export const esquemaDireccionOrden = z.enum(DIRECCIONES_ORDEN);

/**
 * El ordenamiento vigente de un listado, tal como lo pide el cliente y lo entiende el
 * repositorio. `C` es la lista blanca de campos de ESA tabla (una union de literales, nunca
 * `string`): el nombre de columna real no cruza nunca la frontera.
 */
export interface OrdenamientoListado<C extends string> {
  sortBy: C;
  sortDir: DireccionOrden;
}

/**
 * El fragmento de schema `{ sortBy, sortDir }` de un listado, con sus defaults.
 *
 * Se declara una vez y lo usan todos los bordes que se sumen, para que ninguno se invente
 * `orderBy: z.string()` — que es la forma de dejar que el cliente nombre una columna que su
 * rol no deberia ni tocar, y en algun motor bastante mas que eso. `campos` es una tupla
 * `as const` (`z.enum` exige literales), asi que el conjunto admitido queda fijado en
 * compilacion y el borde responde `validation_error` ante cualquier otro valor.
 */
export function esquemaOrdenamiento<C extends readonly [string, ...string[]]>(
  campos: C,
  porDefecto: C[number],
  direccionPorDefecto: DireccionOrden,
) {
  return {
    sortBy: z.enum(campos).default(porDefecto),
    sortDir: esquemaDireccionOrden.default(direccionPorDefecto),
  };
}

/**
 * EL ORDEN TIENE QUE SER TOTAL. Esta funcion es todo el motivo por el que existe el modulo.
 *
 * Ordenar SOLO por una columna que admite repetidos —`created_at` es el caso— deja el orden
 * de las filas empatadas a merced del plan de ejecucion. Postgres no promete nada ahi: la
 * misma consulta con `OFFSET 0` y con `OFFSET 25` puede resolver el empate de forma distinta
 * (distinto plan, distinto orden de lectura del heap, un `INSERT` concurrente), y entonces
 * paginar DUPLICA una fila en la pagina 2 y PIERDE otra que nunca aparece en ninguna. No es
 * teorico: es el fallo clasico de paginar por una columna no unica.
 *
 * Y en esta base los empates no son raros ni accidentales, son ESTRUCTURALES: las ordenes
 * nacen por carga masiva, en `createMany` dentro de una transaccion, y `created_at` toma el
 * `CURRENT_TIMESTAMP` de la transaccion — el MISMO instante para todo el lote. Medido en la
 * base local el 2026-09-01: sobre 67 ordenes hay un grupo de 23 y otro de 22 filas que
 * comparten `created_at` al milisegundo. Con paginas de 25, un grupo de 23 cruza el corte
 * entre la pagina 1 y la 2 el dia que sea.
 *
 * Por eso `desempate` es un parametro REQUERIDO y no un default amable: quien anada una tabla
 * a este contrato no puede olvidarlo sin que el compilador se lo diga. Tiene que ser una
 * columna UNICA y NOT NULL —la clave primaria es la respuesta obvia—; una columna «casi
 * unica» (`num_guia` es unica pero NULLABLE, y todas las ordenes sin guia empatan entre si)
 * no cierra el agujero, solo lo hace mas dificil de reproducir.
 */
export function ordenTotal<T extends object>(criterios: readonly T[], desempate: T): T[] {
  return [...criterios, desempate];
}

/**
 * Clave de cache/refetch del ordenamiento vigente, hermana de `serializarFiltro` (144/R61).
 *
 * Sin ella, el primero que pide «mas antiguo» le sirve su resultado al siguiente que pide
 * «mas reciente»: la cache no distingue dos peticiones que se diferencian SOLO en el orden.
 * El escalar es estable (dos ordenamientos iguales producen la misma cadena) para que no
 * dispare una consulta nueva en cada render.
 */
export function claveDeOrden<C extends string>(orden: OrdenamientoListado<C>): string {
  return `${orden.sortBy}:${orden.sortDir}`;
}
