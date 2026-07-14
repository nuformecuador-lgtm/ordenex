import { cn } from "@/lib/utils";
import { toValidNumber } from "@/lib/utils/number";

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
