import type { WalletMovimientoCategoria, WalletOrigenTipo } from "@/lib/types/wallet";

// Ficha 458-A (revision m2) — los ROTULOS de la wallet que lee el SERVIDOR.
//
// Estos diccionarios nacieron en los modulos de etiquetas de las pantallas (`wallet-labels.ts`,
// `mi-wallet-labels.ts`, `wallet-mensajeros-labels.ts`, `detalle-movimiento-labels.ts`), que los
// siguen re-exportando: son el MISMO objeto, asi que la pantalla, la descarga y el servidor dicen lo
// mismo porque leen del mismo sitio. Se mudan aqui porque los leen tambien `OrigenLegibleService`
// (el texto del origen) y `WalletEgresoService` (la descripcion del reverso), y un servicio de
// `lib/` no importa de `app/**/_components` (docs/architecture.md, capas).
//
// Las guardias de la 458 (`wallet-origen-total`, `wallet-etiqueta-cuenta`...) y la de nombres
// retirados de la 461 barren este archivo junto con las carpetas de la wallet.

/**
 * Etiqueta legible de cada categoría (concepto) del libro.
 *
 * Ficha 461 (HD3, design §7.2, R42) — TODOS los conceptos se dicen DESDE ORDENEX y diciendo QUIÉN
 * LE PAGA A QUIÉN: «Ordenex le paga a una tienda», «Flete cobrado a la tienda», «Ordenex le cobra
 * a una tienda». Sin siglas («contra-entrega», no «COD»; P9) y sin jerga («corrección», no
 * «ajuste»). Los nombres que estos sustituyen quedan RETIRADOS (design §7.9) y una guardia
 * (`tests/unit/guards/nombres-wallet-461.guardia.test.ts`) impide que vuelvan. `Record` total:
 * una categoría nueva no compila hasta que alguien decida cómo se llama en pantalla.
 *
 * Los mismos textos rotulan la tabla, el filtro por concepto y la descarga del libro (R42): salen
 * de aquí y de ningún otro sitio.
 */
export const CATEGORIA_LABEL: Record<WalletMovimientoCategoria, string> = {
  // Los seis cargos del cierre dicen a quién se le cobran.
  ingreso_flete: "Flete cobrado a la tienda",
  ingreso_flete_devolucion: "Flete por rechazo cobrado a la tienda",
  ingreso_comision_cod: "Comisión de contra-entrega cobrada a la tienda",
  ingreso_iva_flete: "IVA del flete cobrado a la tienda",
  ingreso_iva_flete_devolucion: "IVA del flete por rechazo cobrado a la tienda",
  ingreso_iva_comision_cod: "IVA de la comisión cobrado a la tienda",
  // El cobro de Ordenex a una tienda (cargo, liquidez «cargo») y su reverso.
  ingreso_cobro_tienda: "Ordenex le cobra a una tienda",
  egreso_reverso_cobro_tienda: "Cobro a una tienda anulado",
  // El dinero de las tiendas que pasa por la caja.
  ingreso_cod_recaudado: "Contra-entrega cobrado a los clientes de la tienda",
  egreso_pago_tienda: "Ordenex le paga a una tienda",
  ingreso_reverso_pago_tienda: "Pago a una tienda anulado",
  egreso_pago_por_cuenta_tienda: "Ordenex paga un gasto de una tienda",
  ingreso_reverso_pago_por_cuenta_tienda: "Pago de un gasto de una tienda anulado",
  // Ficha 457 (design §2, DH7): el pago de una tienda a Ordenex (nombre reservado por la 461 §7.8,
  // tomado aqui) y su anulacion.
  ingreso_abono_tienda: "Una tienda le paga a Ordenex",
  egreso_reverso_abono_tienda: "Pago de una tienda a Ordenex anulado",
  // Lo que Ordenex gasta.
  egreso_pago_mensajero: "Ordenex le paga a un mensajero",
  egreso_sueldo: "Sueldo",
  egreso_gasto_variable: "Gasto de Ordenex",
  egreso_gasto_fijo: "Gasto fijo de Ordenex",
  // Categoría RESERVADA, sin escritor en el árbol: si aparece, alguien empezó a escribirla.
  egreso_gasto: "Otro gasto de Ordenex",
  egreso_indemnizacion: "Indemnización que Ordenex paga por un incidente",
  // Las correcciones de caja (antes «ajustes») y el capital de Ordenex.
  ingreso_ajuste: "Corrección de caja (suma)",
  egreso_ajuste: "Corrección de caja (resta)",
  ingreso_aporte_capital: "Aporte de dinero a la caja",
  egreso_reverso_aporte_capital: "Aporte de dinero a la caja anulado",
};

/**
 * Etiqueta legible del origen de un movimiento.
 *
 * Ficha 461 (design §7.3, R42): los origenes tambien se dicen desde Ordenex y diciendo quien le paga a
 * quien («Pago de Ordenex a una tienda»); los rotulos de una sola palabra de antes quedan retirados
 * porque no decian que fue una PERSONA quien lo registro. `ORIGEN_TIENDA_LABEL` (el libro de la tienda) usa los MISMOS
 * textos para los origenes que comparte. `Record` total: un origen nuevo no compila sin su nombre.
 */
