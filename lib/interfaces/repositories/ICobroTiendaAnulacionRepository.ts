import type { PrismaClient } from "@prisma/client";

import type { EstadoDocumentoCaja } from "@/lib/interfaces/services/IWalletService";

/**
 * FICHA 461 (design §5.3) — el contrato de la ANULACION de un cobro de Ordenex a una tienda. SOLO
 * queries: ni rol, ni saldo, ni contra-asientos (esos los escribe `CobroTiendaService` en la misma
 * transaccion). UN tipo de historial por metodo (la guardia del censo mide POR METODO): `anular`
 * escribe `cobro_tienda_anulado` en la MISMA transaccion que su fila.
 *
 * No hay metodo de edicion ni de borrado, ni de «des-anular» (R19): la ausencia de superficie es el
 * requisito. El cobro mismo no tiene documento aparte: ES la fila `debito/cobro_manual` del libro de
 * la tienda (381/D2), y la anulacion cuelga de ella por FK.
 */
export type CobroTiendaAnulacionTxClient = Pick<
  PrismaClient,
  "cobroTiendaAnulacion" | "walletTiendaMovimiento" | "historialAccion" | "usuario"
>;

export interface AnularCobroTiendaRepoInput {
  /** El id del DEBITO `cobro_manual` que se anula. */
  cobroId: string;
  motivo: string;
  anuladoPor: string;
}

/** `ya_anulado` = el `UNIQUE(cobro_id)` rechazo la fila: no queda rastro de una anulacion que no ocurrio. */
export type AnularCobroTiendaRepoResult = { status: "anulado" } | { status: "ya_anulado" };

/**
 * R15/R17 — lo que el servicio necesita saber de un cobro ANTES de anularlo, en UNA consulta:
 *  - `anulado`: ya tiene su fila en `cobro_tienda_anulacion`;
 *  - `reclasificado`: la 459 lo reclasifico como pago de un gasto de la tienda (tiene una salida
 *    `cobro_manual_reclasificado`): su dinero nunca fue ganancia y NO se anula por esta via (P12);
 *  - `tieneCargo`: tiene su linea de caja `ingreso_cobro_tienda`, propia (`cobro_tienda`) o
 *    completada por la migracion (`cobro_tienda_completado`). Sin ella no hay reverso que escribir.
 */
export interface EstadoDelCobro {
  anulado: boolean;
  reclasificado: boolean;
  tieneCargo: boolean;
}

export interface ICobroTiendaAnulacionRepository {
  /** Constancia + fila del historial, en `tx`. Choque del UNIQUE(cobro_id) -> `ya_anulado` (R15). */
  anular(tx: CobroTiendaAnulacionTxClient, input: AnularCobroTiendaRepoInput): Promise<AnularCobroTiendaRepoResult>;
  /** R15/R17 — los tres hechos del cobro, en UNA consulta. Fuera de la transaccion. */
  estadoDelCobro(cobroId: string): Promise<EstadoDelCobro>;
  /**
   * R20/R37 — para el libro de la caja: por cada cobro de la pagina, si esta anulado. UNA consulta
   * para todos los ids; lista vacia -> sin consulta. `tieneComprobante` es SIEMPRE `false`: un cobro
   * no lleva comprobante (design §5.4).
   */
  estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]>;
}
