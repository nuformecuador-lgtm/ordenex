import type { PrismaClient } from "@prisma/client";

import type { EstadoDocumentoCaja } from "@/lib/interfaces/services/IWalletService";

/**
 * FICHA 461 (R69–R71, auditoria de la wallet D3) — el contrato de la ANULACION de una CORRECCION
 * de caja (`ingreso_ajuste` / `egreso_ajuste` con origen `manual`). SOLO queries: ni rol, ni el
 * contra-asiento (ese lo escribe `AjusteCajaService` en la misma transaccion). UN tipo de historial
 * por metodo (la guardia del censo mide POR METODO): `anular` escribe
 * `wallet_movimiento_manual_anulado` en la MISMA transaccion que su fila.
 *
 * Molde: `ICobroTiendaAnulacionRepository`. La correccion no tiene documento aparte: ES la fila del
 * libro de la caja, y la anulacion cuelga de ella por FK (`UNIQUE(movimiento_id)`, R70). No hay
 * metodo de edicion, de borrado ni de «des-anular».
 */
export type AjusteCajaAnulacionTxClient = Pick<
  PrismaClient,
  "ajusteCajaAnulacion" | "walletMovimiento" | "historialAccion" | "usuario"
>;

export interface AnularAjusteCajaRepoInput {
  /** El id de la CORRECCION (`ingreso_ajuste`/`egreso_ajuste`, origen `manual`) que se anula. */
  movimientoId: string;
  motivo: string;
  anuladoPor: string;
}

/** `ya_anulado` = el `UNIQUE(movimiento_id)` rechazo la fila: no queda rastro de una anulacion que no ocurrio. */
export type AnularAjusteCajaRepoResult = { status: "anulado" } | { status: "ya_anulado" };

export interface IAjusteCajaAnulacionRepository {
  /** Constancia + fila del historial, en `tx`. Choque del UNIQUE(movimiento_id) -> `ya_anulado` (R70). */
  anular(tx: AjusteCajaAnulacionTxClient, input: AnularAjusteCajaRepoInput): Promise<AnularAjusteCajaRepoResult>;
  /**
   * R71 — para el libro de la caja: por cada correccion de la pagina, si esta anulada. UNA consulta
   * para todos los ids; lista vacia -> sin consulta. `tieneComprobante` es SIEMPRE `false`: una
   * correccion no lleva comprobante.
   */
  estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]>;
}
