import type { PrismaClient } from "@prisma/client";
import type {
  WalletTiendaMovimientoDTO,
  WalletTiendaMovimientoTipo,
  WalletTiendaMovimientoCategoria,
} from "@/lib/types/wallet-tienda";
import type { WalletOrigenTipo } from "@/lib/types/wallet";

// Feature 43 (design §2.1) — contrato del repositorio del LEDGER por tienda. Solo queries
// Prisma; sin logica de negocio. Money-safe: montos entran/salen como STRING. El acotado por
// `tienda_id` va SIEMPRE en el WHERE (R19), nunca en memoria.

// Cliente de transaccion aceptado por crearMovimientos: cualquier cosa que exponga
// `walletTiendaMovimiento` (el `tx` de un $transaction, o el PrismaClient completo).
export type WalletTiendaTxClient = Pick<PrismaClient, "walletTiendaMovimiento">;

// Fila a insertar en el ledger. `monto` STRING (money-safe); origenId NULL solo en manual.
export interface CrearMovimientoTiendaInput {
  tiendaId: string;
  tipo: WalletTiendaMovimientoTipo;
  categoria: WalletTiendaMovimientoCategoria;
  monto: string; // STRING 2 dec -> Prisma.Decimal en la impl
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  descripcion?: string | null;
  registradoPor?: string | null;
}

// Filtros del listado del ledger de UNA tienda (R19/R22). `cierreId` filtra por el origen
// (origen_tipo=cierre_dia, origen_id=cierreId). Rango de fechas sobre fecha_movimiento.
export interface ListarPorTiendaFiltros {
  tiendaId: string;
  page: number;
  pageSize: number;
  cierreId?: string;
  categoria?: WalletTiendaMovimientoCategoria;
  desde?: Date;
  hasta?: Date;
}

export interface ListarPorTiendaPage {
  movimientos: WalletTiendaMovimientoDTO[];
  total: number;
}

// Filtros del saldo de UNA tienda (R16/R22): mismo conjunto que el listado, sin paginacion.
export interface SaldoTiendaFiltros {
  cierreId?: string;
  categoria?: WalletTiendaMovimientoCategoria;
  desde?: Date;
  hasta?: Date;
}

// Totales agregados por tipo (credito/debito), ya como STRING (money-safe). El service
// deriva el saldo (creditos - debitos, con signo) via `derivarSaldoTienda`.
export interface SaldoTiendaAgregado {
  creditos: string;
  debitos: string;
}

// Una fila por tienda para la vista del maestro (R20): totales agregados + nombre de la
// tienda. El service deriva el saldo con signo.
export interface SaldoTiendaAgregadoRow {
  tiendaId: string;
  tiendaNombre: string;
  creditos: string;
  debitos: string;
}

export interface IWalletTiendaMovimientoRepository {
  /**
   * R6/R13: inserta las filas de forma IDEMPOTENTE en la transaccion `tx`. Usa
   * `createMany({ skipDuplicates: true })` -> ON CONFLICT DO NOTHING a nivel DB sobre el
   * indice unico parcial (origen_tipo, origen_id, tienda_id, categoria). NO hace
   * check-then-insert (sin TOCTOU). Devuelve cuantas filas se insertaron efectivamente.
   */
  crearMovimientos(tx: WalletTiendaTxClient, movs: CrearMovimientoTiendaInput[]): Promise<number>;
  /** R19/R22: pagina el ledger de UNA tienda (orderBy fecha_movimiento desc), filtros + tienda en el WHERE. */
  listarPorTienda(filtros: ListarPorTiendaFiltros): Promise<ListarPorTiendaPage>;
  /** R16/R19: SUM(monto) por tipo acotado a `tiendaId` + filtros en el WHERE. STRING (money-safe). */
  agregarSaldoPorTienda(tiendaId: string, filtros: SaldoTiendaFiltros): Promise<SaldoTiendaAgregado>;
  /** R20: una fila por tienda (con nombre) con sus totales credito/debito, para el maestro. */
  listarSaldosTodasTiendas(): Promise<SaldoTiendaAgregadoRow[]>;
}
