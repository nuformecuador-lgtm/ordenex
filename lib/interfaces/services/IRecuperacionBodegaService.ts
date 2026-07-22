import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 100 (design §3.2) — contrato del servicio de RECUPERACION a bodega: la bodega
// RESPONSABLE de la zona de una orden que REPOSA en `devuelta` (novedad) la recupera a bodega
// (nuevo intento), sacandola de `devuelta` ANTES de que venza su ventana SLA (feature 99) y
// dejandola ASIGNABLE de nuevo. Metodo hermano de `liberarDevueltaSla` (99) pero con actor = el
// admin que ejecuta y `origen_tipo = recuperacion_manual` (gate F1.4-Q2). Logica de negocio pura
// (sin HTTP ni Prisma); el borde (Server Action) la traduce a resultado tipado. Solo el
// administrador de la bodega responsable de la orden (maestro/admin en la central, adminSatelite
// de la zona), patron `DevolucionOrigenService.esBodegaResponsable` (feature 48).

// Maquina de resultados de dominio (patron DevolverATiendaResult). Todos los rechazos son SIN
// efectos en datos. `ok` transiciona `devuelta` -> `en_bodega`/`en_bodega_satelite`. `conflict` =
// la orden ya no esta en `devuelta` (el cron SLA la movio, o doble submit): idempotente, sin
// efectos (R16). `forbidden` = el actor no es la bodega responsable (R15). `config_error` =
// catalogo sin el destino de bodega. `not_found` = orden inexistente o borrada.
export type RecuperarABodegaResult =
  | { status: "ok" } // R13/R14 (transiciono a bodega, limpio mensajero)
  | { status: "forbidden" } // R15 (no es la bodega responsable)
  | { status: "not_found" } // orden inexistente o borrada
  | { status: "conflict"; motivo: string } // R16 (ya salio de `devuelta`)
  | { status: "config_error" }; // catalogo sin el destino de bodega

export interface IRecuperacionBodegaService {
  /**
   * R13/R14/R15/R16/R17: recupera una orden en `devuelta` a bodega. Ruteo a `en_bodega` (zona
   * central) o `en_bodega_satelite` (satelite) con la MISMA regla de zona del cron
   * (`resolverDestinoCierre` + `findCentralZonaId`). Autoriza SOLO a la bodega responsable
   * (maestro/admin en la central; `adminSatelite` cuya zona coincide con la de la orden).
   * Guardia de estado (solo desde `devuelta`; otro estado -> `conflict`, R16). Persiste la
   * transicion + limpieza de mensajero (`mensajero_asignado_id`/`asignado_at`) via el choke
   * point de la feature 49, en la MISMA tx, guardada por `estatus_id = devuelta` (R21). NO enciende
   * `orden.prioridad` (R19: la columna no existe; feature 101).
   */
  recuperar(ordenId: string, actor: Actor): Promise<RecuperarABodegaResult>;
}
