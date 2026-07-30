import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import type { OrderStatusValue } from "@/lib/types/order-status";

/**
 * Feature 158 (T2.7, R41) — estados de una orden desde los que un admin PUEDE reportar un
 * incidente, para decidir si la acción de fila se ofrece.
 *
 * NO es una lista literal: se DERIVA del mapa de la 140, que ya es la fuente única de verdad
 * de las transiciones legales. Se leen las SALIDAS de `incidente` de familia `incidente`, que
 * son las cinco reversiones #54-#58 — y el conjunto de destinos de la reversión es, por
 * diseño, el MISMO conjunto de orígenes del reporte (#48-#52): el propio service lo usa para
 * las dos direcciones (`ORIGENES_INCIDENTE_ADMIN`, `lib/services/IncidenteAdminService.ts`).
 * La sexta salida (#53, `incidente → en_reparto`) queda fuera porque su familia es
 * `deshacer_gestion`: es el deshacer del MENSAJERO, no una reversión del camino del admin.
 *
 * Por qué derivar y no copiar la constante del service: el service importa `@prisma/client`,
 * así que un componente cliente no puede importarlo sin arrastrar Prisma al bundle. Y por qué
 * no teclear los cinco values a mano: una lista paralela se desincroniza en silencio.
 * `tests/components/ReportarIncidenteAccion.test.tsx` fija por IGUALDAD que este conjunto es
 * exactamente el del servidor; si divergen, se pone rojo.
 */
export const ESTADOS_REPORTABLES_INCIDENTE: readonly OrderStatusValue[] =
  TRANSICIONES.incidente
    .filter((destino) => destino.via === "incidente")
    .map((destino) => destino.to);

const SET_REPORTABLES: ReadonlySet<string> = new Set(ESTADOS_REPORTABLES_INCIDENTE);

/**
 * ¿El estado ACTUAL de la orden admite un reporte de incidente del admin? Un `undefined`
 * (DTO sin `estatusValue`) responde `false`: no se puede AFIRMAR que sea reportable, y el
 * servidor rechazaría igual. Degradación segura, misma dirección que `accionesDe`.
 */
export function esEstadoReportable(estatusValue: string | undefined | null): boolean {
  return typeof estatusValue === "string" && SET_REPORTABLES.has(estatusValue);
}
