// FICHA 455 (2026-09-24, design §1.2; R4, R33) — el resultado de una gestion se llama IGUAL que su
// estado destino: mismo codigo (`gestion_resultado` se renombro en paralelo, design DC) y mismo nombre
// visible. Este modulo no declara nombres: los lee de `NOMBRE_ESTADO`, la fuente unica.
//
// MODULO PURO: solo el `type` del enum de Prisma (borrado al compilar), sin servicios ni `next/*`.
import type { GestionResultado } from "@prisma/client";

import { textoPendienteConfirmacion } from "@/components/shared/nota-pendiente-confirmacion";
import { NOMBRE_ESTADO, type OrderStatusValue } from "@/lib/types/order-status";

/**
 * Asercion de tipo (compila o no): todo resultado de gestion ES un codigo de estado vigente. Si el
 * enum gana un valor que no existe en el catalogo, esto deja de compilar.
 */
type ResultadoEsEstado = GestionResultado extends OrderStatusValue ? true : never;
export const RESULTADO_ES_ESTADO: ResultadoEsEstado = true;

/** R4 — el nombre visible de un resultado: el de su estado homonimo (§0.2 del spec). */
export function nombreDeResultado(resultado: GestionResultado): string {
  return NOMBRE_ESTADO[resultado];
}

/**
 * R33 — la señal de una gestion pendiente de confirmar (454): «<nombre del resultado> · pendiente de
 * confirmación». El formato (punto medio) vive en `nota-pendiente-confirmacion.ts`; aqui solo se le
 * pasa el nombre canonico, para que todas las superficies digan exactamente lo mismo.
 */
export function SENAL_PENDIENTE(resultado: GestionResultado): string {
  return textoPendienteConfirmacion(nombreDeResultado(resultado));
}
