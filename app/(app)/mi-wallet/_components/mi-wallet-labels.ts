import type {
  WalletTiendaMovimientoCategoria,
  WalletTiendaMovimientoTipo,
} from "@/lib/types/wallet-tienda";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";

// Feature 43 (T15) — etiquetas i18n-ready y helper de moneda del ledger POR TIENDA,
// separados de la logica (docs/conventions: textos de UI fuera del componente).
// Money-safe (R21/R27): `money` recibe un monto que YA viene como STRING desde el Server
// Component y solo antepone el simbolo; NUNCA parseFloat/Number sobre montos.

/** Antepone el simbolo de colon a un monto STRING (tal cual, sin parseo). `null` -> "—". */
export function money(value: string | null): string {
  return value === null ? "—" : `₡${value}`;
}

/** Etiqueta legible del tipo de movimiento (credito a favor / debito). */
export const TIPO_TIENDA_LABEL: Record<WalletTiendaMovimientoTipo, string> = {
  credito: "Crédito",
  debito: "Débito",
};

/** Etiqueta legible de cada categoria (concepto) del ledger por tienda. */
export const CATEGORIA_TIENDA_LABEL: Record<WalletTiendaMovimientoCategoria, string> = {
  cod_recaudado: "COD recaudado",
  flete: "Flete",
  flete_devolucion: "Flete de devolución",
  comision_cod: "Comisión COD",
  iva_flete: "IVA del flete",
  iva_flete_devolucion: "IVA del flete de devolución",
  iva_comision_cod: "IVA de la comisión",
  pago_tienda: "Pago a la tienda",
  ajuste_credito: "Ajuste (crédito)",
  ajuste_debito: "Ajuste (débito)",
};

/** Etiqueta legible del origen de un movimiento (WalletOrigenTipo, subconjunto de la 43). */
export const ORIGEN_TIENDA_LABEL: Record<string, string> = {
  cierre_dia: "Cierre del día",
  pago_tienda: "Pago a la tienda",
  manual: "Manual",
};

/** Origen legible con fallback al valor crudo si no hay etiqueta conocida. */
export function origenLabel(origenTipo: string): string {
  return ORIGEN_TIENDA_LABEL[origenTipo] ?? origenTipo;
}

/** Opciones del `Select` de concepto, pobladas desde el SEED (con opcion "todos"). */
export const CATEGORIA_TIENDA_OPTIONS = [
  { value: "", label: "Todos los conceptos" },
  ...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.map((categoria) => ({
    value: categoria,
    label: CATEGORIA_TIENDA_LABEL[categoria],
  })),
];
