import type {
  TipoEgresoManual,
  WalletMovimientoCategoria,
  WalletMovimientoDTO,
  WalletMovimientoTipo,
  WalletOrigenTipo,
} from "@/lib/types/wallet";
import {
  TIPO_EGRESO_MANUAL_SEED,
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
  egreso_gasto_fijo: "Gasto fijo",
  egreso_gasto_variable: "Gasto variable",
  egreso_indemnizacion: "Indemnización por incidente", // feature 158/R31
  // Feature 173 (R61, design §8) — las dos categorías de TESORERÍA. `CATEGORIA_LABEL` es un
  // `Record` completo: sin estas dos claves el build NO compila, que es exactamente la red que
  // obliga a bautizar cada concepto nuevo en vez de dejarlo caer con su nombre técnico.
  ingreso_cod_recaudado: "Contra-entrega cobrado",
  ingreso_reverso_pago_tienda: "Pago a tienda anulado",
};

/** Etiqueta legible del origen de un movimiento. */
export const ORIGEN_LABEL: Record<WalletOrigenTipo, string> = {
  cierre_dia: "Cierre del día",
  gestion_orden: "Gestión de orden",
  manual: "Manual",
  pago_tienda: "Pago a tienda",
  pago_mensajero: "Pago a mensajero",
  gasto: "Gasto",
  // Feature 158/R37: origen del egreso de indemnizacion del camino del ADMIN. Sigue la forma
  // del hermano `gestion_orden` ("Gestión de orden"): nombra la ENTIDAD que origina el
  // movimiento, no la accion. `ORIGEN_LABEL` es un `Record` completo — sin esta clave el build
  // no compila, que es exactamente la red que obliga a decidir la etiqueta.
  orden_incidente: "Incidente de orden",
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

// ── Feature 45 — egresos administrativos (manual) ──

// Etiqueta legible de cada TIPO de egreso manual (R22a). El gasto FIJO NO figura: lo
// emite el cron, no el formulario manual (R2/R19).
export const TIPO_EGRESO_MANUAL_LABEL: Record<TipoEgresoManual, string> = {
  gasto_variable: "Gasto variable",
  sueldo: "Sueldo",
};

/** Opciones del `Select` de tipo del egreso manual (solo {gasto variable, sueldo}). */
export const TIPO_EGRESO_MANUAL_OPTIONS = TIPO_EGRESO_MANUAL_SEED.map((tipo) => ({
  value: tipo,
  label: TIPO_EGRESO_MANUAL_LABEL[tipo],
}));

// Etiqueta del campo descripción, adaptada al tipo de egreso (R5/R22a): el concepto del
// gasto variable, o el nombre del trabajador + periodo del sueldo (texto libre, F1.4-c).
export const DESCRIPCION_EGRESO_LABEL: Record<TipoEgresoManual, string> = {
  gasto_variable: "Concepto del gasto",
  sueldo: "Trabajador y periodo",
};

export const DESCRIPCION_EGRESO_PLACEHOLDER: Record<TipoEgresoManual, string> = {
  gasto_variable: "Ej. Compra de suministros de oficina",
  sueldo: "Ej. Juan Pérez — julio 2026",
};

/**
 * Feature 172 (T D.1): `montoValido` se PROMOVIÓ a `components/shared/monto-cliente.ts` sin
 * cambiarle una línea, porque el formulario de pago de la liquidación —que vive en
 * `components/shared/` y no puede depender de `app/`— es la cuarta feature que lo necesita
 * con la misma API. Se re-exporta desde aquí para que los cinco consumidores actuales (42,
 * 45, 158 y sus tests) sigan importándolo del mismo sitio: es una mudanza, no un cambio de
 * comportamiento.
 */
export { montoValido } from "@/components/shared/monto-cliente";

/** Un egreso administrativo es reversable (R22c/R32): `tipo=egreso` ∧ `origen_tipo=gasto`. */
export function esEgresoAdministrativo(m: WalletMovimientoDTO): boolean {
  return m.tipo === "egreso" && m.origenTipo === "gasto";
}
