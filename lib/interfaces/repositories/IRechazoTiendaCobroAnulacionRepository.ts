import type { PrismaClient } from "@prisma/client";

import type { EstadoDocumentoCaja } from "@/lib/interfaces/services/IWalletService";

/**
 * FICHA 458-B (D7, R63–R68, R73) — el contrato de la ANULACION de un cobro por rechazo aprobado
 * (337). SOLO queries: ni rol, ni los contra-asientos (esos los escriben el puerto de caja y el
 * repositorio del libro de la tienda en la MISMA transaccion). UN tipo de historial por metodo (la
 * guardia del censo mide POR METODO): `anular` escribe `cobro_rechazo_tienda_anulado`.
 *
 * Molde: `ICobroTiendaAnulacionRepository` (461) y `pago_por_cuenta_tienda_anulacion` (459). La
 * constancia cuelga del COBRO por FK (`UNIQUE(cobro_id)`, R66/R67); «anulado» se deriva de que
 * exista la fila y `rechazo_tienda_cobro.estado` sigue `aprobado` (R73). No hay metodo de edicion,
 * de borrado ni de «des-anular».
 */
export type RechazoTiendaCobroAnulacionTxClient = Pick<
  PrismaClient,
  | "rechazoTiendaCobroAnulacion"
  | "rechazoTiendaCobro"
  | "walletMovimiento"
  | "walletTiendaMovimiento"
  | "historialAccion"
  | "usuario"
>;

export interface AnularCobroRechazoRepoInput {
  cobroId: string;
  motivo: string;
  anuladoPor: string;
}

/** `ya_anulado` = ya habia constancia (`createMany` con `skipDuplicates` inserto 0): no queda rastro. */
export type AnularCobroRechazoRepoResult = { status: "anulado" } | { status: "ya_anulado" };

/** Una linea ORIGINAL del cobro en un libro: su categoria y su monto (STRING escala 2). */
export interface LineaDelCobro<C extends string> {
  categoria: C;
  monto: string;
}

/**
 * Lo que el cobro aprobado dejo en los dos libros (origen `gestion_orden`, `origen_id` = la gestion):
 * los ingresos de la caja y, si el interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION` estaba encendido al
 * aprobar, los debitos de la tienda. Los contra-asientos se escriben SOLO para las lineas que existen.
 */
export interface LineasDelCobro {
  caja: LineaDelCobro<"ingreso_flete_devolucion" | "ingreso_iva_flete_devolucion">[];
  tienda: LineaDelCobro<"flete_devolucion" | "iva_flete_devolucion">[];
}

/** El estado de anulacion de un cobro, leido en lote por su GESTION (la clave de sus lineas). */
export interface EstadoAnulacionDeCobroRechazo {
  gestionId: string;
  cobroId: string;
  anulacion: { motivo: string; anuladoPorNombre: string | null; createdAt: Date } | null;
}

/** El cobro por rechazo de una gestion, para enrutar una anulacion desde una fila de un libro. */
export interface CobroRechazoDeGestion {
  id: string;
  gestionId: string;
}

export interface IRechazoTiendaCobroAnulacionRepository {
  /** R64 — constancia + `cobro_rechazo_tienda_anulado`, en `tx`. `0` insertadas → `ya_anulado`. */
  anular(tx: RechazoTiendaCobroAnulacionTxClient, input: AnularCobroRechazoRepoInput): Promise<AnularCobroRechazoRepoResult>;
  /** R64/R68 — las lineas ORIGINALES del cobro en los dos libros, leidas dentro de `tx`. */
  lineasDelCobro(
    tx: RechazoTiendaCobroAnulacionTxClient,
    cobro: { gestionId: string; tiendaId: string },
  ): Promise<LineasDelCobro>;
  /** R71/R73 — el estado de anulacion de los cobros de estas gestiones, UNA consulta. */
  estadoPorGestion(gestionIds: readonly string[]): Promise<EstadoAnulacionDeCobroRechazo[]>;
  /** R71 — lector de `LectoresDocumentosCaja.rechazos`: el id es la GESTION. */
  estadoDeDocumentos(gestionIds: readonly string[]): Promise<EstadoDocumentoCaja[]>;
  /** El cobro de una gestion (o `null`), para la accion unica de anular. */
  cobroDeGestion(gestionId: string): Promise<CobroRechazoDeGestion | null>;
}
