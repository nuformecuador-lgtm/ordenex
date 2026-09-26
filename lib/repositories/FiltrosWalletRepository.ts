import type { Prisma, PrismaClient } from "@prisma/client";

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
  "walletMovimiento" | "walletTiendaMovimiento" | "pagoMensajeroMovimiento" | "cierreDia"
>;

function rangoFecha(desde?: Date, hasta?: Date): { gte?: Date; lt?: Date } | undefined {
  if (desde === undefined && hasta === undefined) return undefined;
  return {
    ...(desde !== undefined ? { gte: desde } : {}),
    // Ficha 461 (R72): cota EXCLUSIVA; el borde manda el inicio del dia CR siguiente.
    ...(hasta !== undefined ? { lt: hasta } : {}),
  };
}

/** Los ids de cierre que casan la busqueda. `undefined` = sin busqueda (no acota). */
async function idsQueCasan(
  prisma: FiltrosPrismaClient,
  busqueda: BusquedaDeCierre | undefined,
): Promise<string[] | undefined> {
  if (busqueda === undefined) return undefined;
  const where: Prisma.CierreDiaWhereInput =
    busqueda.tipo === "dia"
      ? { solicitadoAt: { gte: busqueda.desde, lt: busqueda.hasta } }
      : {
          mensajero: {
            OR: [
              { nombre: { contains: busqueda.texto, mode: "insensitive" } },
              { primerApellido: { contains: busqueda.texto, mode: "insensitive" } },
              { segundoApellido: { contains: busqueda.texto, mode: "insensitive" } },
            ],
          },
        };
  const filas = await prisma.cierreDia.findMany({ where, select: { id: true } });
  return filas.map((f) => f.id);
}

type GrupoDeCierre = { origenId: string | null; _count: { _all: number }; _max: { fechaMovimiento: Date | null } };

/**
 * Ficha 458-A (TA.3/TA.4, design §3.5) — los filtros de la wallet. SOLO queries Prisma: conteos por
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
    const ids = await idsQueCasan(this.prisma, busqueda);
    if (ids !== undefined && ids.length === 0) return [];
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["origenId"],
      where: {
        tiendaId, // R11/R12: SOLO los cierres con movimientos en ESTA tienda
        origenTipo: "cierre_dia",
        origenId: ids === undefined ? { not: null } : { in: ids },
      },
      _max: { fechaMovimiento: true },
      _count: { _all: true },
      orderBy: [{ _max: { fechaMovimiento: "desc" } }, { origenId: "desc" }],
      take: limite,
    });
    return this.conMensajero(grupos);
  }

  async cierresDeMensajero(
    mensajeroId: string,
    busqueda: BusquedaDeCierre | undefined,
    limite: number,
  ): Promise<CierreDeCuentaRow[]> {
    const ids = await idsQueCasan(this.prisma, busqueda);
    if (ids !== undefined && ids.length === 0) return [];
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["origenId"],
      where: {
        mensajeroId, // R11/R12: SOLO los cierres con movimientos en ESTE mensajero
        origenTipo: "cierre_dia",
        origenId: ids === undefined ? { not: null } : { in: ids },
      },
      _max: { fechaMovimiento: true },
      _count: { _all: true },
      orderBy: [{ _max: { fechaMovimiento: "desc" } }, { origenId: "desc" }],
      take: limite,
    });
    return this.conMensajero(grupos);
  }

  /** Nombre y dia de cada cierre de la pagina, en UNA consulta; conserva el orden del `groupBy`. */
  private async conMensajero(grupos: readonly GrupoDeCierre[]): Promise<CierreDeCuentaRow[]> {
    const ids = grupos.map((g) => g.origenId).filter((id): id is string => id !== null);
    if (ids.length === 0) return [];
    const cierres = await this.prisma.cierreDia.findMany({
      where: { id: { in: ids } },
      select: { id: true, solicitadoAt: true, mensajero: { select: CUENTA_USUARIO_SELECT } },
    });
    const porId = new Map(cierres.map((c) => [c.id, c]));
    const filas: CierreDeCuentaRow[] = [];
    for (const g of grupos) {
      const c = g.origenId === null ? undefined : porId.get(g.origenId);
      // Un `origen_id` de cierre sin su cierre no deberia existir (FK logica del feed); si pasara, la
      // opcion se omite en vez de viajar sin dia ni mensajero.
      if (c === undefined) continue;
      filas.push({
        cierreId: c.id,
        solicitadoAt: c.solicitadoAt.toISOString(),
        mensajero: etiquetaDeCuenta(c.mensajero),
        movimientos: g._count._all,
      });
    }
    return filas;
  }
}
