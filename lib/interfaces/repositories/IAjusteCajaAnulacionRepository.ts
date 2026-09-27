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

/**
 * FICHA 458-B (D13, R63/R64) — la constancia de la anulacion con motivo de un EGRESO de caja sin
 * documento propio: sueldo, gasto de Ordenex, gasto fijo cobrado o indemnizacion por incidente.
 * `movimientoId` es el del egreso ORIGINAL. Misma tabla que la correccion (la 461 la dejo con FK a
 * `wallet_movimiento(id)` y `UNIQUE(movimiento_id)`), metodo y tipo de historial PROPIOS.
 */
export type AnularEgresoCajaRepoInput = AnularAjusteCajaRepoInput;

/** Una constancia de anulacion leida en lote: quien, cuando y por que. */
export interface ConstanciaDeAnulacion {
  movimientoId: string;
  motivo: string;
  anuladoPor: string;
  anuladoPorNombre: string | null;
  createdAt: Date;
}

export interface IAjusteCajaAnulacionRepository {
  /** Constancia + fila del historial, en `tx`. Choque del UNIQUE(movimiento_id) -> `ya_anulado` (R70). */
  anular(tx: AjusteCajaAnulacionTxClient, input: AnularAjusteCajaRepoInput): Promise<AnularAjusteCajaRepoResult>;
  /**
   * FICHA 458-B (R64/R66/R67) — constancia + `egreso_caja_anulado`, en `tx`. La constancia va con
   * `createMany({ skipDuplicates })`: `count = 0` ES «ya estaba anulado» (no se interpreta un P2002)
   * y en ese caso NO se escribe historial. Dos anulaciones a la vez: la segunda espera en el indice
   * UNIQUE y, tras el commit de la primera, inserta 0 filas.
   */
  anularEgreso(tx: AjusteCajaAnulacionTxClient, input: AnularEgresoCajaRepoInput): Promise<AnularAjusteCajaRepoResult>;
  /** FICHA 458-B (R25/R71/R72) — las constancias de estos movimientos, UNA consulta; lista vacia -> sin consulta. */
  constanciasDe(movimientoIds: readonly string[]): Promise<ConstanciaDeAnulacion[]>;
  /**
   * R71 — para el libro de la caja: por cada correccion de la pagina, si esta anulada. UNA consulta
   * para todos los ids; lista vacia -> sin consulta. `tieneComprobante` es SIEMPRE `false`: una
   * correccion no lleva comprobante.
   */
  estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]>;
}
