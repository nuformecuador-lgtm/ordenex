// 2026-08-31 — EL RANGO DE LA ANALITICA POR API KEY CUANDO EL INTEGRADOR NO LO DA.
//
// `desde` y `hasta` dejaron de ser obligatorios en `GET /api/ordenes/api-key/analitica`. Lo que
// significa cada ausencia es una decision de contrato, no un default tecnico, y vive aqui:
//
//   - sin `hasta`  ->  HOY (fecha calendario de Costa Rica). El limite superior es abierto:
//     «hasta donde llegue». No se recorta al ultimo dia cerrado, porque el `rango` que publica
//     la respuesta es el ECO de lo pedido y el dia en curso ya se OMITE de `data` mas abajo
//     (ver la cabecera de `analitica-api-key-dto.ts`): recortarlo aqui contaria dos veces la
//     misma regla y ademas romperia el caso `desde=hoy&hasta=hoy`.
//   - sin `desde`  ->  el HORIZONTE DEL HISTORIAL (`HORIZONTE_HISTORIAL_CR`, feature 125). Es
//     el limite inferior REAL del dato, no una fecha bonita: por debajo de el, `orden_historial_estado`
//     no tiene filas —su migracion fue aditiva y sin backfill— y toda medida saldria en cero por
//     falta de datos, no por falta de operacion. Empezar ahi es exactamente «todo el historico»:
//     un `desde` anterior no anadiria ni un punto a `data`, solo dias omitidos.
//
// POR QUE ESTE MODULO VIVE EN `lib/api/` Y NO EN EL CASCARON HTTP, igual que su hermano
// `analitica-api-key-metricas.ts`: leer el horizonte exige importar de `@/lib/analytics/**`, y la
// guardia de frontera de 134/R3 lo prohibe desde CUALQUIER archivo de `app/api` —tambien desde el
// camino nominalmente autorizado de la 267—. El cascaron pasa lo que llego en la query y recibe
// las dos fechas ya resueltas; sigue sin nombrar ni un modulo de analitica.
//
// Modulo puro: sin `next/*`, sin Prisma, sin `process.env`, sin efectos al importarse, y con el
// reloj INYECTADO (nunca un `new Date()` escondido): mismo instante => mismo rango.

import { HORIZONTE_HISTORIAL_CR } from "@/lib/analytics/backfill-rango";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

/** Lo que llego en la query, ya validado como fecha calendario cuando viene. */
export interface RangoPedidoApiKey {
  readonly desde?: string;
  readonly hasta?: string;
}

/** Las dos fechas con las que el cascaron construye el filtro `personalizado` de la 135. */
export interface RangoResueltoApiKey {
  readonly desde: string;
  readonly hasta: string;
}

/**
 * Rellena las fechas que el integrador no mando. Lo que SI mando no se toca NUNCA: este modulo
 * completa, no corrige, y en particular no arregla un rango invertido —eso es un 422 del filtro
 * de la 135, y tiene que seguir siendolo—.
 *
 * LA UNICA SUTILEZA, y esta escrita para que nadie la lea como un descuido: cuando falta `desde`
 * pero el `hasta` pedido es ANTERIOR al horizonte, el default NO es el horizonte sino el propio
 * `hasta`. Con el horizonte, «dame todo hasta enero de 2026» —una pregunta perfectamente
 * legitima, aunque no haya dato tan atras— saldria por el 422 de rango invertido, que es una
 * respuesta desconcertante para quien no mando ningun `desde`. Con esta regla sale un `200` con
 * `data: []`, que es la verdad: no hay nada que contar antes del horizonte.
 */
export function resolverRangoApiKey(
  pedido: RangoPedidoApiKey,
  ahora: Date,
): RangoResueltoApiKey {
  const hasta = pedido.hasta ?? fechaCalendarioCR(ahora);
  if (pedido.desde !== undefined) return { desde: pedido.desde, hasta };
  // Comparacion lexicografica: `YYYY-MM-DD` es de ancho fijo y de mayor a menor unidad, asi que
  // el orden de las cadenas ES el cronologico.
  return { desde: hasta < HORIZONTE_HISTORIAL_CR ? hasta : HORIZONTE_HISTORIAL_CR, hasta };
}
