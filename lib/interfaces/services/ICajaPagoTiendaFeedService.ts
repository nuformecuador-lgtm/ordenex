import type { PrismaClient } from "@prisma/client";

// Feature 173 (design §4) — EL PUERTO ESTRECHO de la caja principal para la liquidacion, y el
// invariante que sustituye al R40 de la 172.
//
// **Lo que decia la 172** (`LiquidacionService.ts`): «NO recibe el repositorio de la CAJA
// PRINCIPAL, y es una decision, no un olvido ([P2]/R40): al aprobar el cierre la caja ya cargo
// `egreso_pago_mensajero = P`, y emitir `egreso_pago_tienda` restaria de la caja un dinero que
// nunca entro en ella».
//
// **Que cambia con la 173:** la premisa —«un dinero que nunca entro»— deja de ser cierta PARA EL
// LADO DE LA TIENDA, porque la Tanda B mete el contra-entrega en la caja al aprobar el cierre; y
// sigue siendo cierta para el lado del MENSAJERO ([P2] = (a), decision humana del 2026-08-03).
//
// **Por que un puerto y no el repositorio.** `IWalletMovimientoRepository` sabe escribir
// CUALQUIER categoria, incluida `egreso_pago_mensajero`: inyectarlo cambiaria una imposibilidad
// estructural por una promesa de buena conducta. Este puerto tiene DOS metodos y ninguno mas, y
// **no expone ni la categoria ni el tipo** —los fija su implementador—, asi que el servicio de
// liquidacion no puede EXPRESAR una escritura en la caja que no sea el egreso de un pago a
// tienda o su reverso (R23). No es «no la llama»: es que no existe el metodo.

/**
 * Cliente de transaccion que necesita el puerto: el LIBRO DE LA CAJA, y nada mas.
 *
 * Mismo criterio que `CajaCodFeedTxClient` (T B.1): que el `Pick` sea de UNA sola tabla no es
 * cosmetico — con este tipo el puerto **no puede** tocar el ledger por tienda ni el libro del
 * mensajero aunque alguien lo intente, y lo impide el compilador antes que cualquier test (R31).
 */
export type CajaPagoTiendaTxClient = Pick<PrismaClient, "walletMovimiento">;

/**
 * Lo que el puerto necesita saber de un pago a tienda para llevarlo a la caja. **No lleva
 * `tipo` ni `categoria`**, y esa ausencia es el requisito (R23): quien llama describe el HECHO
 * —que pago se movio, por cuanto, quien lo registro y con que fecha—; que ese hecho sea un
 * `egreso`/`egreso_pago_tienda` o un `ingreso`/`ingreso_reverso_pago_tienda` lo decide el
 * puerto, y por eso no hay forma de pedirle una tercera cosa.
 *
 * `monto` es STRING (money-safe) y es EL MISMO string ya redondeado que va al documento y al
 * ledger de la tienda: documento, ledger y caja no pueden discrepar por un redondeo.
 */
export interface MovimientoDeCajaDePagoTienda {
  /** El id del DOCUMENTO del pago. Es la mitad de la clave de idempotencia (design §2.5). */
  pagoId: string;
  /** STRING escala 2. Nunca `number`. */
  monto: string;
  descripcion: string | null;
  registradoPor: string;
  /**
   * R20 / R25 — la fecha REAL del hecho: la del PAGO al emitir el egreso, la del dia de la
   * ANULACION al emitir el reverso. Nunca el instante de registro.
   */
  fechaMovimiento: Date;
}

export interface ICajaPagoTiendaFeedService {
  /**
   * R18/R19/R20 — el dinero SALE: `egreso` / `egreso_pago_tienda` por el monto del pago, con
   * origen `(pago_tienda, pagoId)` y fechado el dia real del pago.
   *
   * De naturaleza TERCEROS (`lib/utils/caja-tesoreria.ts`): baja el «dinero en caja» y **no
   * roza la ganancia de Ordenex**, porque ese dinero nunca fue suyo — entro en la caja como
   * contra-entrega recaudado a nombre de la tienda y ahora se le entrega.
   *
   * Escribe en la `tx` que se le pasa (R19: la misma transaccion que crea el documento y el
   * debito del ledger; si esto falla, no queda el pago). Devuelve cuantas filas se insertaron:
   * **0 es la respuesta correcta** al reintento del mismo pago, y no un fallo (R21) — la
   * barrera es el indice unico parcial `(origen_tipo, origen_id, categoria)`, no un `if`.
   */
  emitirEgresoDePago(
    tx: CajaPagoTiendaTxClient,
    movimiento: MovimientoDeCajaDePagoTienda,
  ): Promise<number>;
  /**
   * R24/R25/R26 — el dinero VUELVE: `ingreso` / `ingreso_reverso_pago_tienda` por el mismo
   * monto del pago anulado, con el MISMO origen `(pago_tienda, pagoId)` y fechado el dia de la
   * anulacion.
   *
   * **La categoria es `ingreso_reverso_pago_tienda` y NO `ingreso_ajuste`** (design §10-C):
   * `ingreso_ajuste` es de naturaleza PROPIA, asi que reusarlo haria que anular un pago a una
   * tienda **subiera la ganancia de Ordenex**. Es el motivo entero de que el enum ganara dos
   * valores y no uno.
   *
   * Comparte `(origen_tipo, origen_id)` con el egreso del pago y se distingue por `categoria`:
   * caben las dos filas y ninguna puede duplicarse (R28). Igual que arriba, devolver 0 es el
   * desenlace correcto del segundo intento de anular.
   */
  emitirReversoDeAnulacion(
    tx: CajaPagoTiendaTxClient,
    movimiento: MovimientoDeCajaDePagoTienda,
  ): Promise<number>;
}
