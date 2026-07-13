import type {
  CuentaPorPagarSigno,
  PagoMensajeroMovimientoCategoria,
  PagoMensajeroMovimientoTipo,
} from "@/lib/types/wallet-mensajero";

// Feature 44 (T14) — etiquetas i18n-ready y helper de moneda de la vista del MAESTRO
// (cuentas por pagar a mensajeros), separados de la logica (docs/conventions: textos de UI
// fuera del componente). Money-safe (R21/R27): `money` recibe un monto que YA viene como
// STRING desde el Server Component y solo antepone el simbolo; NUNCA parseFloat/Number.

/** Antepone el simbolo de colon a un monto STRING (tal cual, sin parseo). `null` -> "—". */
export function money(value: string | null): string {
  return value === null ? "—" : `₡${value}`;
}

/** Cabeceras de la tabla de cuentas por pagar (una fila por mensajero). */
export const COLUMNAS_MAESTRO = {
  mensajero: "Mensajero",
  devengado: "Devengado",
  pagado: "Pagado",
  cuentaPorPagar: "Cuenta por pagar",
  estado: "Estado",
} as const;

/** Badge de estado por signo de la cuenta por pagar (positivo = Ordenex debe / cero = al dia). */
export const SIGNO_BADGE: Record<
  CuentaPorPagarSigno,
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: "Pendiente" },
  cero: { variant: "secondary", label: "Al día" },
};

/**
 * Color del monto de la cuenta por pagar segun su signo. Positivo (Ordenex le debe al
 * mensajero) se resalta en ambar; cero es neutro. Nunca negativo en flujo normal (R16).
 */
export const CUENTA_COLOR: Record<CuentaPorPagarSigno, string> = {
  positivo: "text-amber-600 dark:text-amber-400",
  cero: "text-muted-foreground",
};

/**
 * Etiquetas del saldo del desglose (split devengado/pagado/pendiente de un mensajero). En la
 * vista del maestro el saldo refleja el CONJUNTO FILTRADO (R22): al aplicar filtros de
 * fecha/cierre estos tres montos se recalculan desde `result.data.cuenta`, no del agregado.
 */
export const DESGLOSE_LABEL = {
  devengado: "Total devengado",
  devengadoHint: "Lo que Ordenex le debe por sus entregas",
  pagado: "Total pagado",
  pagadoHint: "Lo ya entregado (del efectivo recaudado)",
  cuentaPorPagar: "Cuenta por pagar",
  cuentaPorPagarHint: "Lo pendiente de pagar al mensajero",
} as const;

// ── Desglose POR CIERRE del maestro (R18/R22) ──

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

/** Cabeceras de la tabla del desglose por cierre (mas reciente primero). */
export const DESGLOSE_COLUMNAS = {
  fecha: "Fecha",
  tipo: "Tipo",
  concepto: "Concepto",
  monto: "Monto",
  origen: "Origen",
} as const;

/** Etiquetas de los filtros server-side del desglose por cierre (fecha/cierre, R22). */
export const DESGLOSE_FILTRO_LABEL = {
  cierre: "Cierre",
  cierrePlaceholder: "ID del cierre",
  desde: "Desde",
  hasta: "Hasta",
  aplicar: "Aplicar",
  limpiar: "Limpiar",
} as const;

/** Mensaje cuando el desglose filtrado no tiene movimientos. */
export const DESGLOSE_VACIO = "No hay movimientos que coincidan con los filtros.";
