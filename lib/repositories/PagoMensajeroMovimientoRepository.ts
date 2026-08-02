import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CrearPagoMensajeroInput,
  CuentaPorPagarAgregado,
  CuentaPorPagarAgregadoRow,
  CuentaPorPagarFiltros,
  CuentasPorPagarFiltro,
  IPagoMensajeroMovimientoRepository,
  ListarPorMensajeroFiltros,
  ListarPorMensajeroPage,
  PagoMensajeroTxClient,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import {
  filtrarPorBusquedaMensajero,
  ordenarCuentasPorPagar,
} from "@/lib/utils/cuentas-por-pagar-listado";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletTiendaMovimientoRepository).
type PagoMensajeroPrismaClient = Pick<PrismaClient, "pagoMensajeroMovimiento" | "usuario">;

// Money-safe: Decimal -> STRING escala 2 (nunca number/parseFloat).
type MovimientoRow = Prisma.PagoMensajeroMovimientoGetPayload<Record<string, never>>;

function toDTO(r: MovimientoRow): PagoMensajeroMovimientoDTO {
  return {
    id: r.id,
    mensajeroId: r.mensajeroId,
    tipo: r.tipo,
    categoria: r.categoria,
    monto: r.monto.toFixed(2),
    origenTipo: r.origenTipo,
    origenId: r.origenId,
    descripcion: r.descripcion,
    fechaMovimiento: r.fechaMovimiento.toISOString(),
  };
}

