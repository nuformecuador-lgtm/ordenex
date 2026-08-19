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
 * separador de miles y SIN parte decimal (`₡1.234`, `₡0`). UI pura, reutilizable
 * en tablas, tarjetas y detalles.
 *
 * Si el valor no existe o no es un número válido muestra `₡0` —no el marcador de
 * "sin importe"—. Es su contrato desde que existe y sus consumidores dependen de
 * él: en el listado de órdenes, una tienda sin tarifa activa tiene flete cero, no
 * flete desconocido, y el `toValidNumber` de la prop es lo que lo decide. La
 * feature 230 cambia el ASPECTO de ese cero (antes arrastraba su cola decimal),
 * no el contrato.
 *
 * Feature 201: el formato ya no se calcula aquí, sale de `lib/config/moneda.ts`
 * como el del resto de la app. De ahí vienen dos cosas visibles que siguen
 * vigentes:
 *
 * 1. Los miles se agrupan con punto. Antes los ponía `Intl.NumberFormat("es-CR")`,
 *    que agrupa con ESPACIO FINO (`₡1 234`) — el docstring de entonces describía
 *    un formato que no era el que salía por pantalla.
 * 2. El símbolo ya no lleva espacio detrás. El resto de la app no lo pone.
 *
 * Feature 230 (R18): la 201 dejó aquí un tercer punto —«los ceros finales se
 * muestran»— justificado porque, sin ellos, el separador decimal de una columna
 * de dinero quedaba a distinta altura en cada fila y eso es justo lo que el
 * `tabular-nums` intenta evitar. Esa justificación DESAPARECIÓ: ya no hay
 * separador decimal que alinear porque todas las filas son enteras. El
 * `tabular-nums` de abajo se conserva —sigue alineando dígitos y separadores de
 * miles—, pero ya no por esa razón.
 *
 * (Se retiró la prop `maxDecimals`: no la usaba ningún consumidor. La escala del
 * dinero de esta app sigue siendo 2 en la base y en la frontera —R17—; lo único
 * que la 230 cambia es cómo se PINTA.)
 */
export function PriceLabel({ value, className }: PriceLabelProps) {
  const amount = toValidNumber(value);

  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {formatMonto(amount)}
    </span>
  );
}
