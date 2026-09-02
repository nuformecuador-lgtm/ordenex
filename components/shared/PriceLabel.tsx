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
 * separador de miles y la cola SOLO CUANDO EXISTE (`₡1.234`, `₡0`, `₡416,47`).
 * UI pura, reutilizable en tablas, tarjetas y detalles.
 *
 * Si el valor no existe o no es un número válido muestra `₡0` —no el marcador de
 * "sin importe"—. Es su contrato desde que existe y sus consumidores dependen de
 * él: en el listado de órdenes, una tienda sin tarifa activa tiene flete cero, no
 * flete desconocido, y el `toValidNumber` de la prop es lo que lo decide. Ni la
 * 230 ni la 359 cambian ese contrato: solo el ASPECTO de las cifras.
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
 * Sobre el `tabular-nums` de abajo, que ha sobrevivido a tres reglas de formato
 * seguidas: la 201 lo justificaba porque los ceros finales alineaban la coma de
 * una columna de dinero; la 230 retiró esa justificación al dejar todas las
 * filas enteras y lo conservó por los separadores de miles; con la ficha 359 la
 * columna vuelve a mezclar filas con cola y sin ella, así que el ancho fijo de
 * dígito vuelve a hacer el trabajo que la 201 le pedía. Se queda, y ahora otra
 * vez por su motivo original.
 *
 * (Se retiró la prop `maxDecimals`: no la usaba ningún consumidor. La escala del
 * dinero de esta app sigue siendo 2 en la base y en la frontera —R17—, y desde
 * la 359 es también la escala que se PINTA.)
 */
export function PriceLabel({ value, className }: PriceLabelProps) {
  const amount = toValidNumber(value);

  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {formatMonto(amount)}
    </span>
  );
}
