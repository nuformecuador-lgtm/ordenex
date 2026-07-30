"use client";

import CountUp from "react-countup";

import { cn } from "@/lib/utils";
import { toValidNumber } from "@/lib/utils/number";

// Valor numérico de un KPI, animado de 0 al valor final con react-countup. Es
// client component (la animación necesita el navegador); el KPI en sí sigue
// siendo server-compatible y solo monta esta hoja. Nació en el portal del
// mensajero (feature 61) y vive acá desde que también lo usan los cierres.

// Símbolo del colón, igual que PriceLabel: se antepone SIEMPRE al valor.
const SIMBOLO = "₡";

export interface KpiValorAnimadoProps {
  value?: string | number | null;
  /** Formatea como precio (₡ + separadores de miles y hasta 2 decimales). */
  moneda?: boolean;
  className?: string;
}

export function KpiValorAnimado({
  value,
  moneda = false,
  className,
}: Readonly<KpiValorAnimadoProps>) {
  const amount = toValidNumber(value);
  const decimals = moneda ? 2 : 0;

  // es-CR: separador de miles "." y decimal ",". minimumFractionDigits 0 para no
  // forzar ",00" en enteros, igual que PriceLabel.
  const formatear = (n: number) => {
    const formatted = new Intl.NumberFormat("es-CR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    }).format(n);
    return moneda ? `${SIMBOLO} ${formatted}` : formatted;
  };

  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {/* start=0 explícito: el primer render (server e hidratación) muestra "0"
          y la animación sube desde ahí, sin flash del valor final. */}
      <CountUp
        start={0}
        end={amount}
        duration={1.2}
        decimals={decimals}
        formattingFn={formatear}
        preserveValue
      />
    </span>
  );
}
