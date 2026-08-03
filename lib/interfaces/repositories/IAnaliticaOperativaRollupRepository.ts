import type { GestionCausaDevolucion } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { DimensionAnalitica } from "@/lib/analytics/types";

// Feature 126 (T1.2, design §5.1) — contrato del LECTOR del rollup diario.
//
// R4 — TODA firma recibe `ConsultaAnalitica` (el tipo opaco de la 122) y NINGUNA recibe
// `AnaliticaFiltroInput`, `AlcanceDatos` ni el filtro crudo por separado. No es estilo: el
// aviso dirigido de la 122 es literal — «si una firma necesita el filtro suelto, el recorte
// se esta perdiendo». Un repositorio que se olvide del recorte no tiene de donde sacar el
// filtro y falla el BUILD, no los datos.
//
// R26/D4 — DOS metodos, no catorce. Las 13 metricas de rollup del mismo grano se resuelven
// con UNA agregacion (`agregarCubos`) y el servicio proyecta cada metrica desde ese
// resultado; las tres tasas y `primer_intento_ok` son razones DERIVADAS en el servicio, no
// columnas propias y no promedios de promedios.

/**
 * Coordenada que NO estaba en el grano pedido y por tanto quedo AGREGADA.
 *
 * No es `null` a proposito: en `mensajeroId` el `null` ya significa «orden sin mensajero
 * asignado» (cubo `MENSAJERO_SIN_ASIGNAR`, D10/R8) y reusarlo para «esta dimension no se
 * pidio» fundiria dos hechos distintos en un mismo valor. Con un literal propio, el cubo
 * sin asignar y el cubo agregado son distinguibles en la proyeccion y en los tests.
 */
export const DIMENSION_AGREGADA = "__agregada__" as const;

export type DimensionAgregada = typeof DIMENSION_AGREGADA;

/**
 * Un cubo del rollup ya agregado al grano pedido.
 *
 * `mensajeroId: string | null` NO es laxitud: el `NULL` del rollup significa «orden sin
 * mensajero asignado» (cubo `MENSAJERO_SIN_ASIGNAR`, D5/R30 de la 135) y R8 prohibe
 * descartarlo, convertirlo en `null` serializado o etiquetarlo como «Mensajero N».
 * Lo mismo con `causaDevolucion: null` = devolucion sin causa tipificada (R15): el
 * historico anterior a la feature 73 no se backfilleo.
 *
 * `segCicloAcum` viaja como `bigint` HASTA el servicio y se convierte a `number` solo
 * DESPUES de dividir (D5): la respuesta no puede llevar `BigInt` (R14/R30).
 */
export interface CuboRollup {
  /** `YYYY-MM-DD` calendario de Costa Rica. SIEMPRE presente: `fecha` va en todo grano. */
  readonly fecha: string;
  readonly zonaId: string | DimensionAgregada;
  readonly tiendaId: string | DimensionAgregada;
  /**
   * `null` = cubo sin asignar (D10). NO se descarta y NO se renombra.
   * `DIMENSION_AGREGADA` = el grano pedido no incluia `mensajero`.
   */
  readonly mensajeroId: string | null | DimensionAgregada;
  readonly estatusId: string | DimensionAgregada;
  /** `null` = sin causa tipificada (R15). `DIMENSION_AGREGADA` = no estaba en el grano. */
  readonly causaDevolucion: GestionCausaDevolucion | null | DimensionAgregada;
  readonly ordenesCreadas: number;
  /** STOCK al corte: NO se suma entre fechas (R12). */
  readonly ordenesEstadoStock: number;
  readonly entregas: number;
  readonly devoluciones: number;
  readonly rechazos: number;
  readonly reprogramaciones: number;
  readonly incidentes: number;
  readonly primerIntentoOk: number;
  readonly segCicloAcum: bigint;
  readonly segCicloN: number;
}

/**
 * Etiqueta de un estatus resuelta CONTRA LA TABLA `order_status` (D8/R13), nunca contra un
 * `Record<OrderStatusValue, string>` hardcodeado sobre `ORDER_STATUS_SEED`.
 *
 * Motivo verificado: el estatus de fulfillment que la 155 retiro del seed ya NO esta en
 * `ORDER_STATUS_SEED`, pero su fila sobrevive HUERFANA en `order_status` y 37 filas de
 * `orden_historial_estado` la referencian (el `DELETE` de aquella migracion era condicional
 * y quedo NO-OP). Como el rollup congela el estatus DESDE EL HISTORIAL, ese id SALE en un
 * `GROUP BY` real. Un mapa cerrado produciria `undefined` o un `throw` en produccion y no en
 * los tests. El literal NO se escribe aqui: lo prohibe el censo de la 153
 * (`tests/unit/guards/censo-order-status-rename.test.ts`), y esquivarlo por concatenacion
 * seria evadir el guard en vez de cumplirlo.
 *
 * DESVIACION DECLARADA respecto de `design.md §5.1`, que dibujaba `{ value; label }` como si
 * las dos columnas existieran: `order_status` tiene `id` y `value` y NADA MAS
 * (`db/schema.prisma:377-394`, verificado). No hay columna `label` en la tabla ni un mapa
 * de etiquetas en `lib/`. Asi que la «etiqueta que le da la tabla» ES su `value`, y eso es
 * justo lo que R13 necesita: para la fila huerfana la tabla sigue teniendo
 * su `value`, mientras que `ORDER_STATUS_SEED` ya no lo tiene. `label` se conserva en el
 * contrato —poblado con el `value`— para que la 131 tenga donde enchufar una traduccion sin
 * cambiar esta firma; lo que NO se hace es inventar aqui un diccionario paralelo.
 */
export interface EtiquetaEstatus {
  readonly value: string;
  readonly label: string;
}

export interface IAnaliticaOperativaRollupRepository {
  /**
   * R26/D4 — UNA agregacion para TODAS las metricas del grano pedido.
   *
   * `granos` son las dimensiones del catalogo (`metrica.granos`). La implementacion incluye
   * SIEMPRE `fecha` en el `GROUP BY`, aunque el llamador no la pida: sin ella
   * `ordenes_estado_stock` se sumaria entre fechas (R12) y `analytics_daily` no tiene forma
   * de decirlo.
   */
  agregarCubos(
    consulta: ConsultaAnalitica,
    granos: readonly DimensionAnalitica[],
  ): Promise<readonly CuboRollup[]>;

  /** D8/R13 — etiquetas de los estatus que APARECIERON, resueltas contra la tabla. */
  etiquetasDeEstatus(ids: readonly string[]): Promise<ReadonlyMap<string, EtiquetaEstatus>>;
}
