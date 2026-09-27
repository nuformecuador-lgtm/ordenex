// Feature 29 — nombre visible del estatus de una orden (R17, design D5).
//
// FICHA 455 (2026-09-24, design DA/§2.1; R2/R3/R10/R11): `estatusLabel` ES `nombreDeEstado`, la
// fuente única de `lib/types/order-status.ts`. Antes tenía su propio mapa y un fallback que devolvía
// el CÓDIGO crudo ante un valor desconocido (viola R3): ahora un desconocido se lee «Estado no
// reconocido» (R10) y un retirado «<histórico> (estado retirado)» (R11). `null`/vacío → «—».
import type { GestionResultado } from "@prisma/client";

import { nombreDeResultado, SENAL_PENDIENTE } from "@/lib/types/gestion-resultado";
import { nombreDeEstado } from "@/lib/types/order-status";

/** El nombre visible de un código de estado (R2): reexportación de `nombreDeEstado`. */
export const estatusLabel: (value: string | null | undefined) => string = nombreDeEstado;

/**
 * FICHA 454 (R29/R30) / 455 (R4) — nombre visible de un RESULTADO de gestión: el de su estado
 * homónimo (`nombreDeResultado`).
 */
export function resultadoLabel(resultado: GestionResultado): string {
  return nombreDeResultado(resultado);
}

/** FICHA 454 (R29) / 455 (R33) — «<Resultado> · pendiente de confirmación». */
export function notaGestionPendiente(resultado: GestionResultado): string {
  return SENAL_PENDIENTE(resultado);
}
