import type { ConteoPorMensajero } from "@/lib/types/ranking";

// Feature 76 (design §3) — contrato del repositorio de agregacion del ranking DIARIO. SOLO
// queries Prisma; sin logica de negocio. El rango del dia (CR) lo calcula el SERVICE y lo
// pasa como `desde`/`hasta` para que el repo NO dependa de `Date.now()` (testeable). El
// filtro es half-open: `asignado_at`/`created_at` en [desde, hasta).

export interface IRankingRepository {
  /**
   * R1: numerador = entregas exitosas HOY(CR) por mensajero. Cuenta gestiones
   * `resultado = entregada`, VIGENTES (`anulada_at IS NULL`, feature 67) y con
   * `created_at ∈ [desde, hasta)`, agrupadas por `mensajeroId` (quien ACTUO la entrega).
   */
  contarEntregadasPorMensajero(desde: Date, hasta: Date): Promise<ConteoPorMensajero[]>;
  /**
   * R1: denominador = ordenes ASIGNADAS HOY(CR) por mensajero. Cuenta ordenes con
   * `mensajero_asignado_id` no nulo y `asignado_at ∈ [desde, hasta)`, agrupadas por
   * `mensajeroAsignadoId` (el mensajero ACTUALMENTE asignado).
   */
  contarAsignadasPorMensajero(desde: Date, hasta: Date): Promise<ConteoPorMensajero[]>;
}
