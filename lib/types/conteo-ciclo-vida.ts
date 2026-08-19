// El DTO del CICLO DE VIDA de una orden y el resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React.

/**
 * El tiempo de ciclo del recorte, con su denominador delante.
 *
 * ─── QUE MIDE, CON TODAS LAS LETRAS ─────────────────────────────────────────────────────
 *
 * Segundos entre la CREACION de la orden (`orden.created_at`) y su ULTIMA transicion a un
 * estado terminal (`entregada`, `devuelta_a_tienda`, `incidente`) registrada en
 * `orden_historial_estado`. Mide tiempo de ORDENES, no volumen de gestiones, y no lo alteran
 * las gestiones anuladas.
 *
 * NO es una definicion nueva: es la MISMA que ya usa el rollup diario para la metrica
 * `tiempo_ciclo` del catalogo (`lib/analytics/metrics.ts`, y la consulta Q5 de
 * `AnaliticaRollupRepository`). Escribir aqui una variante —empezar en la primera asignacion,
 * terminar en la primera transicion terminal en vez de la ultima— habria dado dos «tiempos de
 * ciclo» distintos en el mismo producto, y nadie sabria cual mirar.
 *
 * ⚠ SOLO ENTRAN LAS ORDENES CERRADAS, y esto sesga la cifra hacia arriba de forma conocida: una
 * orden que lleva tres semanas abierta no tiene fin de reloj, asi que NO cuenta — el promedio
 * habla de las que se cerraron, no de todas. Por eso `n` viaja y no es opcional: un promedio
 * sin su denominador no se puede juzgar.
 *
 * ⚠ LA VENTANA CAE SOBRE EL CIERRE, no sobre la creacion. Una orden creada en enero y cerrada
 * en agosto cuenta en AGOSTO. Es la misma atribucion del rollup («atribuida a la fecha del
 * EVENTO TERMINAL y nunca a la de su creacion»), y es la unica que permite comparar dos meses:
 * atribuyendo por creacion, el mes en curso saldria siempre artificialmente rapido porque solo
 * habrian cerrado las ordenes faciles.
 */
export interface CicloVidaDTO {
  /**
   * Suma de segundos de todas las ordenes contadas. Numerador CRUDO.
   *
   * Viaja junto al promedio —y no en su lugar— porque es lo unico que se puede volver a
   * agregar: dos recortes se suman por numerador y denominador, nunca promediando promedios.
   * Es la misma razon por la que el rollup guarda `segCicloAcum` y `segCicloN` y «jamas el
   * promedio».
   */
  readonly segundosAcum: number;
  /** Cuantas ordenes cerradas entraron. El DENOMINADOR. `0` = no hubo ninguna. */
  readonly n: number;
  /**
   * `segundosAcum / n`, o `null` si `n === 0`.
   *
   * `null` y no `0`: cero segundos de ciclo es una afirmacion —«se cerraron al instante»— y no
   * hubo ninguna orden que cerrar. Es la misma distincion que el resto de la vertical hace
   * entre un cero medido y un dato ausente.
   */
  readonly promedioSegundos: number | null;
  /**
   * Instante ISO-8601 UTC en que estas cifras se leyeron DE LA BASE — no en que se sirvieron.
   * Ver `ConteoEntregasDTO`.
   */
  readonly lastSync: string;
}

/** Lo que devuelve la Server Action. Discriminado, como el resto del repo: nunca `ok` con un
 *  promedio de cero ante un denegado — «prohibido» y «no cerro ninguna» son hechos distintos. */
export type ResultadoCicloVida =
  | { readonly status: "ok"; readonly datos: CicloVidaDTO }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
