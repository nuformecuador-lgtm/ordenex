import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CrearMovimientoTiendaInput,
  DesgloseTiendaAgregadoRow,
  IWalletTiendaMovimientoRepository,
  ListarPorTiendaFiltros,
  ListarPorTiendaPage,
  SaldoTiendaAgregado,
  SaldoTiendaAgregadoRow,
  SaldoTiendaFiltros,
  WalletTiendaTxClient,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletMovimientoRepository).
type WalletTiendaPrismaClient = Pick<PrismaClient, "walletTiendaMovimiento" | "usuario">;

// Money-safe: Decimal -> STRING escala 2 (nunca number/parseFloat).
type MovimientoRow = Prisma.WalletTiendaMovimientoGetPayload<Record<string, never>>;

function toDTO(r: MovimientoRow): WalletTiendaMovimientoDTO {
  return {
    id: r.id,
    tiendaId: r.tiendaId,
    tipo: r.tipo,
    categoria: r.categoria,
    monto: r.monto.toFixed(2),
    origenTipo: r.origenTipo,
    origenId: r.origenId,
    descripcion: r.descripcion,
    fechaMovimiento: r.fechaMovimiento.toISOString(),
  };
}

// WHERE de los filtros opcionales del desglose (R22), SIN el acotado por tienda (lo pone el
// caller). `cierreId` filtra por el origen del cierre (origen_tipo=cierre_dia, origen_id=X).
function buildFiltrosWhere(f: SaldoTiendaFiltros): Prisma.WalletTiendaMovimientoWhereInput {
  const where: Prisma.WalletTiendaMovimientoWhereInput = {};
  if (f.categoria !== undefined) where.categoria = f.categoria;
  if (f.cierreId !== undefined) {
    where.origenTipo = "cierre_dia";
    where.origenId = f.cierreId;
  }
  if (f.desde !== undefined || f.hasta !== undefined) {
    where.fechaMovimiento = {
      ...(f.desde !== undefined ? { gte: f.desde } : {}),
      ...(f.hasta !== undefined ? { lte: f.hasta } : {}),
    };
  }
  return where;
}

/**
 * Feature 43 — repositorio del LEDGER de movimientos por tienda. SOLO queries Prisma.
 * Inserta idempotentemente (skipDuplicates -> ON CONFLICT DO NOTHING, R6/R13), lista
 * paginado por fecha desc acotado a `tienda_id` en el WHERE (R19/R22) y agrega el saldo por
 * tienda (R16). Money-safe: montos entran/salen como STRING.
 */
export class WalletTiendaMovimientoRepository implements IWalletTiendaMovimientoRepository {
  constructor(private readonly prisma: WalletTiendaPrismaClient) {}

