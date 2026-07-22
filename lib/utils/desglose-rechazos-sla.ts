import { Prisma } from "@prisma/client";

// Feature 102 (T4, design §4.2) — DESGLOSE money-safe del "ingreso de bodega por rechazos" de un
// cierre, particionado por ORIGEN (SLA vs manual) a partir de los montos por gestion YA
// snapshoteados (56) y la clasificacion `esRechazoSla` (derivada del historial inmutable, 99).
// PURO y testeable sin DB. Money-safe (R4/R5/R18): suma con `Prisma.Decimal` (NUNCA
// parseFloat/Number), salida STRING de dos decimales. La feature es SOLO LECTURA: no crea ni
// pierde dinero, solo reparte lo ya congelado.

// Fila minima que consume el desglose: el monto snapshoteado (STRING, `null` = pendiente de
// cierre / cierre pre-migracion) + su clasificacion.
export interface GestionDesgloseRechazo {
  ingresoBodegaRechazo: string | null;
  esRechazoSla: boolean;
}

/**
 * R4/R5 — parte el ingreso de bodega por rechazos en subtotal SLA (gestiones con
 * `esRechazoSla = true`) y subtotal manual (el resto). `ingresoBodegaRechazo = null` no aporta
 * (aun sin snapshot). Por construccion `totalSla + totalManual === total` (R5): la particion no
 * inventa ni pierde centavos. `total` NO es el snapshot del cierre — el service que lo consume
 * asegura la identidad contra `cierre.totalIngresoBodegaRechazos` sin recomputar ese snapshot (R6).
 */
export function desglosarIngresoBodegaPorOrigen(
  gestiones: readonly GestionDesgloseRechazo[],
): { totalSla: string; totalManual: string; total: string } {
  let sla = new Prisma.Decimal(0);
  let manual = new Prisma.Decimal(0);
  for (const g of gestiones) {
    if (g.ingresoBodegaRechazo === null) continue; // pendiente de cierre: aun no aporta
    const monto = new Prisma.Decimal(g.ingresoBodegaRechazo);
    if (g.esRechazoSla) sla = sla.plus(monto);
    else manual = manual.plus(monto);
  }
  return {
    totalSla: sla.toFixed(2),
    totalManual: manual.toFixed(2),
    total: sla.plus(manual).toFixed(2),
  };
}
