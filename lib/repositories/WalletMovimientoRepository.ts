import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  BalanceFiltros,
  CrearMovimientoInput,
  DesgloseEgresosAgregado,
  IWalletMovimientoRepository,
  ListarMovimientosFiltros,
  ListarMovimientosPage,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  AgregadoCajaRow,
  WalletMovimientoCategoria,
  WalletMovimientoDTO,
  WalletOrigenTipo,
} from "@/lib/types/wallet";
import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";

// Cliente Prisma acotado a lo que este repo necesita (patron CierresAdminRepository).
type WalletPrismaClient = Pick<PrismaClient, "walletMovimiento">;

// Money-safe: Decimal -> STRING escala 2 (nunca number/parseFloat).
type MovimientoRow = Prisma.WalletMovimientoGetPayload<Record<string, never>>;

/**
 * Feature 231 (R31/R32, design §3.3) — `dueno` se asigna AQUI, en el unico punto de proyeccion
 * a DTO por el que pasan `listar`, `listarCompleto` y `obtenerPorId`.
 *
 * Desviacion consciente de `docs/architecture.md` («el repositorio no lleva logica de
 * negocio»), declarada en design §3.3 y §6.2: lo que se anade no es una regla, es una BUSQUEDA
 * TOTAL en un `Record` ya existente durante la proyeccion, que es justo lo que esta funcion
 * hace con los demas campos. Mapear en el servicio obligaria a repetir el `map` en los cuatro
 * caminos que consumen este DTO y abriria la puerta a que la tabla y la descarga dijeran cosas
 * distintas — que es exactamente lo que la columna «Dueño» existe para impedir.
 *
 * `NATURALEZA_POR_CATEGORIA` es un `Record` TOTAL sobre el union de categorias: el dia que el
 * enum gane un valor, esto deja de compilar hasta que alguien decida de quien es ese dinero.
 */
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
    dueno: NATURALEZA_POR_CATEGORIA[r.categoria],
  };
}

