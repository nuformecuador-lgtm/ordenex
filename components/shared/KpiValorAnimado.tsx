"use client";

import { useCallback } from "react";
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
// obligaba a editar un componente compartido. El formato resultante es el de
// `formatMonto`, el mismo que ya usan los otros cinco consumidores cliente. Fue
// el de `Intl` con `style: "currency"` («₡3 500,00», con espacio duro) hasta que
// la feature 201 unifico la agrupacion en `lib/config/moneda.ts` («₡3.500,00»).
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

  // MEMOIZADA A PROPÓSITO: react-countup reinicia la animación desde `start` en un
  // efecto que depende de la IDENTIDAD de `formattingFn`. Si se recreara en cada
  // render, cualquier re-render del padre (abrir el detalle de un cierre, por
  // ejemplo) relanzaría el conteo desde 0. `moneda` es el único valor reactivo que
  // la función lee (`formatMonto` y `monedaConfig` son de módulo), así que el
  // formato sigue correcto.
  const formatear = useCallback(
    (n: number) =>
      moneda
        ? formatMonto(n)
        : new Intl.NumberFormat(monedaConfig.locale, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(n),
    [moneda],
  );

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
