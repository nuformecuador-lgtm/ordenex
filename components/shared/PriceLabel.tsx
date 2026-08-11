import { formatMonto } from "@/lib/config/moneda";
import { cn } from "@/lib/utils";
import { toValidNumber } from "@/lib/utils/number";

export interface PriceLabelProps {
  /**
   * Valor a mostrar. El contrato pide un string, pero se aceptan también number
   * y null/undefined para poder consumir directamente valores numéricos (p. ej.
   * las tarifas del listado) sin castear en cada uso.
   */
  value?: string | number | null;
  className?: string;
}

/**
 * Etiqueta de precio: el valor con el símbolo de la moneda pegado delante,
 * separador de miles y SIEMPRE dos decimales (`₡1.234,50`, `₡0,00`). UI pura,
 * reutilizable en tablas, tarjetas y detalles.
 *
 * Si el valor no existe o no es un número válido muestra `₡0,00` —no el marcador
 * de "sin importe"—. Es su contrato desde que existe y sus consumidores dependen
 * de él: en el listado de órdenes, una tienda sin tarifa activa tiene flete cero,
 * no flete desconocido, y el `toValidNumber` de la prop es lo que lo decide.
 *
 * Feature 201: el formato ya no se calcula aquí, sale de `lib/config/moneda.ts`
 * como el del resto de la app. Cambian TRES cosas visibles, las tres a propósito:
 *
 * 1. Los miles se agrupan con punto. Antes los ponía `Intl.NumberFormat("es-CR")`,
 *    que agrupa con ESPACIO FINO (`₡1 234,5`) — el docstring anterior prometía
 *    `₡1.234,50` y no era lo que salía por pantalla.
 * 2. El símbolo ya no lleva espacio detrás. El resto de la app no lo pone.
 * 3. Los ceros finales se muestran. Antes `minimumFractionDigits: 0` los comía
 *    (`₡0`, `₡1.234,5`) y una columna de dinero quedaba con la coma a distinta
 *    altura en cada fila, que es justo lo que el `tabular-nums` intenta evitar.
 *
 * (Se retiró la prop `maxDecimals`: no la usaba ningún consumidor y la escala del
 * dinero de esta app es 2, la misma con la que el importe cruza la frontera.)
 */
export function PriceLabel({ value, className }: PriceLabelProps) {
  const amount = toValidNumber(value);

  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {formatMonto(amount)}
    </span>
  );
}
