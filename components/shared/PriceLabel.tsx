import { cn } from "@/lib/utils";

// Símbolo del colón (₡), moneda de la app. Se antepone SIEMPRE al valor.
const SIMBOLO = "₡";

export interface PriceLabelProps {
  /**
   * Valor a mostrar. El contrato pide un string, pero se aceptan también number
   * y null/undefined para poder consumir directamente valores numéricos (p. ej.
   * las tarifas del listado) sin castear en cada uso.
   */
  value?: string | number | null;
  /** Nº máximo de decimales a mostrar (default 2; enteros no fuerzan decimales). */
  maxDecimals?: number;
  className?: string;
}

/**
 * Normaliza la entrada a un número finito. Devuelve 0 si el valor no existe, es
 * cadena vacía/en blanco o no representa un número válido (contrato: fallback a 0).
 */
function toValidNumber(value: PriceLabelProps["value"]): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Etiqueta de precio: muestra el valor como número con separadores de miles y el
 * símbolo ₡ antepuesto (p. ej. `₡1.234,50`). Si el valor no existe o no es válido,
 * muestra `₡0`. UI pura, reutilizable en tablas, tarjetas y detalles.
 */
export function PriceLabel({ value, maxDecimals = 2, className }: PriceLabelProps) {
  const amount = toValidNumber(value);
  // es-CR: separador de miles "." y decimal ",". minimumFractionDigits 0 para no
  // forzar ",00" en enteros; maximumFractionDigits acota los decimales mostrados.
  const formatted = new Intl.NumberFormat("es-CR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(amount);

  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {SIMBOLO}{' '}
      {formatted}
    </span>
  );
}
