import { Prisma } from "@prisma/client";
import { calcularSplitPago } from "@/lib/utils/cuenta-por-pagar";

/**
 * Feature 172 (design §5, R22/R24/R80) — DERIVA lo que de UN cierre sigue sin entregarse al
 * mensajero. Funcion PURA, money-safe: `Prisma.Decimal` en todo el calculo y STRING de escala
 * 2 en la salida. Cero coma flotante: no hay conversion a numero en ningun punto, y un test
 * lo afirma leyendo este mismo archivo.
 *
 *     pendienteDelCierre = calcularSplitPago(P, E).pendiente − Σ pagos VIGENTES del cierre
 *
 * `P` es `cierre_dia.total_pago_mensajero` (snapshot de la 39) y `E` es
 * `cierre_dia.total_efectivo` (snapshot de la 37), asi que no hace falta tocar el libro para
 * saber cuanto falta: basta la fila del cierre y una agregacion sobre `liquidacion_pago`.
 *
 * La regla `min(P, E)` NO se reimplementa aqui: se reutiliza `calcularSplitPago` (feature 44),
 * que es su fuente UNICA. Si algun dia esa regla cambiara, cambia en un solo sitio.
 *
 * **`pagadoVigente` son SOLO los pagos vigentes (R80).** Un pago anulado no entra en esa suma
 * —quien la calcula excluye los que tienen fila en `liquidacion_anulacion`—, y eso es
 * exactamente lo que hace que su monto vuelva a estar adeudado (R79) sin ningun recalculo
 * especial.
 *
 * Nunca devuelve un negativo: el tope lo impone el servicio antes de escribir ([P1], R25), pero
 * si un dato historico dejara la resta por debajo de cero, lo correcto que puede decir esta
 * funcion es que no queda nada pendiente, no una deuda al reves.
 */
export function derivarPendienteCierre(
  pagoDebido: string | Prisma.Decimal,
  efectivo: string | Prisma.Decimal,
  pagadoVigente: string | Prisma.Decimal,
): string {
  const generadoPorElCierre = new Prisma.Decimal(calcularSplitPago(pagoDebido, efectivo).pendiente);
  const yaEntregado = new Prisma.Decimal(pagadoVigente).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  const pendiente = generadoPorElCierre.sub(yaEntregado);
  return pendiente.gt(0) ? pendiente.toFixed(2) : "0.00";
}
