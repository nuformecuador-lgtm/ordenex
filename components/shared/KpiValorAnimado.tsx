"use client";

import CountUp from "react-countup";

import { formatMonto, monedaConfig } from "@/lib/config/moneda";
import { cn } from "@/lib/utils";
import { toValidNumber } from "@/lib/utils/number";

// Valor numérico de un KPI, animado de 0 al valor final con react-countup. Es
// client component (la animación necesita el navegador); el KPI en sí sigue
// siendo server-compatible y solo monta esta hoja. Nació en el portal del
// mensajero (feature 61) y vive acá desde que también lo usan los cierres.

// La moneda (símbolo, código y locale) NO se escribe aquí: se resuelve por
// configuración en `lib/config/moneda.ts`, como pide `docs/architecture.md`
// («sin hardcode de contexto»). Hasta la feature 130 este archivo tenía un
// `const SIMBOLO = "₡"` y un `"es-CR"` incrustados, así que cambiar de país
// obligaba a editar un componente compartido. El formato resultante pasa a ser
// el de `Intl` con `style: "currency"` («₡3 500,00»), el mismo que ya usan los
// otros cinco consumidores cliente de `formatMonto`.
//
// Lo que este arreglo NO resuelve, y es PREEXISTENTE (no lo introduce la 130):
// `loadMonedaConfig` lee `process.env[name]` con clave dinámica, y Next solo
// inlinea `NEXT_PUBLIC_*` con acceso estático, así que en el navegador la
// configuración cae a su default `es-CR`/`CRC`. Ya les pasa a `EtiquetaGuia`,
// `ChatConversacion`, `PosOrderCardDetalle`, `PosOrderCardMosaico` y
// `SateliteOrderCard`; este KPI es el sexto, no el primero. Hacerla configurable
// en cliente es una ficha propia sobre `lib/config/moneda.ts`.

export interface KpiValorAnimadoProps {
  value?: string | number | null;
  /** Formatea como monto con la moneda configurada (`lib/config/moneda.ts`). */
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

  const formatear = (n: number) =>
    moneda
      ? formatMonto(n)
      : new Intl.NumberFormat(monedaConfig.locale, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(n);

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
