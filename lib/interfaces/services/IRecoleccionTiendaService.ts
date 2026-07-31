import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RecolectarEnTiendaResult } from "@/lib/types/recoleccion-tienda";

// Feature 157 — Recoleccion en tienda por el mensajero, contrato del servicio. Logica de negocio
// pura (sin HTTP, sin Prisma); el borde (Server Action) la traduce al resultado tipado expuesto.
// Espejo de `IRecepcionBodegaCentralService` con dos diferencias: el rol autorizado es `mensajero`
// (no acceso total) y hay guardia de PROPIEDAD —solo el mensajero asignado recolecta— ademas de la
// de bloqueo por cierre.

/** Resultado de dominio: el del borde menos `unauthenticated`, que agrega la Server Action (R29). */
export type RecolectarEnTiendaServiceResult = Exclude<
  RecolectarEnTiendaResult,
  { status: "unauthenticated" }
>;

export interface IRecoleccionTiendaService {
  /**
   * Confirma la recoleccion en la tienda de la orden cuyo `num_guia` es el escaneado (el QR
   * codifica `/paquete/<numGuia>`): `por_recolectar_en_tienda -> en_ruta_bodega_central` (#43).
   * Idempotente si ya estaba recolectada (R32). Solo la recolecta el mensajero ASIGNADO a ella;
   * para cualquier otro la orden es indistinguible de una inexistente (R30).
   */
  recolectarEnTienda(
    numGuia: number,
    actor: Actor,
  ): Promise<RecolectarEnTiendaServiceResult>;
}
