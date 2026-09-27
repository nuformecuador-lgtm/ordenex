import type { PrismaClient } from "@prisma/client";

import type { MetodoLiquidacion } from "@/lib/types/liquidacion";

/**
 * FICHA 459 (design §6.4) — el contrato del DOCUMENTO del pago por cuenta de una tienda. SOLO
 * queries: ni rol, ni saldo, ni validacion de la tienda. Un tipo de historial por metodo (la
 * guardia del censo mide POR METODO): `crear` escribe `pago_por_cuenta_tienda_registrado` y
 * `anular`, `pago_por_cuenta_tienda_anulado`, cada uno en la MISMA transaccion que su fila.
 *
 * No hay metodo de edicion ni de borrado (R52): la ausencia de superficie es el requisito.
 */
export type PagoPorCuentaTxClient = Pick<
  PrismaClient,
  "pagoPorCuentaTienda" | "pagoPorCuentaTiendaAnulacion" | "historialAccion" | "usuario"
>;

/** El documento tal y como lo ve el SERVIDOR (lleva la tienda y la ruta: nunca sale al cliente). */
export interface PagoPorCuentaRegistro {
  id: string;
  tiendaId: string;
  tiendaNombre: string;
  beneficiario: string;
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

export interface CrearPagoPorCuentaInput {
  id: string;
  claveIdempotencia: string;
  tiendaId: string;
  beneficiario: string;
  monto: string; // STRING escala 2
  metodo: MetodoLiquidacion;
  referencia: string | null;
  motivo: string;
  fechaPago: Date; // medianoche UTC del dia (convencion `@db.Date`)
  comprobantePath: string | null;
  comprobanteContentType: string | null;
  registradoPor: string;
}

export type CrearPagoPorCuentaResult =
  | { status: "creado"; pago: PagoPorCuentaRegistro }
  | { status: "clave_repetida" };

export interface AnularPagoPorCuentaInput {
  pagoId: string;
  motivo: string;
  anuladoPor: string;
}

export type AnularPagoPorCuentaResult = { status: "anulado" } | { status: "ya_anulado" };

/** R66/R67 — lo que el libro de la caja necesita saber de cada documento, en UNA consulta. */
export interface EstadoDeDocumento {
  id: string;
  anulado: boolean;
  tieneComprobante: boolean;
}

export interface IPagoPorCuentaTiendaRepository {
  /** Documento + fila del historial, en `tx`. Choque de la clave -> `clave_repetida` (R41). */
  crear(tx: PagoPorCuentaTxClient, input: CrearPagoPorCuentaInput): Promise<CrearPagoPorCuentaResult>;
  /** Fila de anulacion + historial, en `tx`. Choque del UNIQUE(pago_id) -> `ya_anulado` (R50). */
  anular(tx: PagoPorCuentaTxClient, input: AnularPagoPorCuentaInput): Promise<AnularPagoPorCuentaResult>;
  obtenerPorClave(claveIdempotencia: string): Promise<PagoPorCuentaRegistro | null>;
  obtenerPorId(id: string): Promise<PagoPorCuentaRegistro | null>;
  estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDeDocumento[]>;
}
