import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

/**
 * Feature 56 (F1.4-Q1/Q2) — ingreso de la BODEGA por una gestion. ESPEJO de
 * `pagoPorResultado` (39), pero para el `cobroRechazado` que las gestiones `rechazada`
 * atribuyen a la bodega responsable del mensajero. NUNCA se paga al mensajero (R7b): es
 * un concepto INDEPENDIENTE de `pago_mensajero` (39). Reglas F1.4 aprobadas:
 * - SOLO `rechazada` genera ingreso; `entregada`/`reprogramada`/`devuelta` -> "0.00" (R4).
 * - Para `rechazada`: la condicion de aplicacion (Q1) es que la tarifa resuelta tenga
 *   `cobroRechazado > 0` -> ese monto (R3); si es 0.00 -> "0.00" (R5).
 * - `tarifa === null` (gap de datos, zona sin tarifa capturada) -> "0.00" sin lanzar (R6).
 * REUSA el resolver `resolvePagoTarifa` de la 39 (el `cobroRechazado` ya viaja en su DTO):
 * NO crea resolver nuevo, NO toca `pago-mensajero.ts`. Money-safe: Prisma.Decimal, salida
 * STRING escala 2 (R7). Funcion pura, testeable sin DB/red.
 */
export function ingresoBodegaPorResultado(
  resultado: GestionResultado,
  tarifa: PagoTarifa | null,
): string {
  if (tarifa === null) return "0.00"; // R6: gap seguro, no bloquea
  if (resultado !== "rechazada") return "0.00"; // R4 (Q2: solo rechazada genera ingreso)
  const cobro = new Prisma.Decimal(tarifa.cobroRechazado);
  // R5 (Q1-a): "aplica el pago por rechazo" = cobroRechazado configurado > 0. Si es 0 -> 0.00.
  return cobro.gt(0) ? cobro.toFixed(2) : "0.00"; // R3
}
