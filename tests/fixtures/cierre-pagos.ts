import type { MetodoPagoValue } from "@prisma/client";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";

/**
 * Feature 208 (T9) — constructor de fixtures para el DESGLOSE del recaudo.
 *
 * `CierreGestionPendienteRow.pagos` es OBLIGATORIO y sin fallback (design §3.1): el precio de
 * esa decisión son ≈15 archivos de test que construyen la fila. Este helper lo paga UNA vez.
 *
 * La regla de coherencia es la MISMA que el backfill de la migración (R6/R7): una gestión con
 * `montoRecibido > 0` y `metodoPago` no nulo tiene UNA línea con ese par; cualquier otra cosa
 * (sin monto, monto cero, sin método) tiene CERO líneas. Así, un fixture que no diga nada del
 * desglose reproduce EXACTAMENTE el modelo escalar que había antes de esta feature, y las
 * aserciones previas de totales siguen valiendo al centavo (R27) sin tocarlas.
 *
 * Los fixtures que quieran un cobro MIXTO pasan sus líneas explícitas.
 */

export type LineaPagoFixture = CierreGestionPendienteRow["pagos"][number];

/** `true` si el STRING monetario vale cero, sin pasar por coma flotante. */
function esCero(monto: string): boolean {
  return /^\s*-?0*(\.0*)?\s*$/.test(monto);
}

/**
 * Las líneas que el backfill (R6/R7) habría creado para el par escalar de una gestión:
 * una sola con `(metodoPago, montoRecibido)`, o ninguna si falta el método, falta el monto o
 * el monto es cero (la «entrega sin cobro» que hoy el panel disfraza de `efectivo`, R14).
 */
export function pagosDesdeEscalar(
  montoRecibido: string | null,
  metodoPago: MetodoPagoValue | null,
): LineaPagoFixture[] {
  if (montoRecibido === null || metodoPago === null || esCero(montoRecibido)) return [];
  return [{ metodo: metodoPago, monto: montoRecibido }];
}

/**
 * Completa una fila de fixture con su desglose: el explícito si el test lo dio, y si no el
 * derivado del par escalar. Pensado para usarse DESPUÉS de aplicar los `overrides`, para que
 * un `montoRecibido`/`metodoPago` sobreescrito arrastre su desglose.
 */
export function conPagos(
  fila: Omit<CierreGestionPendienteRow, "pagos">,
  pagos?: LineaPagoFixture[],
): CierreGestionPendienteRow {
  return { ...fila, pagos: pagos ?? pagosDesdeEscalar(fila.montoRecibido, fila.metodoPago) };
}
