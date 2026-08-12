import type { Prisma, MetodoPagoValue } from "@prisma/client";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";

/**
 * Feature 208 (T10, R21/R22) — serializador del DESGLOSE del recaudo, de la proyeccion Prisma
 * a la fila de dominio.
 *
 * Vive aparte porque lo usan las DOS proyecciones que producen la fila (`WITH_DETALLE` de la
 * vista en vivo del mensajero y `GESTION_ADMIN_SELECT`, que alimenta los detalles de admin Y de
 * bodega): dos copias serian dos oportunidades de serializar con otra escala en un camino
 * money-critical, que es justo lo que aqui no puede pasar.
 *
 * Money-safe: `Decimal -> STRING` de escala 2 FIJA, nunca `number`/`parseFloat`. El ORDEN no se
 * toca aqui: lo fija el `orderBy: { metodo: "asc" }` de la consulta, que sobre un enum nativo es
 * el orden de DECLARACION (`efectivo`, `SINPE`, `transferencia`).
 */
export function toLineasPago(
  pagos: { metodo: MetodoPagoValue; monto: Prisma.Decimal }[],
): CierreGestionPendienteRow["pagos"] {
  return pagos.map((p) => ({ metodo: p.metodo, monto: p.monto.toFixed(2) }));
}
