import type { PagoMensajeroMovimientoCategoria } from "@/lib/types/wallet-mensajero";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §3.2, D10, R24/R98) — LOS CHIPS DEL ESTADO DE CUENTA, escritos UNA vez.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Cada movimiento pertenece a EXACTAMENTE un chip, decidido por su (categoria, origen) — un
// diccionario TOTAL por libro. Un contra-asiento va al chip de SU original (la anulacion de un pago
// es «Pagos»). «Todo» no es un chip: es no filtrar. Modulo PURO: lo usan el repositorio (para
// traducir el chip a su WHERE) y el servicio (para rotular cada fila) — si fueran dos definiciones,
// el filtro y la fila podrian discrepar.
//
// La guardia `tests/unit/guards/estado-cuenta-chips-total.guardia.test.ts` comprueba la totalidad
// (cada par posible cae en UN chip) y tiene su contraprueba.

export const CHIPS_TIENDA = ["cierres", "pagos", "cobros", "correcciones"] as const;
export const CHIPS_MENSAJERO = ["cierres", "pagos", "premios", "correcciones"] as const;
export const CHIPS_BODEGA = ["declarado", "recibido"] as const;

export type ChipTienda = (typeof CHIPS_TIENDA)[number];
export type ChipMensajero = (typeof CHIPS_MENSAJERO)[number];
export type ChipBodega = (typeof CHIPS_BODEGA)[number];
export type ChipEstadoCuenta = ChipTienda | ChipMensajero | ChipBodega;

/**
 * Libro de la TIENDA. `Record` TOTAL sobre la categoria; el origen solo decide en los dos debitos de
 * devolucion (y sus creditos de anulacion): por un CIERRE son «Cierres», por un cobro por rechazo
 * (origen `gestion_orden`) son «Cobros».
 */
export const CHIP_POR_CATEGORIA_TIENDA: Record<
  WalletTiendaMovimientoCategoria,
  (origen: WalletOrigenTipo) => ChipTienda
> = {
  // Lo que produce un cierre.
  cod_recaudado: () => "cierres",
  flete: () => "cierres",
  comision_cod: () => "cierres",
  iva_flete: () => "cierres",
  iva_comision_cod: () => "cierres",
  flete_devolucion: (origen) => (origen === "gestion_orden" ? "cobros" : "cierres"),
  iva_flete_devolucion: (origen) => (origen === "gestion_orden" ? "cobros" : "cierres"),
  // Lo que Ordenex le paga a la tienda (y lo que la tienda le paga a Ordenex), con sus anulaciones.
  pago_tienda: () => "pagos",
  ajuste_credito: () => "pagos", // la anulacion de un pago a la tienda (172)
  pago_por_cuenta: () => "pagos",
  pago_por_cuenta_anulado: () => "pagos",
  abono_tienda: () => "pagos",
  abono_tienda_anulado: () => "pagos",
  // Lo que Ordenex le cobra a la tienda, con sus anulaciones.
  cobro_manual: () => "cobros",
  cobro_tienda_anulado: () => "cobros",
  flete_devolucion_anulado: () => "cobros",
  iva_flete_devolucion_anulado: () => "cobros",
  // Correcciones.
  ajuste_debito: () => "correcciones",
};

/**
 * Libro del MENSAJERO. `Record` TOTAL sobre la categoria; el origen y la marca de premio (`premio_dia`
 * no nulo) deciden en los ajustes: la anulacion de un PAGO (origen `pago_mensajero`) es «Pagos», la de
 * un PREMIO es «Premios», cualquier otro ajuste es una «Correccion».
 */
export const CHIP_POR_CATEGORIA_MENSAJERO: Record<
  PagoMensajeroMovimientoCategoria,
  (origen: WalletOrigenTipo, esPremio: boolean) => ChipMensajero
> = {
  pago_devengado: () => "cierres",
  pago_efectivo: () => "cierres",
  liquidacion: () => "pagos",
  premio_ranking: () => "premios",
  ajuste_devengo: (origen, esPremio) => (esPremio ? "premios" : origen === "pago_mensajero" ? "pagos" : "correcciones"),
  ajuste_pago: (origen, esPremio) => (esPremio ? "premios" : origen === "pago_mensajero" ? "pagos" : "correcciones"),
};

export function chipDeTienda(categoria: WalletTiendaMovimientoCategoria, origen: WalletOrigenTipo): ChipTienda {
  return CHIP_POR_CATEGORIA_TIENDA[categoria](origen);
}

export function chipDeMensajero(
  categoria: PagoMensajeroMovimientoCategoria,
  origen: WalletOrigenTipo,
  esPremio: boolean,
): ChipMensajero {
  return CHIP_POR_CATEGORIA_MENSAJERO[categoria](origen, esPremio);
}