// WHERE comun a listado y balance (R20): filtros opcionales tipo/categoria/rango fechas
// sobre fecha_movimiento. `desde`/`hasta` inclusivos.
//
// Ficha 339 (T3.2, design §4.4 — R33): + `categorias`, el CONJUNTO de una fila de la tarjeta de
// la ganancia. Va en `AND` y NO sobreescribiendo `where.categoria`, para que CONVIVAN el filtro
// de categoria del usuario y el conjunto de la fila; si los dos se contradicen el resultado es
// vacio, que es lo correcto —el importe de esa fila bajo esos filtros tambien es 0,00—.
// El recorte lo hace el motor: `categoria IN (…)` viaja en el `WHERE`, nunca es un `filter` en
// memoria sobre lo que la base ya devolvio.
function buildWhere(f: BalanceFiltros): Prisma.WalletMovimientoWhereInput {
  const where: Prisma.WalletMovimientoWhereInput = {};
  if (f.tipo !== undefined) where.tipo = f.tipo;
  if (f.categoria !== undefined) where.categoria = f.categoria;
  if (f.categorias !== undefined) where.AND = [{ categoria: { in: [...f.categorias] } }];
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
 * paginado por fecha desc con filtros en el WHERE (R20/R24) y agrega por (categoria, tipo)
 * con esos mismos filtros (feature 173/R8).
 *
 * INMUTABLE (R3/R47): no expone `update` ni `delete`, y con la 173 sigue sin exponerlos —
 * una correccion es un movimiento compensatorio, no una edicion.
 */
export class WalletMovimientoRepository implements IWalletMovimientoRepository {
  constructor(private readonly prisma: WalletPrismaClient) {}

  /** R6/R13: inserta en la tx `tx` con skipDuplicates (no TOCTOU); devuelve filas insertadas. */
  async crearMovimientos(tx: WalletTxClient, movs: CrearMovimientoInput[]): Promise<number> {
    if (movs.length === 0) return 0;
    const data = movs.map((m) => ({
      // Ficha 334 (design §5, R28): la clave SOLO viaja si el llamador la trae, exactamente
      // como `fechaMovimiento` aqui abajo. Omitirla —en vez de mandar `undefined`— es lo que
      // deja a los cinco escritores existentes cayendo en el `@default(uuid())` de la columna.
      ...(m.id !== undefined ? { id: m.id } : {}),
      tipo: m.tipo,
      categoria: m.categoria,
      monto: new Prisma.Decimal(m.monto), // STRING -> Decimal (money-safe)
      origenTipo: m.origenTipo,
      origenId: m.origenId,
      descripcion: m.descripcion ?? null,
      registradoPor: m.registradoPor ?? null,
      // Feature 173 (design §2.3, R20/R25): la clave SOLO viaja si el llamador la trae. Se
      // omite —en vez de mandar `undefined`— para que quien no la pasa siga cayendo en el
      // `DEFAULT CURRENT_TIMESTAMP` de la columna, exactamente como hasta hoy.
      ...(m.fechaMovimiento !== undefined ? { fechaMovimiento: m.fechaMovimiento } : {}),
    }));
    const res = await tx.walletMovimiento.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  /**
   * R20/R24: pagina el libro, mas reciente primero, filtros en el WHERE.
   *
   * Ficha 334 (R26, design §4) — el orden es TOTAL, no solo por fecha. Ordenar por UNA columna
   * y paginar con `skip`/`take` deja las filas que empatan en orden indefinido, y eso significa
   * una fila que sale DOS veces o NINGUNA al pasar de pagina. Ya podia pasar (dos pagos a
   * tienda del mismo dia reciben el mismo instante); con la fecha elegida por el usuario, dos
   * movimientos del mismo dia pasado reciben EXACTAMENTE el mismo `06:00Z` y el empate deja de
   * ser raro. `createdAt` desempata por creacion real —que es la semantica de esa columna— e
   * `id` cierra el orden aunque dos filas compartieran tambien `created_at`.
   *
   * Sin indice nuevo a proposito: el desempate solo actua DENTRO de un `fecha_movimiento`
   * identico, y `@@index([fechaMovimiento])` sigue sirviendo al filtro de rango.
   */
  async listar(filtros: ListarMovimientosFiltros): Promise<ListarMovimientosPage> {
    const where = buildWhere(filtros);
    const skip = (filtros.page - 1) * filtros.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.walletMovimiento.findMany({
        where,
        orderBy: [{ fechaMovimiento: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip,
        take: filtros.pageSize,
      }),
      this.prisma.walletMovimiento.count({ where }),
    ]);
    return { movimientos: rows.map(toDTO), total };
  }

  /**
   * Feature 173 (T D.1, R8/R47): `groupBy(categoria, tipo)` + `SUM(monto)` con los MISMOS
   * filtros del listado. Salida STRING escala 2 (money-safe: `Prisma.Decimal` dentro, `number`
   * en ninguna parte).
   *
   * Solo agrega. Ni particiona por naturaleza ni resta: eso es de `derivarCaja`, que es pura.
   */
  async agregarPorCategoriaYTipo(filtros: BalanceFiltros): Promise<readonly AgregadoCajaRow[]> {
    const where = buildWhere(filtros);
    const grupos = await this.prisma.walletMovimiento.groupBy({
      by: ["categoria", "tipo"],
      where,
      _sum: { monto: true },
    });
    return grupos.map((g) => ({
      categoria: g.categoria,
      tipo: g.tipo,
      total: (g._sum.monto ?? new Prisma.Decimal(0)).toFixed(2),
    }));
  }

  /** Feature 45 (R13): lee un movimiento por id (para la reversa). null si no existe. */
  async obtenerPorId(id: string): Promise<WalletMovimientoDTO | null> {
    const row = await this.prisma.walletMovimiento.findUnique({ where: { id } });
    return row === null ? null : toDTO(row);
  }

  /**
   * Ficha 333 (C2, design §2/§6.3) — el movimiento que ocupa la clave `(origen_tipo, origen_id,
   * categoria)`, o `null`. Es la terna de `wallet_movimiento_origen_categoria_uq`, así que hay
   * como mucho una fila; `findFirst` y no `findUnique` porque ese índice es PARCIAL
   * (`WHERE origen_id IS NOT NULL`) y Prisma no lo expresa como clave única del cliente.
   *
   * Lee DENTRO del `tx` que le pasan: quien la llama acaba de intentar la escritura en esa misma
   * transacción y necesita ver lo que esa transacción ve.
   *
   * NO añade ninguna mutación: el libro sigue siendo append-only e inmutable (R3 de la 42) y
   * esta clase sigue sin exponer `update` ni `delete`.
   */
  async obtenerPorOrigen(
    tx: WalletTxClient,
    origenTipo: WalletOrigenTipo,
    origenId: string,
    categoria: WalletMovimientoCategoria,
  ): Promise<WalletMovimientoDTO | null> {
    const row = await tx.walletMovimiento.findFirst({
      where: { origenTipo, origenId, categoria },
    });
    return row === null || row === undefined ? null : toDTO(row);
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
