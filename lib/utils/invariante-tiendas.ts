import type { WalletMovimientoCategoria } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

/**
 * Ficha 459 (design §2.3/§12.3, R9/R90) — la tabla que hace que «De las tiendas» (la caja) y la
 * suma de los saldos de las tiendas (su libro) sean la MISMA cifra.
 *
 * Cada concepto del libro de las tiendas declara su CONTRAPARTIDA en la caja: el concepto de la
 * caja que, en la misma transaccion, mueve «De las tiendas» en el mismo sentido y por el mismo
 * importe que este concepto mueve el saldo de la tienda. Asi, con S = Σ saldos y T = «De las
 * tiendas»:
 *
 *     T − S = Σ conceptos de la tienda SIN contrapartida
 *
 * Ficha 461 (design §2.3, HD2, R23/R25/R26): la excepcion del cobro DESAPARECE. El cobro de Ordenex a
 * una tienda (`cobro_manual`) tiene desde esta ficha su contrapartida —el CARGO `ingreso_cobro_tienda`,
 * que baja «De las tiendas» igual que un flete— y su anulacion (`cobro_tienda_anulado`) tiene el
 * REVERSO de ese cargo (`egreso_reverso_cobro_tienda`, que la sube). Queda SOLO `ajuste_debito` sin
 * pareja, y no tiene productor en el arbol: R8 vale sin excepcion.
 *
 * Los dos `Record` son TOTALES: una categoria nueva del libro de la tienda no compila hasta que
 * alguien decide su tipo y su contrapartida. La guardia
 * `tests/unit/guards/caja-clasificacion-459.guardia.test.ts` comprueba, contra
 * `NATURALEZA_POR_CATEGORIA` y `LIQUIDEZ_POR_CATEGORIA`, que cada pareja mueve las dos cifras en el
 * mismo sentido, que todo concepto de la caja que mueve «De las tiendas» es pareja de EXACTAMENTE
 * uno de la tienda y que el conjunto sin pareja es EXACTAMENTE `{ajuste_debito}` (anadir otro es
 * abrir una excepcion nueva a R8, y eso se decide, no se cuela).
 */

/** El tipo de cada concepto del libro de la tienda. Espejo del CHECK de la base. */
export const TIPO_POR_CATEGORIA_TIENDA: Record<
  WalletTiendaMovimientoCategoria,
  "credito" | "debito"
> = {
  cod_recaudado: "credito",
  ajuste_credito: "credito",
  flete: "debito",
  flete_devolucion: "debito",
  comision_cod: "debito",
  iva_flete: "debito",
  iva_flete_devolucion: "debito",
  iva_comision_cod: "debito",
  pago_tienda: "debito",
  ajuste_debito: "debito",
  cobro_manual: "debito",
  pago_por_cuenta: "debito",
  pago_por_cuenta_anulado: "credito",
  cobro_tienda_anulado: "credito", // ficha 461: la anulacion devuelve el monto a la tienda
  abono_tienda: "credito", // ficha 457: la tienda le paga a Ordenex y su saldo sube
  abono_tienda_anulado: "debito", // ficha 457: la anulacion del pago: vuelve a deber
  flete_devolucion_anulado: "credito", // ficha 458-B: la anulacion del cobro por rechazo devuelve el flete
  iva_flete_devolucion_anulado: "credito", // ficha 458-B: ... y su IVA
};

/** Marca de los conceptos de la tienda que NO tienen asiento en la caja. */
export const SIN_CONTRAPARTIDA = "sin_contrapartida";

export const CONTRAPARTIDA_EN_CAJA: Record<
  WalletTiendaMovimientoCategoria,
  WalletMovimientoCategoria | typeof SIN_CONTRAPARTIDA
> = {
  // El contra-entrega que entra a la caja es el credito de la tienda (CajaCodFeedService lee
  // exactamente esos creditos).
  cod_recaudado: "ingreso_cod_recaudado",
  // La anulacion de un pago a tienda: vuelve el dinero a la caja y a la tienda.
  ajuste_credito: "ingreso_reverso_pago_tienda",
  // Los seis cargos: el debito de la tienda es el ingreso propio de la caja (MAPEO_CONCEPTO_TIENDA).
  flete: "ingreso_flete",
  flete_devolucion: "ingreso_flete_devolucion",
  comision_cod: "ingreso_comision_cod",
  iva_flete: "ingreso_iva_flete",
  iva_flete_devolucion: "ingreso_iva_flete_devolucion",
  iva_comision_cod: "ingreso_iva_comision_cod",
  // El pago de Ordenex a la tienda sale de la caja.
  pago_tienda: "egreso_pago_tienda",
  // Ficha 461 (HD1/HD2, R1/R23): el cobro de Ordenex a una tienda escribe su CARGO en la caja en la
  // MISMA transaccion (`CobroTiendaService` → `CajaCobroTiendaFeedService`); los cobros previos sin
  // linea la reciben por la migracion `20260926120200_cobro_tienda_461_completar_caja`. La excepcion
  // HF6 de la 459 queda cerrada.
  cobro_manual: "ingreso_cobro_tienda",
  // Sin productor en el arbol (solo lo nombran tipos, etiquetas y metricas).
  ajuste_debito: SIN_CONTRAPARTIDA,
  // Ficha 459 (R29/R46): el pago por cuenta sale de la caja en la MISMA transaccion en que se
  // debita a la tienda, y su anulacion vuelve a los dos libros a la vez.
  pago_por_cuenta: "egreso_pago_por_cuenta_tienda",
  pago_por_cuenta_anulado: "ingreso_reverso_pago_por_cuenta_tienda",
  // Ficha 461 (R10/R12): la anulacion del cobro acredita a la tienda y escribe el REVERSO del cargo
  // en la caja, en la misma transaccion; las dos mueven «De las tiendas» y el saldo hacia arriba.
  cobro_tienda_anulado: "egreso_reverso_cobro_tienda",
  // Ficha 457 (R17/R24/R31): el pago de una tienda a Ordenex entra a la caja como efectivo de
  // terceros en la MISMA transaccion en que se acredita a la tienda (`AbonoTiendaService` →
  // `CajaAbonoTiendaFeedService`); su anulacion debita a la tienda y saca el reverso de la caja.
  // La misma pareja «efectivo de terceros» que `cod_recaudado ↔ ingreso_cod_recaudado`.
  abono_tienda: "ingreso_abono_tienda",
  abono_tienda_anulado: "egreso_reverso_abono_tienda",
  // Ficha 458-B (design §2.3/§4.2, D7): la anulacion de un cobro por rechazo acredita a la tienda y
  // escribe el REVERSO de cada cargo en la caja, en la misma transaccion; los dos mueven «De las
  // tiendas» y el saldo hacia arriba (la misma pareja que `cobro_tienda_anulado`).
  flete_devolucion_anulado: "egreso_reverso_flete_devolucion",
  iva_flete_devolucion_anulado: "egreso_reverso_iva_flete_devolucion",
};
