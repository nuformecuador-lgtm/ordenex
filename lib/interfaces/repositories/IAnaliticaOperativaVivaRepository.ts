import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { VentanaDia } from "@/lib/analytics/rollup-dia";
import type { CuboRollup } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";

// Feature 126 (T1.3, design §5.1) — contrato del lector de las TABLAS VIVAS.
//
// Dos responsabilidades, las dos sobre `orden` / `gestion_orden` / `orden_historial_estado`
// y NINGUNA sobre el rollup (R17: la unica metrica `live` del catalogo no lee
// `analytics_daily`, y D11 deja claro que D13 no amplia la apertura del guardia R42):
//
//  1. `agingPorEstado` — `aging_por_estado`, unica metrica `clase: "live"` del catalogo.
//  2. `cubosDelDiaEnCurso` — D6/D13: el dia abierto, que por construccion NO tiene filas en
//     el rollup (el job de la 124 corre a las 00:30 CR sobre el dia que CERRO).
//
// D13 — POR QUE CONSULTAS PROPIAS Y NO EL REPOSITORIO DE LA 124. Sus seis consultas son
// plantillas `$queryRaw` CERRADAS sobre `VentanaDia`
// (`lib/repositories/AnaliticaRollupRepository.ts:153,178,212,254,287,331`): no hay costura
// por donde inyectar un `where`. Reusarlo significaria agregar la operacion COMPLETA de la
// compania y filtrar en memoria por las coordenadas devueltas — el coste dejaria de
// depender del inquilino para depender del negocio, y el recorte multi-tenant se mudaria
// del `WHERE` a una capa mas de la que fiarse (justo lo que R18 de la 122 existe para
// impedir).
//
// El precio asumido son DOS implementaciones de las mismas definiciones. Se contiene con
// **R33** (`analitica-operativa-equivalencia.test.ts`): sobre una fecha ya cerrada, el
// camino intradia con `corteAt` = corte de ese dia reproduce CUBO A CUBO y MEDIDA A MEDIDA
// las filas que escribio el job. Sin ese test D13 no se sostiene.

/** Una fila de `aging_por_estado`: antiguedad en el estado ACTUAL de las ordenes vivas. */
export interface AgingPorEstadoFila {
  readonly estatusId: string;
  readonly zonaId: string;
  readonly tiendaId: string;
  /** Ordenes vivas en ese estado. */
  readonly ordenes: number;
  /** Numerador: segundos acumulados en el estado actual. Denominador: `ordenes`. */
  readonly segEnEstadoAcum: bigint;
}

/** Una entrega VIGENTE del dia, con las mismas coordenadas que su cubo de `entregas`. */
export interface EntregaVigenteOperativa {
  readonly ordenId: string;
  readonly zonaId: string;
  readonly tiendaId: string;
  readonly mensajeroId: string;
  readonly estatusId: string;
}

/**
 * Lo que devuelve el camino intradia.
 *
 * DESVIACION DECLARADA respecto de `design.md §5.1`, que dibujaba
 * `cubosDelDiaEnCurso(): Promise<CuboRollup[]>` a secas. `primer_intento_ok` NO se puede
 * resolver aqui sin reimplementar el criterio de «intento», que es el punto UNICO de la
 * feature 160 (`OrdenHistorialService.contarIntentosEnLote`) y que la 124 tambien resuelve
 * en su SERVICIO, no en su repositorio (`AnaliticaRollupService.contarPrimerIntento`).
 * Copiarlo aqui seria una TERCERA implementacion de una definicion, exactamente lo que D13
 * se compromete a contener y no a multiplicar.
 *
 * Por eso el repositorio devuelve los cubos con `primerIntentoOk: 0` y, aparte, las
 * entregas vigentes del dia; el servicio —que es quien tiene el puerto del contador— las
 * cruza. Es la misma division de trabajo que la 124, y R33 la verifica de punta a punta.
 */
export interface CubosDelDiaEnCurso {
  /** Las 9 medidas resueltas. `primerIntentoOk` viene en 0: lo completa el servicio. */
  readonly cubos: readonly CuboRollup[];
  /** Material del criterio unico de «primer intento» (feature 160). */
  readonly entregasVigentes: readonly EntregaVigenteOperativa[];
}

export interface IAnaliticaOperativaVivaRepository {
  /** R17 — `aging_por_estado` sobre `orden` + `orden_historial_estado`. Nunca el rollup. */
  agingPorEstado(consulta: ConsultaAnalitica, corteAt: Date): Promise<readonly AgingPorEstadoFila[]>;

  /**
   * D6/D13 — cubos del dia en curso con las MISMAS definiciones de la 124 y el alcance
   * empujado al `WHERE`.
   *
   * SEGUNDA DESVIACION DECLARADA respecto de `design.md §5.1`, que dibujaba
   * `cubosDelDiaEnCurso(consulta, corteAt: Date)`. Se recibe la `VentanaDia` COMPLETA —el
   * mismo tipo que consume el repositorio de la 124— y no solo el corte, por un motivo que
   * R33 hace inevitable: derivar `desde` a partir de `corteAt` obligaria a hacer
   * `fechaCalendarioCR(corteAt)` aqui dentro, y para una fecha YA CERRADA el corte es
   * EXACTAMENTE la medianoche CR del dia siguiente, de modo que esa derivacion devolveria el
   * dia equivocado y la equivalencia intradia↔rollup se probaria sobre otro dia. Con la
   * ventana explicita, el test de R33 pasa `ventanaDelDia(fecha)` —lo mismo que recibe el
   * job— y la comparacion es cubo a cubo sin ninguna aritmetica intermedia. `ventana.hasta`
   * sigue siendo la cota superior ESTRICTA y el `corteAt` que viaja en la respuesta.
   */
  cubosDelDiaEnCurso(
    consulta: ConsultaAnalitica,
    ventana: VentanaDia,
  ): Promise<CubosDelDiaEnCurso>;
}