  /** R6/R13: inserta en la tx `tx` con skipDuplicates (no TOCTOU); devuelve filas insertadas. */
  async crearMovimientos(
    tx: WalletTiendaTxClient,
    movs: CrearMovimientoTiendaInput[],
  ): Promise<number> {
    if (movs.length === 0) return 0;
    const data = movs.map((m) => ({
      tiendaId: m.tiendaId,
      tipo: m.tipo,
      categoria: m.categoria,
      monto: new Prisma.Decimal(m.monto), // STRING -> Decimal (money-safe)
      origenTipo: m.origenTipo,
      origenId: m.origenId,
      descripcion: m.descripcion ?? null,
      registradoPor: m.registradoPor ?? null,
      // Feature 172 (T B.2, R37): la fecha del movimiento se pasa SOLO si viene. La clave
      // no se emite cuando el caller no la manda —no se emite `undefined`, no se emite la
      // clave— asi que el feed del cierre sigue cayendo en el `DEFAULT CURRENT_TIMESTAMP`
      // de la columna exactamente como antes.
      ...(m.fechaMovimiento !== undefined ? { fechaMovimiento: m.fechaMovimiento } : {}),
    }));
    const res = await tx.walletTiendaMovimiento.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  /** R19/R22: pagina el ledger de UNA tienda, mas reciente primero, tienda + filtros en el WHERE. */
  async listarPorTienda(filtros: ListarPorTiendaFiltros): Promise<ListarPorTiendaPage> {
    // R19: el acotado por tienda va SIEMPRE en el WHERE, nunca en memoria.
    const where: Prisma.WalletTiendaMovimientoWhereInput = {
      tiendaId: filtros.tiendaId,
      ...buildFiltrosWhere(filtros),
    };
    const skip = (filtros.page - 1) * filtros.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.walletTiendaMovimiento.findMany({
        where,
        orderBy: { fechaMovimiento: "desc" },
        skip,
        take: filtros.pageSize,
      }),
      this.prisma.walletTiendaMovimiento.count({ where }),
    ]);
    return { movimientos: rows.map(toDTO), total };
  }

  /** R16/R19: SUM(monto) por tipo acotado a `tiendaId` + filtros. Salida STRING (money-safe). */
  async agregarSaldoPorTienda(
    tiendaId: string,
    filtros: SaldoTiendaFiltros,
  ): Promise<SaldoTiendaAgregado> {
    const where: Prisma.WalletTiendaMovimientoWhereInput = {
      tiendaId, // R19: acotado por tienda en el WHERE
      ...buildFiltrosWhere(filtros),
    };
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["tipo"],
      where,
      _sum: { monto: true },
    });
    let creditos = new Prisma.Decimal(0);
    let debitos = new Prisma.Decimal(0);
    for (const g of grupos) {
      const suma = g._sum.monto ?? new Prisma.Decimal(0);
      if (g.tipo === "credito") creditos = new Prisma.Decimal(suma);
      else debitos = new Prisma.Decimal(suma);
    }
    return { creditos: creditos.toFixed(2), debitos: debitos.toFixed(2) };
  }

  /**
   * Feature 171 (R22/R24/R34) — Σ monto por (tipo, categoria) para UNA tienda + filtros.
   *
   * UNA sola sentencia, siempre: el desglose de la cabecera no crece con el tamaño de pagina
   * ni con el numero de tiendas listadas. `tiendaId` va en el WHERE, no en memoria — es el
   * unico acotado que impide que la cabecera de una tienda sume el dinero de otra.
   *
   * No clasifica ni resta: eso es negocio y vive en `derivarDesgloseTienda`. Salida STRING.
   */
  async agregarDesglosePorTienda(
    tiendaId: string,
    filtros: SaldoTiendaFiltros,
  ): Promise<DesgloseTiendaAgregadoRow[]> {
    const where: Prisma.WalletTiendaMovimientoWhereInput = {
      tiendaId, // R24: acotado por tienda en el WHERE
      ...buildFiltrosWhere(filtros),
    };
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["tipo", "categoria"],
      where,
      _sum: { monto: true },
    });
    return grupos.map((g) => ({
      tipo: g.tipo,
      categoria: g.categoria,
      total: new Prisma.Decimal(g._sum.monto ?? 0).toFixed(2), // money-safe
    }));
  }

  /** R20: una fila por tienda (con nombre) + totales credito/debito, para la vista del maestro. */
  async listarSaldosTodasTiendas(): Promise<SaldoTiendaAgregadoRow[]> {
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["tiendaId", "tipo"],
      _sum: { monto: true },
    });
    // Agrega credito/debito por tienda (Prisma.Decimal, money-safe).
    const porTienda = new Map<string, { creditos: Prisma.Decimal; debitos: Prisma.Decimal }>();
    for (const g of grupos) {
      const acc = porTienda.get(g.tiendaId) ?? {
        creditos: new Prisma.Decimal(0),
        debitos: new Prisma.Decimal(0),
      };
      const suma = g._sum.monto ?? new Prisma.Decimal(0);
      if (g.tipo === "credito") acc.creditos = acc.creditos.add(suma);
      else acc.debitos = acc.debitos.add(suma);
      porTienda.set(g.tiendaId, acc);
    }
    if (porTienda.size === 0) return [];

    const tiendaIds = [...porTienda.keys()];
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: tiendaIds } },
      select: { id: true, nombre: true },
    });
    const nombrePorId = new Map(usuarios.map((u) => [u.id, u.nombre]));

    return tiendaIds.map((tiendaId) => {
      const acc = porTienda.get(tiendaId)!;
      return {
        tiendaId,
        tiendaNombre: nombrePorId.get(tiendaId) ?? "",
        creditos: acc.creditos.toFixed(2),
        debitos: acc.debitos.toFixed(2),
      };
    });
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): una PAGINA de los saldos por tienda +
   * el total de tiendas con movimientos.
   *
   * Este listado es el UNICO de los siete que no es un `findMany` sobre una tabla: cada fila
   * es una AGREGACION de todo el ledger de esa tienda. El saldo de una tienda no se puede
   * calcular a partir de una pagina de movimientos, asi que la agregacion es del conjunto
   * completo POR CONSTRUCCION y no hay nada que empujar al `LIMIT`. Por eso el recorte se hace
   * sobre `listarSaldosTodasTiendas`, reusando la MISMA agregacion, con tres consecuencias
   * medibles:
   *
   *  - R44 se cumple por construccion: es literalmente el mismo conjunto de filas.
   *  - R54 se cumple en su forma FUERTE: cero consultas nuevas — ni siquiera la del conteo,
   *    que sale de la longitud del mismo resultado.
   *  - El coste en base NO baja. Lo que baja es lo que cruza a la pantalla, que es de lo que
   *    habla el Anexo III para este listado («crece con el numero de tiendas», design §11.3).
   *
   * ORDEN (R51): por NOMBRE de tienda. Hoy este listado NO tiene criterio de ordenacion —
   * `groupBy` devuelve las filas en el orden que le conviene al planificador, que Postgres no
   * garantiza estable entre llamadas. Sin un orden TOTAL, la pagina 2 podria repetir u omitir
   * tiendas de la pagina 1. Se elige el nombre porque es el identificador de negocio de la
   * fila (la 170 ya dejo el `tienda_id` fuera del archivo de descarga por lo mismo) y el
   * `tiendaId` desempata para que el orden sea total. Queda declarado como DESVIACION en
   * `progress/impl_170-fase2-tanda-i.md`: R51 no tenia aqui criterio que conservar.
   */
  async listarSaldosTiendasPaginado(
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<SaldoTiendaAgregadoRow>> {
    const filas = await this.listarSaldosTodasTiendas();
    const ordenadas = [...filas].sort(
      (a, b) =>
        a.tiendaNombre.localeCompare(b.tiendaNombre) || a.tiendaId.localeCompare(b.tiendaId),
    );
    return {
      items: ordenadas.slice(rango.skip, rango.skip + rango.take),
      total: ordenadas.length, // R41: el total del CONJUNTO, no el de la pagina
    };
  }
}