export const ORIGEN_LABEL: Record<WalletOrigenTipo, string> = {
  cierre_dia: "Cierre del día",
  gestion_orden: "Gestión de orden",
  manual: "Registrado a mano",
  pago_tienda: "Pago de Ordenex a una tienda",
  pago_mensajero: "Pago de Ordenex a un mensajero",
  gasto: "Gasto o sueldo registrado a mano",
  // Feature 158/R37: origen del egreso de indemnizacion del camino del ADMIN. Sigue la forma
  // del hermano `gestion_orden` ("Gestión de orden"): nombra la ENTIDAD que origina el
  // movimiento, no la accion.
  orden_incidente: "Incidente de orden",
  // Feature 293 (T1.6, R20/R34): origen del egreso de caja del premio del ranking y de su
  // reverso — la FILA DEL PODIO del dia congelado.
  ranking_snapshot_fila: "Premio del ranking",
  pago_por_cuenta_tienda: "Pago de un gasto de una tienda",
  aporte_capital: "Aporte de dinero a la caja",
  cobro_manual_reclasificado: "Cobro reclasificado como pago de un gasto de la tienda",
  // El cargo del cobro y su reverso (servicio) y la linea completada por la migracion de datos (R37).
  cobro_tienda: "Cobro de Ordenex a una tienda",
  cobro_tienda_completado: "Cobro de Ordenex a una tienda (línea de caja completada al corregir)",
  // Ficha 457 (design §2): el documento del pago de una tienda a Ordenex.
  abono_tienda: "Pago de una tienda a Ordenex",
};

/**
 * Etiqueta legible del origen de un movimiento del libro de la tienda.
 *
 * Ficha 458-A (TA.2, R5/R9/R94): `Record<WalletOrigenTipo, string>` TOTAL y sin caida al valor
 * tecnico. Antes era `Record<string, string>` con `?? origenTipo`: un origen nuevo se pintaba crudo
 * sin que el compilador avisara. Ahora un origen nuevo del catalogo NO COMPILA sin su nombre aqui,
 * y la guardia `wallet-origen-total` falla si el mapa vuelve a ser parcial. Los origenes que hoy no
 * escriben en este libro llevan igualmente su nombre (el de la caja, 461 §7.3).
 *
 * Ficha 461 (design §7.3): los MISMOS textos que `ORIGEN_LABEL` en el libro de la caja para los
 * origenes que comparten («Registrado a mano», «Pago de Ordenex a una tienda», «Pago de un gasto de
 * una tienda»); y + `cobro_tienda`, el credito de la anulacion de un cobro. Los lee tambien la
 * oficina en `/wallet/tiendas` (que reexporta este objeto).
 */
export const ORIGEN_TIENDA_LABEL: Record<WalletOrigenTipo, string> = {
  cierre_dia: "Cierre del día",
  pago_tienda: "Pago de Ordenex a una tienda",
  manual: "Registrado a mano",
  gestion_orden: "Gestión de orden",
  pago_por_cuenta_tienda: "Pago de un gasto de una tienda",
  cobro_tienda: "Cobro de Ordenex a una tienda",
  // Ficha 457 (design §2/§4.2): el MISMO texto que `ORIGEN_LABEL` en la caja.
  abono_tienda: "Pago de una tienda a Ordenex",
  // Ficha 458-A (TA.2): los origenes que hoy no escriben en este libro, con el texto de la caja.
  pago_mensajero: "Pago de Ordenex a un mensajero",
  gasto: "Gasto o sueldo registrado a mano",
  orden_incidente: "Incidente de orden",
  ranking_snapshot_fila: "Premio del ranking",
  aporte_capital: "Aporte de dinero a la caja",
  cobro_manual_reclasificado: "Cobro reclasificado como pago de un gasto de la tienda",
  cobro_tienda_completado: "Cobro de Ordenex a una tienda (línea de caja completada al corregir)",
};

/**
 * Etiqueta legible del origen de un movimiento del libro del mensajero.
 *
 * Ficha 458-A (TA.2, R5/R9/R94): `Record<WalletOrigenTipo, string>` TOTAL, sin caida al valor
 * tecnico, con los textos de la 461 §7.3 (los mismos que `ORIGEN_LABEL` de la caja). «Liquidación»
 * y el rotulo de una palabra del origen manual se retiran: el primero es un CONCEPTO de este libro y el segundo, un
 * nombre retirado por la 461. Un origen nuevo del catalogo no compila sin su nombre aqui.
 */
export const ORIGEN_PAGO_LABEL: Record<WalletOrigenTipo, string> = {
  cierre_dia: "Cierre del día",
  pago_mensajero: "Pago de Ordenex a un mensajero",
  manual: "Registrado a mano",
  // Feature 293 (T1.6): origen de las filas de CAJA del premio. En este libro el premio va con
  // `cierre_dia`, pero el mapa es total.
  ranking_snapshot_fila: "Premio del ranking",
  gestion_orden: "Gestión de orden",
  pago_tienda: "Pago de Ordenex a una tienda",
  gasto: "Gasto o sueldo registrado a mano",
  orden_incidente: "Incidente de orden",
  pago_por_cuenta_tienda: "Pago de un gasto de una tienda",
  aporte_capital: "Aporte de dinero a la caja",
  cobro_manual_reclasificado: "Cobro reclasificado como pago de un gasto de la tienda",
  cobro_tienda: "Cobro de Ordenex a una tienda",
  cobro_tienda_completado: "Cobro de Ordenex a una tienda (línea de caja completada al corregir)",
  abono_tienda: "Pago de una tienda a Ordenex",
};

/**
 * R11 — el rótulo del enlace a `/ordenes`. Dice a dónde va Y con qué, nunca «ver».
 *
 * Se exporta el prefijo para que el test no repita el literal, igual que hizo la ficha 341 con
 * `ETIQUETA_VER_ORDEN`.
 */
export const DETALLE_MOVIMIENTO_VER_ORDEN = "Ver en órdenes la guía";

export function etiquetaVerOrden(guia: string): string {
  return `${DETALLE_MOVIMIENTO_VER_ORDEN} ${guia}`;
}
