import type { PrismaClient } from "@prisma/client";
import type {
  WalletMovimientoDTO,
  WalletMovimientoTipo,
  WalletMovimientoCategoria,
  WalletOrigenTipo,
} from "@/lib/types/wallet";

// Feature 42 (design §2.1) — contrato del repositorio del LIBRO de movimientos. Solo
// queries Prisma; sin logica de negocio. Money-safe: montos entran/salen como STRING.

// Cliente de transaccion aceptado por crearMovimientos: cualquier cosa que exponga
// `walletMovimiento` (el `tx` de un $transaction, o el PrismaClient completo).
export type WalletTxClient = Pick<PrismaClient, "walletMovimiento">;

// Fila a insertar en el libro. `monto` STRING (money-safe); origenId NULL solo en manual.
export interface CrearMovimientoInput {
  tipo: WalletMovimientoTipo;
  categoria: WalletMovimientoCategoria;
  monto: string; // STRING 2 dec -> Prisma.Decimal en la impl
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  descripcion?: string | null;
  registradoPor?: string | null;
}

// Filtros del listado del libro (R20). Rango de fechas sobre fecha_movimiento.
export interface ListarMovimientosFiltros {
  page: number;
  pageSize: number;
  tipo?: WalletMovimientoTipo;
  categoria?: WalletMovimientoCategoria;
  desde?: Date;
  hasta?: Date;
}

export interface ListarMovimientosPage {
  movimientos: WalletMovimientoDTO[];
  total: number;
}

// Filtros del balance (R16/R20): mismo conjunto que el listado, sin paginacion.
export interface BalanceFiltros {
  tipo?: WalletMovimientoTipo;
  categoria?: WalletMovimientoCategoria;
  desde?: Date;
  hasta?: Date;
}

// Totales agregados del balance, ya como STRING (money-safe).
export interface BalanceAgregado {
  ingresos: string;
  egresos: string;
}

// Feature 45 (R11) — desglose de egresos administrativos por tipo, ya como STRING
// (money-safe). Deriva de un groupBy(categoria) acotado a las 3 categorias administrativas.
export interface DesgloseEgresosAgregado {
  gastoFijo: string; // SUM(egreso_gasto_fijo)
  gastoVariable: string; // SUM(egreso_gasto_variable)
  sueldo: string; // SUM(egreso_sueldo)
}

export interface IWalletMovimientoRepository {
  /**
   * R6/R13: inserta las filas de forma IDEMPOTENTE en la transaccion `tx`. Usa
   * `createMany({ skipDuplicates: true })` -> ON CONFLICT DO NOTHING a nivel DB sobre el
   * indice unico parcial (origen_tipo, origen_id, categoria). NO hace check-then-insert
   * (sin TOCTOU). Devuelve cuantas filas se insertaron efectivamente.
   */
  crearMovimientos(tx: WalletTxClient, movs: CrearMovimientoInput[]): Promise<number>;
  /** R20/R24: pagina el libro (orderBy fecha_movimiento desc) con filtros en el WHERE. */
  listar(filtros: ListarMovimientosFiltros): Promise<ListarMovimientosPage>;
  /** R16: SUM(monto) FILTER por ingreso/egreso con los mismos filtros. STRING (money-safe). */
  agregarBalance(filtros: BalanceFiltros): Promise<BalanceAgregado>;
  /**
   * Feature 45 (R13): lee un movimiento por id para la reversa (monto server-side; evita
   * que el cliente falsee el monto). null si no existe.
   */
  obtenerPorId(id: string): Promise<WalletMovimientoDTO | null>;
  /**
   * Feature 45 (R11): desglose de egresos administrativos por tipo (gasto fijo / variable /
   * sueldo) del conjunto filtrado (mismos filtros que el libro). groupBy(categoria) +
   * SUM(monto), STRING (money-safe).
   */
  agregarPorCategoria(filtros: BalanceFiltros): Promise<DesgloseEgresosAgregado>;
}
