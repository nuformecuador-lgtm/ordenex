// El puerto de lectura de la COHORTE DE CARGA. Contrato NEUTRAL: sin Prisma y sin Next.

import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { CohorteDesenlace } from "@/lib/types/cohorte-carga";

/**
 * Una celda cruda de la tabla: un dia por un desenlace.
 *
 * NUMERADOR Y DENOMINADOR, JAMAS EL PROMEDIO. Es la regla que ya siguen el rollup diario
 * (`segCicloAcum` + `segCicloN`) y `CicloCrudo`, y no es estilo: dos recortes se suman por
 * numerador y denominador; promediar promedios da un numero que no corresponde a nada. El
 * promedio lo deriva el servicio, una vez, al final.
 */
export interface CohorteCuboCrudo {
  /** Dia calendario de Costa Rica, `YYYY-MM-DD`. Cadena, nunca `Date`. */
  readonly fecha: string;
  readonly desenlace: CohorteDesenlace;
  /** Ordenes de ese dia con ese desenlace. Siempre >= 1: el `GROUP BY` no emite grupos vacios. */
  readonly n: number;
  /**
   * Suma de segundos entre la creacion de la orden y su cierre.
   *
   * `null` —y no `0`— en el cubo `viva`: esas ordenes no tienen fin de reloj. Sale asi del
   * propio `SUM` sobre una columna toda nula, sin `CASE` ni `COALESCE`.
   */
  readonly segundosAcum: number | null;
}

export interface ICohorteCargaRepository {
  /**
   * Reparte por desenlace las ordenes CARGADAS dentro de la ventana de la consulta, agrupadas
   * por el dia calendario CR de `orden.created_at`.
   *
   * Recibe la MISMA `ConsultaConteoEntregas` que el resto de la vertical —el filtro es identico
   * a proposito, para que la barra mueva todas las lecturas a la vez—. Tres diferencias con las
   * demas, las tres deliberadas:
   *
   *   1. la VENTANA cae sobre `orden.created_at`, la fecha de CARGA. **Nunca sobre la transicion
   *      terminal**: una orden cargada dentro del rango cuenta su desenlace aunque haya cerrado
   *      despues del `hasta` (R12). Poner la ventana sobre el cierre no rompe nada visible — da
   *      una cohorte con numeros plausibles y equivocados;
   *   2. la ventana esta SIEMPRE presente. Esta lectura exige rango, asi que el borde no llega
   *      hasta aqui sin el;
   *   3. no hay recorte por mensajero: una orden no la carga un mensajero.
   *
   * Devuelve las filas en el orden de salida: dia DESCENDENTE (R6). El orden se decide aqui y
   * no se rehace despues.
   */
  contarCohortes(consulta: ConsultaConteoEntregas): Promise<readonly CohorteCuboCrudo[]>;
}
