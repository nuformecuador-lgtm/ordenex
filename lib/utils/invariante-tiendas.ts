import type { WalletMovimientoCategoria } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

/**
 * Ficha 459 (design §2.3/§12.3, R9/R90) — la tabla que hace que «De las tiendas» (la caja) y la
 * suma de los saldos de las tiendas (su libro) sean la MISMA cifra, salvo una excepcion declarada.
 *
 * Cada concepto del libro de las tiendas declara su CONTRAPARTIDA en la caja: el concepto de la
 * caja que, en la misma transaccion, mueve «De las tiendas» en el mismo sentido y por el mismo
 * importe que este concepto mueve el saldo de la tienda. Asi, con S = Σ saldos y T = «De las
 * tiendas»:
 *
 *     T − S = Σ conceptos de la tienda SIN contrapartida
 *
 * y la unica excepcion viva es el cobro de un costo (`cobro_manual`): baja el saldo de la tienda
 * sin pasar por la caja (HF6 de la 459). `ajuste_debito` no tiene productor en el arbol.
 *
 * Los dos `Record` son TOTALES: una categoria nueva del libro de la tienda no compila hasta que
 * alguien decide su tipo y su contrapartida. La guardia
 * `tests/unit/guards/caja-clasificacion-459.guardia.test.ts` comprueba, contra
 * `NATURALEZA_POR_CATEGORIA` y `LIQUIDEZ_POR_CATEGORIA`, que cada pareja mueve las dos cifras en el
 * mismo sentido, que todo concepto de la caja que mueve «De las tiendas» es pareja de EXACTAMENTE
 * uno de la tienda y que el conjunto sin pareja es EXACTAMENTE `{cobro_manual, ajuste_debito}`
 * (anadir otro es abrir una excepcion nueva a R8, y eso se decide, no se cuela).
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
  // HF6: cobrar un costo a una tienda NO mueve la caja. Es la excepcion declarada de R8.
  cobro_manual: SIN_CONTRAPARTIDA,
  // Sin productor en el arbol (solo lo nombran tipos, etiquetas y metricas).
  ajuste_debito: SIN_CONTRAPARTIDA,
};