// WHERE de los filtros opcionales del desglose (R22), SIN el acotado por mensajero (lo pone el
// caller). `cierreId` filtra por el origen del cierre (origen_tipo=cierre_dia, origen_id=X).
function buildFiltrosWhere(f: CuentaPorPagarFiltros): Prisma.PagoMensajeroMovimientoWhereInput {
  const where: Prisma.PagoMensajeroMovimientoWhereInput = {};
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
 * Feature 44 — repositorio del LIBRO de movimientos del pago por mensajero. SOLO queries Prisma.
 * Inserta idempotentemente (skipDuplicates -> ON CONFLICT DO NOTHING, R6/R12), lista paginado
 * por fecha desc acotado a `mensajero_id` en el WHERE (R20/R22) y agrega la cuenta por pagar por
 * mensajero (R14). Money-safe: montos entran/salen como STRING.
 */
export class PagoMensajeroMovimientoRepository implements IPagoMensajeroMovimientoRepository {
  constructor(private readonly prisma: PagoMensajeroPrismaClient) {}

  /** R6/R12: inserta en la tx `tx` con skipDuplicates (no TOCTOU); devuelve filas insertadas. */
  async crearMovimientos(
    tx: PagoMensajeroTxClient,
    movs: CrearPagoMensajeroInput[],
  ): Promise<number> {
    if (movs.length === 0) return 0;
    const data = movs.map((m) => ({
      mensajeroId: m.mensajeroId,
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
    const res = await tx.pagoMensajeroMovimiento.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  /** R20/R22: pagina el libro de UN mensajero, mas reciente primero, mensajero + filtros en el WHERE. */
  async listarPorMensajero(filtros: ListarPorMensajeroFiltros): Promise<ListarPorMensajeroPage> {
    // R20: el acotado por mensajero va SIEMPRE en el WHERE, nunca en memoria.
    const where: Prisma.PagoMensajeroMovimientoWhereInput = {
      mensajeroId: filtros.mensajeroId,
      ...buildFiltrosWhere(filtros),
    };
    const skip = (filtros.page - 1) * filtros.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.pagoMensajeroMovimiento.findMany({
        where,
        orderBy: { fechaMovimiento: "desc" },
        skip,
        take: filtros.pageSize,
      }),
      this.prisma.pagoMensajeroMovimiento.count({ where }),
    ]);
    return { movimientos: rows.map(toDTO), total };
  }

  /** R14/R20: SUM(monto) por tipo acotado a `mensajeroId` + filtros. Salida STRING (money-safe). */
  async agregarCuentaPorPagar(
    mensajeroId: string,
    filtros: CuentaPorPagarFiltros,
  ): Promise<CuentaPorPagarAgregado> {
    const where: Prisma.PagoMensajeroMovimientoWhereInput = {
      mensajeroId, // R20: acotado por mensajero en el WHERE
      ...buildFiltrosWhere(filtros),
    };
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["tipo"],
      where,
      _sum: { monto: true },
    });
    let devengado = new Prisma.Decimal(0);
    let pagado = new Prisma.Decimal(0);
    for (const g of grupos) {
      const suma = g._sum.monto ?? new Prisma.Decimal(0);
      if (g.tipo === "devengo") devengado = new Prisma.Decimal(suma);
      else pagado = new Prisma.Decimal(suma);
    }
    return { devengado: devengado.toFixed(2), pagado: pagado.toFixed(2) };
  }

  /** R18: una fila por mensajero (con nombre) + totales devengado/pagado, para la vista del maestro. */
  async listarCuentasPorPagarTodos(): Promise<CuentaPorPagarAgregadoRow[]> {
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["mensajeroId", "tipo"],
      _sum: { monto: true },
    });
    // Agrega devengo/pago por mensajero (Prisma.Decimal, money-safe).
    const porMensajero = new Map<
      string,
      { devengado: Prisma.Decimal; pagado: Prisma.Decimal }
    >();
    for (const g of grupos) {
      const acc = porMensajero.get(g.mensajeroId) ?? {
        devengado: new Prisma.Decimal(0),
        pagado: new Prisma.Decimal(0),
      };
      const suma = g._sum.monto ?? new Prisma.Decimal(0);
      if (g.tipo === "devengo") acc.devengado = acc.devengado.add(suma);
      else acc.pagado = acc.pagado.add(suma);
      porMensajero.set(g.mensajeroId, acc);
    }
    if (porMensajero.size === 0) return [];

    const mensajeroIds = [...porMensajero.keys()];
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: mensajeroIds } },
      select: { id: true, nombre: true },
    });
    const nombrePorId = new Map(usuarios.map((u) => [u.id, u.nombre]));

    return mensajeroIds.map((mensajeroId) => {
      const acc = porMensajero.get(mensajeroId)!;
      return {
        mensajeroId,
        mensajeroNombre: nombrePorId.get(mensajeroId) ?? "",
        devengado: acc.devengado.toFixed(2),
        pagado: acc.pagado.toFixed(2),
      };
    });
  }

  /**
   * Feature 170 — FASE 2 (T L.1, R40/R41/R45/R51) — la misma vista del maestro, con la
   * busqueda por nombre resuelta en el servidor, ordenada y recortada a una pagina.
   *
   * **No corta en la base, y es deliberado** (precedente exacto: `listarSaldosTiendasPaginado`,
   * T I.1 §6.6). Cada fila es la agregacion de TODO el libro de ese mensajero: no hay nada que
   * empujar al `LIMIT` sin cambiar el dinero que la fila declara. Ademas el filtro es por
   * NOMBRE, que vive en `usuario` y no en el libro que se agrega, asi que un `WHERE` sobre la
   * agregacion no lo expresaria sin una segunda lectura de `usuario` cuyo `ILIKE` casaria un
   * conjunto distinto del que casa hoy el navegador (`%` y `_` son comodines en SQL y no en
   * `String.includes`) — que es justo lo que R45 prohibe.
   *
   * Consecuencias, las tres medidas: R44 se cumple por construccion (es literalmente el mismo
   * conjunto que `listarCuentasPorPagarTodos`), R54 en su forma fuerte (cero consultas nuevas,
   * ni la del conteo) y lo que baja no es el coste en Postgres sino lo que cruza a la pantalla,
   * que es de lo que habla el Anexo III para este listado.
   */
  async listarCuentasPorPagarPaginado(
    filtro: CuentasPorPagarFiltro,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<CuentaPorPagarAgregadoRow>> {
    const conjunto = await this.listarCuentasPorPagarCompleto(filtro);
    return {
      items: conjunto.slice(rango.skip, rango.skip + rango.take),
      total: conjunto.length, // R41: el total del CONJUNTO FILTRADO, no el de la pagina
    };
  }

  /**
   * Feature 170 — FASE 2 (T M.1, cierre de Q-L2) — el CONJUNTO filtrado y ordenado, entero.
   *
   * Es la lista de la que el metodo de arriba saca su `slice`, extraida para que la DESCARGA
   * pueda pedirla sin releer el listado sin busqueda y filtrar despues en el navegador (lo que
   * hacia T L.2). Con esto la busqueda deja de tener dos implementaciones vivas —la del
   * servidor y la del cliente— y R45 pasa a cumplirse por construccion tambien en el archivo.
   *
   * Sigue SIN cortar en la base, por el mismo motivo que el metodo paginado: cada fila es la
   * agregacion de todo el libro de ese mensajero y el nombre por el que se busca vive en
   * `usuario`, no en el libro que se agrega.
   */
  async listarCuentasPorPagarCompleto(
    filtro: CuentasPorPagarFiltro,
  ): Promise<CuentaPorPagarAgregadoRow[]> {
    return ordenarCuentasPorPagar(
      // R45: la busqueda ANTES del recorte. Al reves, buscaria dentro de la pagina — que es
      // exactamente la regresion que esta tanda existe para evitar.
      filtrarPorBusquedaMensajero(await this.listarCuentasPorPagarTodos(), filtro.busqueda),
    );
  }

  /** R18: nombre de UN mensajero para la vista del maestro (desglose por cierre); null si no existe. */
  async obtenerNombreMensajero(mensajeroId: string): Promise<string | null> {
    const u = await this.prisma.usuario.findUnique({
      where: { id: mensajeroId },
      select: { nombre: true },
    });
    return u?.nombre ?? null;
  }
}
