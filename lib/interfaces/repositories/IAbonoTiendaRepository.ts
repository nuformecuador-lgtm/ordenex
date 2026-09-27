import type { PrismaClient } from "@prisma/client";

import type { MetodoLiquidacion } from "@/lib/types/liquidacion";

/**
 * FICHA 457 (design §6.2) — el contrato del DOCUMENTO del pago de una tienda a Ordenex. SOLO queries:
 * ni rol, ni saldo, ni validacion de la tienda. Un tipo de historial por metodo (la guardia del censo
 * mide POR METODO): `crear` escribe `abono_tienda_registrado` y `anular`, `abono_tienda_anulado`, cada
 * uno en la MISMA transaccion que su fila (R61/R62).
 *
 * No hay metodo de edicion ni de borrado (R40): la ausencia de superficie es el requisito.
 */
export type AbonoTiendaTxClient = Pick<
  PrismaClient,
  "abonoTienda" | "abonoTiendaAnulacion" | "historialAccion" | "usuario"
>;

/** El documento tal y como lo ve el SERVIDOR (lleva la tienda y la ruta: nunca sale al cliente). */
export interface AbonoTiendaRegistro {
  id: string;
  tiendaId: string;
  tiendaNombre: string;
  monto: string; // STRING escala 2
  metodo: MetodoLiquidacion;
  referencia: string | null;
  motivo: string;
  fechaPago: string; // YYYY-MM-DD
  comprobantePath: string | null;
  comprobanteContentType: string | null;
  registradoPorNombre: string;
  registradoAt: string; // ISO
  anulado: boolean;
}

export interface CrearAbonoTiendaInput {
  id: string;
  claveIdempotencia: string;
  tiendaId: string;
  monto: string; // STRING escala 2
  metodo: MetodoLiquidacion;
  referencia: string | null;
  motivo: string;
  fechaPago: Date; // medianoche UTC del dia (convencion `@db.Date`)
  comprobantePath: string | null;
  comprobanteContentType: string | null;
  registradoPor: string;
}

export type CrearAbonoTiendaResult =
  | { status: "creado"; abono: AbonoTiendaRegistro }
  | { status: "clave_repetida" };

export interface AnularAbonoTiendaRepoInput {
  abonoId: string;
  motivo: string;
  anuladoPor: string;
}

export type AnularAbonoTiendaRepoResult = { status: "anulado" } | { status: "ya_anulado" };

/** R41 — lo que el libro de la caja necesita saber de cada documento, en UNA consulta. */
export interface EstadoDeAbono {
  id: string;
  anulado: boolean;
  tieneComprobante: boolean;
}

export interface IAbonoTiendaRepository {
  /** Documento + fila del historial, en `tx`. Choque de la clave -> `clave_repetida` (R25). */
  crear(tx: AbonoTiendaTxClient, input: CrearAbonoTiendaInput): Promise<CrearAbonoTiendaResult>;
  /** Fila de anulacion + historial, en `tx`. Choque del UNIQUE(abono_id) -> `ya_anulado` (R36). */
  anular(tx: AbonoTiendaTxClient, input: AnularAbonoTiendaRepoInput): Promise<AnularAbonoTiendaRepoResult>;
  obtenerPorClave(claveIdempotencia: string): Promise<AbonoTiendaRegistro | null>;
  obtenerPorId(id: string): Promise<AbonoTiendaRegistro | null>;
  estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDeAbono[]>;
}
