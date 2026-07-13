import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

/**
 * Feature 39 (F1.4) — pago al MENSAJERO por una gestion. R5-R8/R7b: SOLO `entregada`
 * paga (`cobroEntregado`); cualquier otro resultado (`rechazada`/`reprogramada`/
 * `devuelta`) -> "0.00". `tarifa === null` (gap de datos, zona sin tarifa) -> "0.00" sin
 * bloquear (R8). El `cobroRechazado` NUNCA se paga al mensajero: es un ingreso de bodega
 * modelado en la feature 56 (fuera del alcance de la 39). Money-safe: Prisma.Decimal,
 * salida STRING escala 2 (R9). Funcion pura, testeable sin DB/red.
 */
export function pagoPorResultado(
  resultado: GestionResultado,
  tarifa: PagoTarifa | null,
): string {
  if (tarifa === null) return "0.00"; // R8: gap seguro, no bloquea
  if (resultado === "entregada") {
    // R5: unico caso que paga; usa cobroEntregado, NUNCA cobroRechazado.
    return new Prisma.Decimal(tarifa.cobroEntregado).toFixed(2);
  }
  return "0.00"; // R6/R7/R7b: rechazada/reprogramada/devuelta no pagan al mensajero
}
