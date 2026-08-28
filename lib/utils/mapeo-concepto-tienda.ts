import type { WalletIngresoConcepto } from "@/lib/types/wallet";
import type { WalletTiendaDebitoCategoria } from "@/lib/types/wallet-tienda";

/**
 * Feature 43 (design §2.1, R8) — FUENTE UNICA del mapeo 1:1 entre los 6 conceptos de ingreso
 * de la 42 (`WalletIngresoConcepto`) y las 6 categorias de DEBITO del ledger de la tienda
 * (`WalletTiendaDebitoCategoria`). El saldo de la tienda es el COMPLEMENTO del ingreso de
 * Ordenex: cada `ingreso_X` que Ordenex percibe es un debito `X` que se resta a la tienda.
 * NO se define una formula nueva: solo se renombra el concepto (misma cifra derivada por
 * `derivarIngresoOrden`). El `satisfies` fija que las llaves cubran EXACTAMENTE los 6
 * conceptos (Record total): si el enum de ingreso cambia, el build rompe aqui.
 *
 * FICHA 301 (2026-08-28): este mapa es SOLO nombres y no cambia — los 6 conceptos siguen
 * existiendo. Lo que cambio es QUE GESTIONES los producen: `flete_devolucion` e
 * `iva_flete_devolucion` ya solo llegan desde una gestion `rechazada`; una `devuelta` no
 * deriva ningun concepto, asi que no entra por este mapa a debitar nada.
 */
export const MAPEO_CONCEPTO_TIENDA = {
  ingreso_flete: "flete",
  // Ficha 301: solo `rechazada`. "Devolucion" nombra el CONCEPTO (el retorno del paquete),
  // no el resultado de gestion `devuelta`.
  ingreso_flete_devolucion: "flete_devolucion",
  ingreso_comision_cod: "comision_cod",
  ingreso_iva_flete: "iva_flete",
  ingreso_iva_flete_devolucion: "iva_flete_devolucion",
  ingreso_iva_comision_cod: "iva_comision_cod",
} as const satisfies Record<WalletIngresoConcepto, WalletTiendaDebitoCategoria>;

/** Mapea un concepto de ingreso de la 42 a su categoria de debito 1:1 en el ledger de la tienda. */
export function conceptoIngresoADebitoTienda(
  concepto: WalletIngresoConcepto,
): WalletTiendaDebitoCategoria {
  return MAPEO_CONCEPTO_TIENDA[concepto];
}
