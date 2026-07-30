import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  BalanceAgregado,
  BalanceFiltros,
  CrearMovimientoInput,
  DesgloseEgresosAgregado,
  IWalletMovimientoRepository,
  ListarMovimientosFiltros,
  ListarMovimientosPage,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// Cliente Prisma acotado a lo que este repo necesita (patron CierresAdminRepository).
type WalletPrismaClient = Pick<PrismaClient, "walletMovimiento">;

// Money-safe: Decimal -> STRING escala 2 (nunca number/parseFloat).
type MovimientoRow = Prisma.WalletMovimientoGetPayload<Record<string, never>>;

function toDTO(r: MovimientoRow): WalletMovimientoDTO {
  return {
    id: r.id,
    tipo: r.tipo,
    categoria: r.categoria,
    monto: r.monto.toFixed(2),
    origenTipo: r.origenTipo,
    origenId: r.origenId,
    descripcion: r.descripcion,
    registradoPor: r.registradoPor,
    fechaMovimiento: r.fechaMovimiento.toISOString(),
  };
}

// WHERE comun a listado y balance (R20): filtros opcionales tipo/categoria/rango fechas
// sobre fecha_movimiento. `desde`/`hasta` inclusivos.
function buildWhere(f: BalanceFiltros): Prisma.WalletMovimientoWhereInput {
  const where: Prisma.WalletMovimientoWhereInput = {};
  if (f.tipo !== undefined) where.tipo = f.tipo;
  if (f.categoria !== undefined) where.categoria = f.categoria;
  if (f.desde !== undefined || f.hasta !== undefined) {
    where.fechaMovimiento = {
      ...(f.desde !== undefined ? { gte: f.desde } : {}),
      ...(f.hasta !== undefined ? { lte: f.hasta } : {}),
    };
  }
  return where;
}

/**
 * Feature 42 — repositorio del LIBRO de movimientos de la wallet. SOLO queries Prisma.
 * Inserta idempotentemente (skipDuplicates -> ON CONFLICT DO NOTHING, R6/R13), lista
 * paginado por fecha desc con filtros en el WHERE (R20/R24) y agrega el balance (R16).
 */
export class WalletMovimientoRepository implements IWalletMovimientoRepository {
  constructor(private readonly prisma: WalletPrismaClient) {}

  /** R6/R13: inserta en la tx `tx` con skipDuplicates (no TOCTOU); devuelve filas insertadas. */
  async crearMovimientos(tx: WalletTxClient, movs: CrearMovimientoInput[]): Promise<number> {
    if (movs.length === 0) return 0;
    const data = movs.map((m) => ({
      tipo: m.tipo,
      categoria: m.categoria,
      monto: new Prisma.Decimal(m.monto), // STRING -> Decimal (money-safe)
      origenTipo: m.origenTipo,
      origenId: m.origenId,
      descripcion: m.descripcion ?? null,
      registradoPor: m.registradoPor ?? null,
    }));
    const res = await tx.walletMovimiento.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  /** R20/R24: pagina el libro, mas reciente primero, filtros en el WHERE. */
  async listar(filtros: ListarMovimientosFiltros): Promise<ListarMovimientosPage> {
    const where = buildWhere(filtros);
    const skip = (filtros.page - 1) * filtros.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.walletMovimiento.findMany({
        where,
        orderBy: { fechaMovimiento: "desc" },
        skip,
        take: filtros.pageSize,
      }),
      this.prisma.walletMovimiento.count({ where }),
    ]);
    return { movimientos: rows.map(toDTO), total };
  }

  /** R16: SUM(monto) por tipo con los mismos filtros. Salida STRING (money-safe). */
  async agregarBalance(filtros: BalanceFiltros): Promise<BalanceAgregado> {
    const where = buildWhere(filtros);
    const grupos = await this.prisma.walletMovimiento.groupBy({
      by: ["tipo"],
      where,
      _sum: { monto: true },
    });
    let ingresos = new Prisma.Decimal(0);
    let egresos = new Prisma.Decimal(0);
    for (const g of grupos) {
      const suma = g._sum.monto ?? new Prisma.Decimal(0);
      if (g.tipo === "ingreso") ingresos = new Prisma.Decimal(suma);
      else egresos = new Prisma.Decimal(suma);
    }
    return { ingresos: ingresos.toFixed(2), egresos: egresos.toFixed(2) };
  }

  /** Feature 45 (R13): lee un movimiento por id (para la reversa). null si no existe. */
  async obtenerPorId(id: string): Promise<WalletMovimientoDTO | null> {
    const row = await this.prisma.walletMovimiento.findUnique({ where: { id } });
    return row === null ? null : toDTO(row);
  }

  /** Feature 45 (R11): SUM(monto) por categoria administrativa, con los mismos filtros. STRING. */
  async agregarPorCategoria(filtros: BalanceFiltros): Promise<DesgloseEgresosAgregado> {
    const where = buildWhere(filtros);
    const grupos = await this.prisma.walletMovimiento.groupBy({
      by: ["categoria"],
      where,
      _sum: { monto: true },
    });
    const sumaDe = (categoria: string): string => {
      const g = grupos.find((x) => x.categoria === categoria);
      return (g?._sum.monto ?? new Prisma.Decimal(0)).toFixed(2);
    };
    return {
      gastoFijo: sumaDe("egreso_gasto_fijo"),
      gastoVariable: sumaDe("egreso_gasto_variable"),
      sueldo: sumaDe("egreso_sueldo"),
      indemnizacion: sumaDe("egreso_indemnizacion"), // feature 158/R32
    };
  }
}
