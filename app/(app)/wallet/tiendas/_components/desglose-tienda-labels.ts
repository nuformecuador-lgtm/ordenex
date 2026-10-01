/**
 * Feature 171 (T2.1, design §2.1/§2.2) — textos del DESGLOSE del dinero de UNA tienda
 * (`/wallet/tiendas`, vista de los roles de acceso total).
 *
 * Módulo PURO (sin React): `docs/conventions` manda los textos de UI fuera del componente,
 * e i18n-ready — nada de literales incrustados en el JSX.
 *
 * Lo que este archivo comparte con `/mi-wallet` y lo que NO, y por qué (ficha 461, design §9, P4):
 *
 *  - **Comparte** `tipo`, `origen` y el helper `money`: se REEXPORTAN de `/mi-wallet` (R20 de la
 *    171). Son el MISMO objeto, no una copia con los mismos valores: es el mismo libro y dos mapas
 *    paralelos divergirían en cuanto alguien tocara uno. El estado del saldo sale de
 *    `saldo-tienda-signo-label` (R13).
 *  - **NO comparte** el nombre de cada CONCEPTO. Desde la ficha 461 (HD3, R43/R44) el mismo libro se
 *    lee desde dos lados: la oficina lee «Ordenex le cobra a la tienda» y la tienda lee «Ordenex te
 *    cobró». Un solo texto neutro no puede decir las dos cosas (alternativa A8 descartada), así que
 *    aquí vive el diccionario DESDE ORDENEX (`CATEGORIA_TIENDA_LABEL`) y en `/mi-wallet` el de la
 *    lectura desde la tienda (`CATEGORIA_MI_WALLET_LABEL`). Los dos son `Record` totales sobre el
 *    mismo enum y un test exige que difieran donde una parte actúa sobre la otra (R44). Este es el
 *    que el diálogo «Registrar movimiento» promete (R46) y el que sale en la descarga de la oficina.
 *
 * Lo ÚNICO propio de esta pantalla, además, son los cuatro importes de la cabecera: el dinero de una
 * tienda no es el de un mensajero (a ella se le DEBE lo cobrado a sus clientes y se le COBRAN los
 * servicios), así que «Total devengado / Total pagado / Cuenta por pagar» no aplica.
 */
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

export {
  ORIGEN_TIENDA_LABEL,
  TIPO_TIENDA_LABEL,
  money,
  origenLabel,
} from "../../../mi-wallet/_components/mi-wallet-labels";

export { SALDO_SIGNO_LABEL } from "./saldo-tienda-signo-label";

/**
 * Ficha 461 (design §7.4, R43) — cada concepto del libro de la tienda, DESDE ORDENEX y diciendo
 * quién le paga a quién. Sin siglas («contra-entrega», no «COD»; P9) y sin jerga («corrección»,
 * no «ajuste»). Los seis cargos del cierre usan el MISMO texto que sus contrapartidas en el libro
 * de la caja (`CATEGORIA_LABEL`, design §7.2). Tabla, filtro por concepto y descarga salen de aquí.
 */
export const CATEGORIA_TIENDA_LABEL: Record<WalletTiendaMovimientoCategoria, string> = {
  cod_recaudado: "Contra-entrega cobrado a los clientes de la tienda",
  flete: "Flete cobrado a la tienda",
  flete_devolucion: "Flete por devolución a origen cobrado a la tienda",
  comision_cod: "Comisión de contra-entrega cobrada a la tienda",
  iva_flete: "IVA del flete cobrado a la tienda",
  iva_flete_devolucion: "IVA del flete por devolución a origen cobrado a la tienda",
  iva_comision_cod: "IVA de la comisión cobrado a la tienda",
  // FICHA 381 (R33/R34): el cobro decidido por una persona, DISTINTO de una corrección.
  cobro_manual: "Ordenex le cobra a la tienda",
  cobro_tienda_anulado: "Cobro de Ordenex a la tienda anulado",
  pago_tienda: "Ordenex le paga a la tienda",
  pago_por_cuenta: "Ordenex paga un gasto de la tienda",
  pago_por_cuenta_anulado: "Pago de un gasto de la tienda anulado",
  // Ficha 457 (design §2, D10): el pago de la tienda a Ordenex (nombre reservado por la 461 §7.8,
  // tomado aqui) y su anulacion, con el patron de «Pago de un gasto de la tienda anulado».
  abono_tienda: "La tienda le paga a Ordenex",
  abono_tienda_anulado: "Pago de la tienda a Ordenex anulado",
  // Ficha 458-B (design §2.3, D7): la anulación de un cobro por rechazo, flete e IVA por separado.
  flete_devolucion_anulado: "Cobro por devolución a origen anulado",
  iva_flete_devolucion_anulado: "IVA del cobro por devolución a origen anulado",
  ajuste_credito: "Corrección a favor de la tienda",
  ajuste_debito: "Corrección en contra de la tienda",
};


/**
 * Los CUATRO importes de la cabecera, en el orden de R7 — que es la fórmula leída de
 * izquierda a derecha: `saldo = a favor − cargos − pagado`.
 *
 * «Pagado a la tienda» es lo que Ordenex le pagó a la tienda o pagó por ella, leído de las
 * categorías reales del libro. Va aparte de «cargos» para que se distinga *lo que te cobré* de
 * *lo que ya te pagué* mirando esta pantalla. (Ficha 458-A, T1: aquí decía que salía siempre en
 * 0,00 hasta la 172; la 172 ya emite pagos.)
 *
 * Ficha 461 (design §7.5, R45): las tres pistas nombran el cobro y su anulación con la MISMA
 * palabra con la que se rotula su fila en ESTA pantalla («los cobros de Ordenex a la tienda»,
 * «devoluciones por anulaciones»), en tercera persona y sin la sigla «COD».
 */
export const DESGLOSE_TIENDA_LABEL = {
  aFavor: "A favor de la tienda",
  // Ficha 457 (design §2, R50): nombra el pago de la tienda a Ordenex y su anulación.
  aFavorHint:
    "Contra-entrega cobrado, correcciones a favor, pagos de la tienda a Ordenex y devoluciones por anulaciones",
  cargos: "Cargos de Ordenex",
  cargosHint: "Fletes, comisión, IVA, los cobros de Ordenex a la tienda y sus pagos a Ordenex anulados",
  pagado: "Pagado a la tienda",
  pagadoHint: "Lo que Ordenex le pagó a la tienda o pagó por ella",
  saldo: "Saldo a favor",
  saldoHint: "Lo que queda tras los cargos y los pagos",
} as const;

// FICHA 458-D (T D.8): aquí vivían las cabeceras, los filtros, los nombres accesibles, el vacío, el
// error y la opción «todos» del DESGLOSE de una tienda (`DesgloseMovimientosTienda`), retirado con él
// (D14). El estado de cuenta que lo sustituye tiene sus textos en
// `components/shared/estado-cuenta/estado-cuenta-labels.ts` y los de esta pantalla en
// `estado-cuenta-tienda-labels.ts`. Aquí quedan el diccionario desde Ordenex y los cuatro importes,
// que `/mi-wallet` sigue leyendo.
