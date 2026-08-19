// El DTO de las CINCO cifras del dinero POR DIA y el resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React. Money-safe: todos los importes son STRING de
// escala 2 (R7 de la caja) — el navegador nunca ve un `Prisma.Decimal` ni recalcula dinero.

/** Las cinco cifras de un dia calendario de Costa Rica. */
export interface FinanzasDeUnDia {
  /** Fecha calendario CR, `YYYY-MM-DD`. Calendario y no instante: el eje se pinta por dias. */
  readonly fecha: string;
  /**
   * TODO lo que entro a la caja ese dia, contra-entrega incluido.
   *
   * ⚠ ES LA MISMA CONVENCION QUE «Entró» EN EL WALLET Y QUE EL KPI «Ingresos» DE ESTA MISMA
   * PANTALLA, y trae una consecuencia que hay que tener delante: **`ganancia` NO es
   * `ingresos - egresos`**. Estos dos incluyen el dinero de las tiendas, que solo PASA por la
   * caja; la ganancia solo mira el dinero propio. Las tres cifras son correctas y no cuadran
   * entre si a proposito — es exactamente la particion que la feature 173 introdujo para dejar
   * de llamar «balance» a dos cosas distintas.
   */
  readonly ingresos: string;
  /** TODO lo que salio de la caja ese dia, pagos a tiendas incluidos. */
  readonly egresos: string;
  /** Ingresos PROPIOS menos egresos PROPIOS del dia. Puede ser negativo. */
  readonly ganancia: string;
  /**
   * Lo pagado a mensajeros ese dia (categoria `egreso_pago_mensajero`).
   *
   * Va aparte porque se pidio aparte, pero NO es una quinta magnitud independiente: ya esta
   * DENTRO de `egresos` y dentro del lado negativo de `ganancia`. Sumarla a los egresos la
   * contaria dos veces.
   */
  readonly pagoMensajeros: string;
  /**
   * Lo pagado a TIENDAS ese dia (categoria `egreso_pago_tienda`).
   *
   * Espejo exacto de `pagoMensajeros`, y con la misma advertencia: NO es una sexta magnitud
   * independiente, ya esta DENTRO de `egresos`. Sumarla a los egresos la contaria dos veces.
   *
   * ⚠ A diferencia del pago a mensajeros, este concepto TIENE reverso en el enum de la caja
   * (`ingreso_reverso_pago_tienda`). Esta cifra NO lo netea: responde «cuanto salio hacia
   * tiendas ese dia», y la anulacion es un hecho de otro dia que ya se refleja en `ingresos`.
   * Netear dejaria dias en negativo, que en una barra apilada no se puede dibujar.
   */
  readonly pagoTiendas: string;
}

/**
 * La serie completa y la ventana que cubre.
 *
 * **Los dias SIN ningun movimiento NO aparecen.** La ausencia significa «no se movio dinero»,
 * no «no se pudo medir» — mismo criterio que el resto de series de esta pantalla. Quien pinte
 * un eje continuo lo construye desde `desde`/`hasta`, que viajan justamente para eso.
 *
 * Orden CRONOLOGICO ASCENDENTE: es contrato, no presentacion.
 */
export interface FinanzasDiarioDTO {
  /** Un elemento por dia CON movimientos, del mas antiguo al mas reciente. */
  readonly porDia: readonly FinanzasDeUnDia[];
  /** Primer dia calendario CR de la ventana, inclusivo (`YYYY-MM-DD`). */
  readonly desde: string;
  /** Ultimo dia calendario CR de la ventana, INCLUSIVO. */
  readonly hasta: string;
  /**
   * Instante ISO-8601 UTC en que estas cifras se leyeron de la base. Aqui NO hay cache
   * (ver `FinanzasDiarioService`), asi que es tambien el instante en que se sirvieron — pero
   * el campo se conserva porque el dia que se cachee dejaria de serlo sin avisar.
   */
  readonly lastSync: string;
}

/** Lo que devuelve la Server Action. Discriminado, como el resto del repo: nunca `ok` con una
 *  serie vacia ante un denegado — «prohibido» y «no se movio dinero» son hechos distintos. */
export type ResultadoFinanzasDiario =
  | { readonly status: "ok"; readonly datos: FinanzasDiarioDTO }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" };
