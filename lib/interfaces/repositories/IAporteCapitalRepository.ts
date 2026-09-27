import type { PrismaClient } from "@prisma/client";

import type { ClaseAporteCapital } from "@/lib/types/aporte-capital";
import type { EstadoDeDocumento } from "@/lib/interfaces/repositories/IPagoPorCuentaTiendaRepository";

/**
 * FICHA 459 (design §6.4) — el contrato del DOCUMENTO del saldo inicial o aporte de capital.
 * SOLO queries. Un tipo de historial por metodo: `crear` -> `aporte_capital_registrado`,
 * `anular` -> `aporte_capital_anulado`. Sin edicion ni borrado.
 */
export type AporteCapitalTxClient = Pick<
  PrismaClient,
  "aporteCapital" | "aporteCapitalAnulacion" | "historialAccion" | "usuario" | "$executeRaw"
>;

export interface AporteCapitalRegistro {
  id: string;
  clase: ClaseAporteCapital;
  monto: string; // STRING escala 2
  motivo: string;
  fecha: string; // YYYY-MM-DD
  comprobantePath: string | null;
  comprobanteContentType: string | null;
  registradoPorNombre: string;
  registradoAt: string; // ISO
  anulado: boolean;
}

export interface CrearAporteCapitalInput {
  id: string;
  claveIdempotencia: string;
  clase: ClaseAporteCapital;
  monto: string;
  motivo: string;
  fecha: Date; // medianoche UTC del dia
  comprobantePath: string | null;
  comprobanteContentType: string | null;
  registradoPor: string;
}

export type CrearAporteCapitalResult =
  | { status: "creado"; aporte: AporteCapitalRegistro }
  | { status: "clave_repetida" };

export interface AnularAporteCapitalInput {
  aporteId: string;
  motivo: string;
  anuladoPor: string;
}

export type AnularAporteCapitalResult = { status: "anulado" } | { status: "ya_anulado" };

export interface IAporteCapitalRepository {
  /**
   * R70 — el candado de «un solo saldo inicial vigente»: `pg_advisory_xact_lock` con una clave
   * FIJA, tomado al principio de la transaccion. No cabe en un indice (la anulacion vive en otra
   * tabla), asi que dos registros simultaneos se SERIALIZAN aqui.
   */
  bloquearSaldoInicial(tx: AporteCapitalTxClient): Promise<void>;
  /** R14/R70 — ¿existe un `saldo_inicial` SIN anulacion? Con `tx`, dentro de la transaccion. */
  haySaldoInicialVigente(tx?: AporteCapitalTxClient): Promise<boolean>;
  crear(tx: AporteCapitalTxClient, input: CrearAporteCapitalInput): Promise<CrearAporteCapitalResult>;
  anular(tx: AporteCapitalTxClient, input: AnularAporteCapitalInput): Promise<AnularAporteCapitalResult>;
  obtenerPorClave(claveIdempotencia: string): Promise<AporteCapitalRegistro | null>;
  obtenerPorId(id: string): Promise<AporteCapitalRegistro | null>;
  estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDeDocumento[]>;
}
