import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ListarRecoleccionResult,
  RecolectarEnTiendaResult,
} from "@/lib/types/recoleccion-tienda";

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

/**
 * Feature 167 — resultado de dominio de la LECTURA del apartado: el del borde menos
 * `unauthenticated`, que agrega la Server Action (mismo molde que el de la confirmacion).
 */
export type ListarRecoleccionServiceResult = Exclude<
  ListarRecoleccionResult,
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

  /**
   * Feature 167 (R21/R24/R25/R27/R31/R38) — los datos del apartado propio de recoleccion:
   *   - `porRecolectar`: las ordenes del PROPIO actor en el estado de recoleccion asignada
   *     (`recolectando`), en un DTO sin cobro ni ruta (R38);
   *   - `recolectadasHoy`: lo que el PROPIO actor recolecto en el dia natural de Costa Rica,
   *     derivado del HISTORIAL (familia `recoleccion_tienda`) y NO del estado actual, de modo
   *     que una orden ya recibida en la central sigue figurando (R26);
   *   - `recolectadasHoyRecortada`: hay mas recolecciones hoy de las que se devuelven (R31).
   *
   * Misma guardia de rol que `recolectarEnTienda`: solo `mensajero`. El bloqueo por cierre
   * pendiente NO se calcula aqui — la pagina lo obtiene de `estadoBloqueoMensajero()`, igual que
   * `/mis-asignaciones`: una sola derivacion del bloqueo en todo el portal.
   */
  listarRecoleccion(actor: Actor): Promise<ListarRecoleccionServiceResult>;
}
