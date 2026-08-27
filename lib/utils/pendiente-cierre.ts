import { Prisma } from "@prisma/client";
import { calcularSplitPago } from "@/lib/utils/cuenta-por-pagar";

/**
 * Feature 172 (design §5, R22/R24/R80) — DERIVA lo que de UN cierre sigue sin entregarse al
 * mensajero. Funcion PURA, money-safe: `Prisma.Decimal` en todo el calculo y STRING de escala
 * 2 en la salida. Cero coma flotante: no hay conversion a numero en ningun punto, y un test
 * lo afirma leyendo este mismo archivo.
 *
 * **Feature 293 (design §5, R24/R25/R26) — LO PAGABLE DE UN CIERRE GANA UN TERMINO:**
 *
 *     pendienteDelCierre = calcularSplitPago(P, E).pendiente + premiosVivos − Σ pagos VIGENTES
 *
 * `P` es `cierre_dia.total_pago_mensajero` (snapshot de la 39) y `E` es
 * `cierre_dia.total_efectivo` (snapshot de la 37). **Ninguno de los dos se reescribe jamas**
 * (293/R13): el snapshot sigue diciendo lo que dijo el dia en que se aprobo el cierre, y el
 * premio entra como un termino APARTE, derivado de filas propias del libro.
 *
 * La regla `min(P, E)` NO se reimplementa aqui: se reutiliza `calcularSplitPago` (feature 44),
 * que es su fuente UNICA. Si algun dia esa regla cambiara, cambia en un solo sitio.
 *
 * **`premiosVivos` se suma FUERA de `calcularSplitPago`, y es la linea que no se puede cruzar**
 * (293/R25, alternativa D de su §11). Meterlo dentro —`P + premio` contra `E`— daria el premio
 * por ENTREGADO cada vez que el efectivo del dia sobrara, y ese efectivo NUNCA contuvo el
 * premio; ademas cambiaria, a posteriori, el `min(P,E)` que el feed ya escribio al aprobar.
 *
 * **`pagadoVigente` son SOLO los pagos vigentes (172/R80).** Un pago anulado no entra en esa
 * suma —quien la calcula excluye los que tienen fila en `liquidacion_anulacion`—, y eso es
 * exactamente lo que hace que su monto vuelva a estar adeudado (R79) sin ningun recalculo
 * especial. Simetricamente, `premiosVivos` ya viene NETO de las compensaciones de anulacion
 * (293/§5), asi que anular un premio baja lo pagable por la misma via y sin caso especial.
 *
 * **PARAMETRO POR OBJETO, y no es estilo** (293/design §5.2). Los cuatro campos son montos del
 * mismo tipo: en posicional, un orden equivocado COMPILA y descuadra en silencio. Con campos
 * nombrados, no. Y como el objeto es obligatorio, cada consumidor deja de compilar hasta que
 * decida que hace con el premio: el barrido de los consumidores lo impone el compilador, no la
 * memoria de nadie.
 *
 * Nunca devuelve un negativo: el tope lo impone el servicio antes de escribir ([P1], R25), pero
 * si un dato historico dejara la resta por debajo de cero, lo correcto que puede decir esta
 * funcion es que no queda nada pendiente, no una deuda al reves.
 */
export interface PendienteCierreInput {
  /** `P` — `cierre_dia.total_pago_mensajero`, el snapshot de la 39. Nunca se reescribe (R13). */
  pagoDebido: string | Prisma.Decimal;
  /** `E` — `cierre_dia.total_efectivo`, el snapshot de la 37. */
  efectivo: string | Prisma.Decimal;
  /**
   * 293/R24 — Σ de los premios VIVOS imputados a ESTE cierre: Σ `premio_ranking` menos Σ de sus
   * compensaciones (`ajuste_pago` con `premio_dia`). Lo calcula
   * `IPagoMensajeroMovimientoRepository.sumarPremiosVivosPorCierre` con UNA consulta por
   * listado. Sin premios es `"0.00"` y esta funcion devuelve exactamente lo que devolvia antes.
   */
  premiosVivos: string | Prisma.Decimal;
  /** 172/R80 — Σ de los pagos VIGENTES registrados contra este cierre (los anulados no entran). */
  pagadoVigente: string | Prisma.Decimal;
}

export function derivarPendienteCierre({
  pagoDebido,
  efectivo,
  premiosVivos,
  pagadoVigente,
}: PendienteCierreInput): string {
  const generadoPorElCierre = new Prisma.Decimal(calcularSplitPago(pagoDebido, efectivo).pendiente);
  // R25: el premio se SUMA aparte, despues del `min(P, E)` y sin tocarlo.
  const premio = new Prisma.Decimal(premiosVivos).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  const yaEntregado = new Prisma.Decimal(pagadoVigente).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  const pendiente = generadoPorElCierre.add(premio).sub(yaEntregado);
  return pendiente.gt(0) ? pendiente.toFixed(2) : "0.00";
}
