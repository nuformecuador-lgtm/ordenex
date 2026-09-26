import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  BusquedaDeCierre,
  CierreDeCuentaRow,
  ConteoPorCategoria,
  FiltrosConteoCaja,
  FiltrosConteoTienda,
  IFiltrosWalletRepository,
} from "@/lib/interfaces/repositories/IFiltrosWalletRepository";
import { CUENTA_USUARIO_SELECT, etiquetaDeCuenta } from "@/lib/utils/etiqueta-cuenta";

type FiltrosPrismaClient = Pick<
  PrismaClient,
  "walletMovimiento" | "walletTiendaMovimiento" | "cierreDia" | "$queryRaw"
>;

function rangoFecha(desde?: Date, hasta?: Date): { gte?: Date; lt?: Date } | undefined {
  if (desde === undefined && hasta === undefined) return undefined;
  return {
    ...(desde !== undefined ? { gte: desde } : {}),
    // Ficha 461 (R72): cota EXCLUSIVA; el borde manda el inicio del dia CR siguiente.
    ...(hasta !== undefined ? { lt: hasta } : {}),
  };
}

/** El texto de la persona como LITERAL dentro de un `ILIKE`: sus `%`, `_` y `\` no son comodines. */
function patronQueContiene(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Revision 458-A (m4) — la busqueda se resuelve EN LA MISMA consulta que agrupa los cierres de la
 * cuenta (un `JOIN` con el cierre y su mensajero), no en una lectura previa cuyos ids viajaban en un
 * `IN`. Aquella lectura no tenia tope: buscar «a» casaba los cierres de casi todos los mensajeros de
 * la historia y el `IN` crecia con ellos hasta el limite de parametros de Postgres (32.767), y el
 * selector entraba en «error». Ahora la consulta lleva SIEMPRE los mismos parametros, casen 3
 * cierres o 300.000, y devuelve como mucho `limite` filas.
 */
function condicionDeBusqueda(busqueda: BusquedaDeCierre | undefined): Prisma.Sql {
  if (busqueda === undefined) return Prisma.empty;
  if (busqueda.tipo === "dia") {
    return Prisma.sql`AND c."solicitado_at" >= ${busqueda.desde} AND c."solicitado_at" < ${busqueda.hasta}`;
  }
  const patron = patronQueContiene(busqueda.texto);
  return Prisma.sql`AND (u."nombre" ILIKE ${patron} OR u."primer_apellido" ILIKE ${patron} OR u."segundo_apellido" ILIKE ${patron})`;
}

/** Un cierre de la cuenta, agrupado en SQL: su id y cuantas filas del libro lleva. */
type GrupoDeCierre = { origenId: string; movimientos: number };

/**
 * Ficha 458-A (TA.3/TA.4, design §3.5) — los filtros de la wallet. SOLO queries: conteos por
 * concepto (`groupBy` + `_count`, nunca `_sum`) y los cierres de una cuenta con el nombre de su
 * mensajero. La CUENTA va primero en cada `where` y la escribe el metodo (R12).
 */
export class FiltrosWalletRepository implements IFiltrosWalletRepository {
  constructor(private readonly prisma: FiltrosPrismaClient) {}

  async contarConceptosCaja(f: FiltrosConteoCaja): Promise<ConteoPorCategoria[]> {
    const fecha = rangoFecha(f.desde, f.hasta);
    const grupos = await this.prisma.walletMovimiento.groupBy({
      by: ["categoria"],
      where: {
        ...(f.tipo !== undefined ? { tipo: f.tipo } : {}),
        ...(fecha !== undefined ? { fechaMovimiento: fecha } : {}),
      },
      _count: { _all: true },
    });
    return grupos.map((g) => ({ categoria: g.categoria, movimientos: g._count._all }));
  }

  async contarConceptosTienda(tiendaId: string, f: FiltrosConteoTienda): Promise<ConteoPorCategoria[]> {
    const fecha = rangoFecha(f.desde, f.hasta);
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["categoria"],
      where: {
        tiendaId, // R12: la cuenta, escrita aqui y primero
        ...(f.cierreId !== undefined ? { origenTipo: "cierre_dia", origenId: f.cierreId } : {}),
        ...(fecha !== undefined ? { fechaMovimiento: fecha } : {}),
      },
      _count: { _all: true },
    });
    return grupos.map((g) => ({ categoria: g.categoria, movimientos: g._count._all }));
  }

  async cierresDeTienda(
    tiendaId: string,
    busqueda: BusquedaDeCierre | undefined,
    limite: number,
  ): Promise<CierreDeCuentaRow[]> {
    // R11/R12: SOLO los cierres con movimientos en ESTA tienda; la cuenta, primera en el WHERE.
    const grupos = await this.prisma.$queryRaw<GrupoDeCierre[]>(Prisma.sql`
      SELECT w."origen_id" AS "origenId", COUNT(*)::int AS "movimientos"
      FROM "wallet_tienda_movimiento" w
      JOIN "cierre_dia" c ON c."id" = w."origen_id"
      JOIN "usuario" u ON u."id" = c."mensajero_id"
      WHERE w."tienda_id" = ${tiendaId}
        AND w."origen_tipo"::text = 'cierre_dia'
        ${condicionDeBusqueda(busqueda)}
      GROUP BY w."origen_id"
      ORDER BY MAX(w."fecha_movimiento") DESC, w."origen_id" DESC
      LIMIT ${limite}
    `);
    return this.conMensajero(grupos);
  }

  async cierresDeMensajero(
    mensajeroId: string,
    busqueda: BusquedaDeCierre | undefined,
    limite: number,
  ): Promise<CierreDeCuentaRow[]> {
    // R11/R12: SOLO los cierres con movimientos en ESTE mensajero; la cuenta, primera en el WHERE.
    const grupos = await this.prisma.$queryRaw<GrupoDeCierre[]>(Prisma.sql`
      SELECT w."origen_id" AS "origenId", COUNT(*)::int AS "movimientos"
      FROM "pago_mensajero_movimiento" w
      JOIN "cierre_dia" c ON c."id" = w."origen_id"
      JOIN "usuario" u ON u."id" = c."mensajero_id"
      WHERE w."mensajero_id" = ${mensajeroId}
        AND w."origen_tipo"::text = 'cierre_dia'
        ${condicionDeBusqueda(busqueda)}
      GROUP BY w."origen_id"
      ORDER BY MAX(w."fecha_movimiento") DESC, w."origen_id" DESC
      LIMIT ${limite}
    `);
    return this.conMensajero(grupos);
  }

  /**
   * Nombre y dia de cada cierre de la pagina, en UNA consulta; conserva el orden de la agrupacion.
   * El `IN` de aqui lleva como mucho `limite` ids (los de la pagina), nunca los de la busqueda.
   */
  private async conMensajero(grupos: readonly GrupoDeCierre[]): Promise<CierreDeCuentaRow[]> {
    const ids = grupos.map((g) => g.origenId);
    if (ids.length === 0) return [];
    const cierres = await this.prisma.cierreDia.findMany({
      where: { id: { in: ids } },
      select: { id: true, solicitadoAt: true, mensajero: { select: CUENTA_USUARIO_SELECT } },
    });
    const porId = new Map(cierres.map((c) => [c.id, c]));
    const filas: CierreDeCuentaRow[] = [];
    for (const g of grupos) {
      const c = porId.get(g.origenId);
      // El `JOIN` ya descarta un `origen_id` sin su cierre; si el cierre desapareciera entre las dos
      // lecturas, la opcion se omite en vez de viajar sin dia ni mensajero.
      if (c === undefined) continue;
      filas.push({
        cierreId: c.id,
        solicitadoAt: c.solicitadoAt.toISOString(),
        mensajero: etiquetaDeCuenta(c.mensajero),
        movimientos: g.movimientos,
      });
    }
    return filas;
  }
}
