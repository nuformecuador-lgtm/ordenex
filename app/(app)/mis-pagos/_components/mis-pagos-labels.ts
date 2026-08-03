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
  positivo: "text-warning-strong",
  cero: "text-muted-foreground",
};

/** Etiquetas de la tarjeta de cuenta por pagar del mensajero. */
export const CUENTA_LABEL = {
  cuentaPorPagar: "Cuenta por pagar",
  cuentaPorPagarHint: "Lo que Ordenex te debe pagar",
  devengado: "Devengado",
  pagado: "Pagado",
} as const;

/**
 * Feature 172 (T G.2) — la limitacion N1, tambien en el libro del MENSAJERO.
 *
 * La regla que decide donde hace falta este aviso es: **donde se muestre un importe AGREGADO
 * que siga contando lo anulado**. Esta tarjeta muestra dos —«Devengado» (Σ de lo devengado,
 * que incluye la devolucion de un pago anulado) y «Pagado» (Σ de lo entregado, que sigue
 * contando el pago anulado)—, asi que aqui hace falta. En la TABLA de abajo no: alli el pago y
 * su reverso se ven los dos, uno al lado del otro, y se explican solos.
 *
 * Mismo lenguaje que el aviso de la cabecera de la tienda (T F.6) y compuesto con los rotulos
 * REALES de la tarjeta, para que un renombrado no lo deje hablando de una cifra que ya no
 * existe. Sin jerga: ni «contraasiento», ni «neteo», ni siglas.
 */
export const CUENTA_AVISO_BRUTOS =
  `«${CUENTA_LABEL.pagado}» sigue contando los pagos que se anularon, y ` +
  `«${CUENTA_LABEL.devengado}» suma la devolución de cada uno, así que esos dos importes ` +
  `quedan más altos de lo que se movió de verdad. «${CUENTA_LABEL.cuentaPorPagar}» ya tiene ` +
  `todo eso descontado: ese es el número correcto.`;
