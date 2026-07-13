import type {
  WalletMovimientoCategoria,
  WalletMovimientoTipo,
  WalletOrigenTipo,
} from "@/lib/types/wallet";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  WALLET_MOVIMIENTO_TIPO_SEED,
} from "@/lib/types/wallet";

// Feature 42 (T12) — etiquetas i18n-ready y helper de moneda de la wallet, separados
// de la lógica (docs/conventions: textos de UI fuera del componente). Money-safe (R21/
// R25): `money` recibe un monto que YA viene como STRING desde el Server Component y solo
// antepone el símbolo; NUNCA parseFloat/Number sobre montos (no se pierde precisión).

/** Antepone el símbolo de colón a un monto STRING (tal cual, sin parseo). `null` → "—". */
export function money(value: string | null): string {
  return value === null ? "—" : `₡${value}`;
}

/** Etiqueta legible del tipo de movimiento (ingreso/egreso). */
export const TIPO_LABEL: Record<WalletMovimientoTipo, string> = {
  ingreso: "Ingreso",
  egreso: "Egreso",
};

/** Etiqueta legible de cada categoría (concepto) del libro. */
export const CATEGORIA_LABEL: Record<WalletMovimientoCategoria, string> = {
  ingreso_flete: "Flete",
  ingreso_flete_devolucion: "Flete de devolución",
  ingreso_comision_cod: "Comisión COD",
  ingreso_iva_flete: "IVA del flete",
  ingreso_iva_flete_devolucion: "IVA del flete de devolución",
  ingreso_iva_comision_cod: "IVA de la comisión",
  ingreso_ajuste: "Ajuste (ingreso)",
  egreso_pago_tienda: "Pago a tienda",
  egreso_pago_mensajero: "Pago a mensajero",
  egreso_gasto: "Gasto",
  egreso_sueldo: "Sueldo",
  egreso_ajuste: "Ajuste (egreso)",
};

/** Etiqueta legible del origen de un movimiento. */
export const ORIGEN_LABEL: Record<WalletOrigenTipo, string> = {
  cierre_dia: "Cierre del día",
  gestion_orden: "Gestión de orden",
  manual: "Manual",
  pago_tienda: "Pago a tienda",
  pago_mensajero: "Pago a mensajero",
  gasto: "Gasto",
};

/** Opciones del `Select` de tipo (con opción "todos" = value ""). */
export const TIPO_OPTIONS = [
  { value: "", label: "Todos los tipos" },
  ...WALLET_MOVIMIENTO_TIPO_SEED.map((tipo) => ({
    value: tipo,
    label: TIPO_LABEL[tipo],
  })),
];

/** Opciones del `Select` de categoría, pobladas desde el SEED (con opción "todas"). */
export const CATEGORIA_OPTIONS = [
  { value: "", label: "Todas las categorías" },
  ...WALLET_MOVIMIENTO_CATEGORIA_SEED.map((categoria) => ({
    value: categoria,
    label: CATEGORIA_LABEL[categoria],
  })),
];
