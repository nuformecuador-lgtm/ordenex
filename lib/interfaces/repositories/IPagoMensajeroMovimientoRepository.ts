import type { PrismaClient } from "@prisma/client";
import type {
  PagoMensajeroMovimientoDTO,
  PagoMensajeroMovimientoTipo,
  PagoMensajeroMovimientoCategoria,
} from "@/lib/types/wallet-mensajero";
import type { WalletOrigenTipo } from "@/lib/types/wallet";

// Feature 44 (design §2.1) — contrato del repositorio del LIBRO del pago por mensajero. Solo
// queries Prisma; sin logica de negocio. Money-safe: montos entran/salen como STRING. El acotado
// por `mensajero_id` va SIEMPRE en el WHERE (R20), nunca en memoria.

// Cliente de transaccion aceptado por crearMovimientos: cualquier cosa que exponga
// `pagoMensajeroMovimiento` (el `tx` de un $transaction, o el PrismaClient completo).
export type PagoMensajeroTxClient = Pick<PrismaClient, "pagoMensajeroMovimiento">;

// Fila a insertar en el libro. `monto` STRING (money-safe); origenId NULL solo en manual.
export interface CrearPagoMensajeroInput {
  mensajeroId: string;
  tipo: PagoMensajeroMovimientoTipo;
  categoria: PagoMensajeroMovimientoCategoria;
  monto: string; // STRING 2 dec -> Prisma.Decimal en la impl
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  descripcion?: string | null;
  registradoPor?: string | null;
}

// Filtros del listado del libro de UN mensajero (R20/R22). `cierreId` filtra por el origen
// (origen_tipo=cierre_dia, origen_id=cierreId). Rango de fechas sobre fecha_movimiento.
export interface ListarPorMensajeroFiltros {
  mensajeroId: string;
  page: number;
  pageSize: number;
  cierreId?: string;
  desde?: Date;
  hasta?: Date;
}

export interface ListarPorMensajeroPage {
  movimientos: PagoMensajeroMovimientoDTO[];
  total: number;
}

// Filtros de la cuenta por pagar de UN mensajero (R14/R22): mismo conjunto que el listado, sin
// paginacion.
export interface CuentaPorPagarFiltros {
  cierreId?: string;
  desde?: Date;
  hasta?: Date;
}

// Totales agregados por tipo (devengo/pago), ya como STRING (money-safe). El service deriva la
// cuenta por pagar (devengado - pagado, con signo) via `derivarCuentaPorPagar`.
export interface CuentaPorPagarAgregado {
  devengado: string;
  pagado: string;
}

// Una fila por mensajero para la vista del maestro (R18): totales agregados + nombre. El service
// deriva la cuenta por pagar con signo.
export interface CuentaPorPagarAgregadoRow {
  mensajeroId: string;
  mensajeroNombre: string;
  devengado: string;
  pagado: string;
}

export interface IPagoMensajeroMovimientoRepository {
  /**
   * R6/R12: inserta las filas de forma IDEMPOTENTE en la transaccion `tx`. Usa
   * `createMany({ skipDuplicates: true })` -> ON CONFLICT DO NOTHING a nivel DB sobre el indice
   * unico parcial (origen_tipo, origen_id, mensajero_id, categoria). NO hace check-then-insert
   * (sin TOCTOU). Devuelve cuantas filas se insertaron efectivamente.
   */
  crearMovimientos(tx: PagoMensajeroTxClient, movs: CrearPagoMensajeroInput[]): Promise<number>;
  /** R20/R22: pagina el libro de UN mensajero (orderBy fecha_movimiento desc), filtros + mensajero en el WHERE. */
  listarPorMensajero(filtros: ListarPorMensajeroFiltros): Promise<ListarPorMensajeroPage>;
  /** R14/R20: SUM(monto) por tipo acotado a `mensajeroId` + filtros en el WHERE. STRING (money-safe). */
  agregarCuentaPorPagar(mensajeroId: string, filtros: CuentaPorPagarFiltros): Promise<CuentaPorPagarAgregado>;
  /** R18: una fila por mensajero (con nombre) con sus totales devengado/pagado, para el maestro. */
  listarCuentasPorPagarTodos(): Promise<CuentaPorPagarAgregadoRow[]>;
  /** R18: nombre de UN mensajero (vista del maestro: desglose por cierre de un mensajero arbitrario). null si no existe. */
  obtenerNombreMensajero(mensajeroId: string): Promise<string | null>;
}
