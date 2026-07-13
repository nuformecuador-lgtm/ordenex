import type {
  CuentaPorPagarSigno,
  PagoMensajeroMovimientoCategoria,
  PagoMensajeroMovimientoTipo,
} from "@/lib/types/wallet-mensajero";

// Feature 44 (T15) — etiquetas i18n-ready y helper de moneda de la vista propia del
// MENSAJERO (`/mis-pagos`), separados de la logica (docs/conventions: textos de UI fuera del
// componente). Money-safe (R21/R27): `money` recibe un monto que YA viene como STRING desde
// el Server Component y solo antepone el simbolo; NUNCA parseFloat/Number sobre montos.

/** Antepone el simbolo de colon a un monto STRING (tal cual, sin parseo). `null` -> "—". */
export function money(value: string | null): string {
  return value === null ? "—" : `₡${value}`;
}

/** Etiqueta legible del tipo de movimiento (devengo = lo devengado / pago = lo entregado). */
export const TIPO_PAGO_LABEL: Record<PagoMensajeroMovimientoTipo, string> = {
  devengo: "Devengo",
  pago: "Pago",
};

/** Etiqueta legible de cada categoria (concepto) del libro del pago al mensajero. */
export const CATEGORIA_PAGO_LABEL: Record<PagoMensajeroMovimientoCategoria, string> = {
  pago_devengado: "Pago devengado",
  pago_efectivo: "Pago del efectivo",
  liquidacion: "Liquidación",
  ajuste_devengo: "Ajuste (devengo)",
  ajuste_pago: "Ajuste (pago)",
};

/** Etiqueta legible del origen de un movimiento (WalletOrigenTipo, subconjunto de la 44). */
export const ORIGEN_PAGO_LABEL: Record<string, string> = {
  cierre_dia: "Cierre del día",
  pago_mensajero: "Liquidación",
  manual: "Manual",
};

/** Origen legible con fallback al valor crudo si no hay etiqueta conocida. */
export function origenLabel(origenTipo: string): string {
  return ORIGEN_PAGO_LABEL[origenTipo] ?? origenTipo;
}

/** Badge de estado por signo de la cuenta por pagar (positivo = Ordenex te debe / cero = al dia). */
export const SIGNO_BADGE: Record<
  CuentaPorPagarSigno,
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: "Pendiente" },
  cero: { variant: "secondary", label: "Al día" },
};

/** Color del monto de la cuenta por pagar segun su signo. Nunca negativo en flujo normal (R16). */
export const CUENTA_COLOR: Record<CuentaPorPagarSigno, string> = {
  positivo: "text-amber-600 dark:text-amber-400",
  cero: "text-muted-foreground",
};

/** Etiquetas de la tarjeta de cuenta por pagar del mensajero. */
export const CUENTA_LABEL = {
  cuentaPorPagar: "Cuenta por pagar",
  cuentaPorPagarHint: "Lo que Ordenex te debe pagar",
  devengado: "Devengado",
  pagado: "Pagado",
} as const;
