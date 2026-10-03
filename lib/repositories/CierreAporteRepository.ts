import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AlcanceDeCierre,
  CabeceraDeCierre,
  FiltroAportesEnLote,
  FiltroCierresDondeAporta,
  FiltroOrdenesQueAportan,
  ICierreAporteRepository,
  OrdenAporteEnLoteRow,
  OrdenAporteRow,
} from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { CriterioDeAporte } from "@/lib/utils/aporte-por-orden";
import { DETALLE_SELECT, tarifaDe, type CierreDetalleRow } from "@/lib/utils/cierre-detalle";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";
import type { PaginaRepositorio } from "@/lib/utils/rango-pagina";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletMovimientoRepository).
type CierreAportePrismaClient = Pick<PrismaClient, "cierreDetail" | "cierreDia">;

/**
 * Ficha 344 (T3.1, design §3.4) — el `WHERE` del detalle, TRADUCIDO del criterio.
 *
 * Aqui no se decide nada: los cinco hechos del criterio son columnas y esta funcion los escribe
 * en el lenguaje de Prisma. La otra forma del mismo criterio es `satisfaceCriterio`, y las dos
 * se atan con el test de equivalencia exhaustivo. NUNCA se anade aqui una condicion que el
 * criterio no declare: seria una segunda definicion, que es lo que R18 prohibe.
 *
 * DOS DECISIONES QUE HAY QUE LEER ANTES DE TOCAR ESTO:
 *
 * 1. **La subconsulta sobre `gestiones` lleva `{ cierreId, resultado }` y NADA MAS. Sin
 *    `anuladaAt: null`.** El feed que produjo el importe consulta
 *    `gestionOrden.findMany({ where: { cierreId } })`, sin esa clausula. Anadirla «por
 *    prudencia» seria un criterio que el PRODUCTOR no tiene: una gestion anulada despues de
 *    aprobar el cierre seguiria dentro del importe y desapareceria del detalle, y la suma
 *    dejaria de cuadrar. Se replica el `where` del feed, exactamente.
 *
 * 2. **`tiendaId` se escribe AL FINAL, despues de todo spread.** Es la convencion que este repo
 *    ya tiene escrita para el ledger de la tienda: aunque manana alguien anadiera un spread
 *    encima, esta linea lo pisa. Un fallo aqui no devuelve menos filas: devuelve las ordenes de
 *    OTRA tienda.
 */
function buildWhere(
  cierreId: string,
  criterio: CriterioDeAporte,
  tiendaId: string | undefined,
): Prisma.CierreDetailWhereInput {
  return {
    cierreId,
    ...(criterio.exigeTarifa ? { tarifaId: { not: null } } : {}),
    ...(criterio.exigeCobraComision ? { cobraComision: true } : {}),
    // Supresion de los aportes en cero (Q2): `monto_cobrar > 0` excluye tambien el NULL, que es
    // lo correcto —sin COD no hay comision que cobrar—. Va en el `WHERE`, no en memoria, para
    // que el `count` cuente EXACTAMENTE las filas que se muestran (R28).
    ...(criterio.exigeMontoCobrar ? { montoCobrar: { gt: 0 } } : {}),
    // EXISTS de SQL, no un filtro en memoria (R21): la orden entra si ALGUNA de sus gestiones
    // de ESTE cierre casa con el criterio.
    orden: {
      gestiones: {
        some: {
          cierreId,
          resultado: { in: [...criterio.resultados] },
          ...(criterio.exigeMontoRecibido ? { montoRecibido: { gt: 0 } } : {}),
          // FICHA 468 (design §2.2): la supresion de ceros de los dos snapshots por gestion, DENTRO del
          // mismo `some` correlacionado con el cierre (la gestion que aporta es la de ESTE cierre).
          ...(criterio.exigePagoMensajero ? { pagoMensajero: { gt: 0 } } : {}),
          ...(criterio.exigeIndemnizacion ? { indemnizacion: { gt: 0 } } : {}),
        },
      },
    },
    ...(tiendaId !== undefined ? { tiendaId } : {}), // AL FINAL: nada lo puede pisar
  };
}

/**
 * Ficha 344 (T3.2, design §3.4, R30) — el orden es TOTAL.
 *
 * Se ordena por el numero de guia CONGELADO (que es lo que la pantalla ensena) y se desempata
 * por `id`, que es unico: sin ese desempate, dos filas con la misma guia congelada quedan en
 * orden indefinido y paginar repite u omite una orden. `nulls: "last"` porque `num_guia` es
 * nullable en el snapshot (una orden que nunca genero guia se identifica por su remision).
 *
 * NO se ordena por el aporte: el aporte es DERIVADO y no existe como columna.
 */
const ORDEN_TOTAL = [
  { numGuia: { sort: "asc", nulls: "last" } },
  { id: "asc" },
] as const satisfies readonly Prisma.CierreDetailOrderByWithRelationInput[];

/**
 * Ficha 464 — el orden de las gestiones de una orden en un cierre: el de la 344 (`createdAt`) con
 * `id` como desempate. Lo comparten el detalle de una fila y el lote, para que «Resultado» de una
 * orden con dos gestiones salga igual en la pantalla y en el archivo.
 */
const ORDEN_GESTIONES = [
  { createdAt: "asc" },
  { id: "asc" },
] as const satisfies readonly Prisma.GestionOrdenOrderByWithRelationInput[];

/** La proyeccion de una orden del detalle (sin las gestiones), compartida por fila y lote. */
const SELECT_DE_APORTE = {
  ...DETALLE_SELECT,
  id: true,
  numGuia: true,
  numRemision: true,
  destinatario: true,
  tiendaNombre: true,
} as const;

/**
 * Ficha 464 (design §3) — el `WHERE` del lote: el `OR` de `buildWhere`, una rama por cierre. No se
 * escribe el criterio otra vez; cada rama es la traduccion de siempre, con su `tiendaId` al final.
 */
function whereDelLote(f: FiltroAportesEnLote): Prisma.CierreDetailWhereInput {
  return { OR: f.cierreIds.map((cierreId) => buildWhere(cierreId, f.criterio, f.tiendaId)) };
}

/** Fila del repositorio -> `OrdenAporteRow`, money-safe. La MISMA para la fila y para el lote. */
function aFilaDeAporte(
  d: CierreDetalleRow & {
    numGuia: number | null;
    numRemision: string;
    destinatario: string;
    tiendaNombre: string;
  },
  gestiones: ReadonlyArray<{
    resultado: OrdenAporteRow["gestiones"][number]["resultado"];
    montoRecibido: Prisma.Decimal | null;
    pagoMensajero: Prisma.Decimal | null;
    indemnizacion: Prisma.Decimal | null;
  }>,
): OrdenAporteRow {
  return {
    ordenId: d.ordenId,
    numGuia: d.numGuia,
    numRemision: d.numRemision,
    destinatario: d.destinatario,
    tiendaNombre: d.tiendaNombre,
    orden: {
      esCentral: d.esCentral,
      esZonaEspecial: d.esZonaEspecial,
      // Money-safe: Decimal -> STRING escala 2, nunca number (igual que los dos feeds).
      montoCobrar: d.montoCobrar === null ? null : d.montoCobrar.toFixed(2),
      cobraComision: d.cobraComision,
      // La MISMA reconstruccion que usan los feeds; `null` = sin tarifa vigente al
      // solicitar (gap R9 preservado: esa orden no deriva ningun concepto).
      tarifa: tarifaDe(d),
    },
    gestiones: gestiones.map((g) => ({
      resultado: g.resultado,
      montoRecibido: g.montoRecibido === null ? null : g.montoRecibido.toFixed(2),
      // FICHA 468: los dos snapshots que reparten el pago al mensajero y la indemnizacion.
      pagoMensajero: g.pagoMensajero === null ? null : g.pagoMensajero.toFixed(2),
      indemnizacion: g.indemnizacion === null ? null : g.indemnizacion.toFixed(2),
    })),
  };
}

/**
 * Ficha 344 (design §3.4) — repositorio de las ordenes que componen el importe de un movimiento
 * de cierre. SOLO queries Prisma: ni permisos, ni formula, ni recorte en memoria.
 *
 * La proyeccion reutiliza `DETALLE_SELECT` —la MISMA que usan los dos feeds del cierre para
 * derivar— mas lo descriptivo congelado. Si un dia esa proyeccion gana una entrada de la
 * formula, este detalle la gana con ella y no puede quedarse atras.
 */
export class CierreAporteRepository implements ICierreAporteRepository {
  constructor(private readonly prisma: CierreAportePrismaClient) {}

  async listarOrdenesQueAportan(
    f: FiltroOrdenesQueAportan,
  ): Promise<PaginaRepositorio<OrdenAporteRow>> {
    // FICHA 469 (design §4.2): `ordenIds` acota en un `AND` APARTE, sin tocar `buildWhere` (el criterio
    // sigue escrito una sola vez). Sin `ordenIds`, el `where` es exactamente el de siempre.
    const base = buildWhere(f.cierreId, f.criterio, f.tiendaId);
    const where: Prisma.CierreDetailWhereInput =
      f.ordenIds === undefined ? base : { AND: [base, { ordenId: { in: [...f.ordenIds] } }] };

    // R28: la pagina y el TOTAL salen del MISMO `where`, en la misma llamada.
    const [filas, total] = await Promise.all([
      this.prisma.cierreDetail.findMany({
        where,
        select: {
          ...SELECT_DE_APORTE,
          // TODAS las gestiones de esa orden en ESE cierre, no solo las que casan con el
          // criterio: el importe se produjo acumulandolas todas (las que no aportan devuelven
          // un concepto AUSENTE y no suman nada).
          orden: {
            select: {
              gestiones: {
                where: { cierreId: f.cierreId },
                // Orden estable: sin el, Postgres devuelve las gestiones de una orden en el
                // orden que le conviene y la columna «Resultado» de una orden con dos
                // gestiones cambiaria de sitio entre dos lecturas iguales.
                // Ficha 464: + `id` como desempate (dos gestiones de la misma transaccion comparten
                // `created_at`); el detalle en lote usa EXACTAMENTE este orden.
                orderBy: [...ORDEN_GESTIONES],
                select: { resultado: true, montoRecibido: true, pagoMensajero: true, indemnizacion: true },
              },
            },
          },
        },
        orderBy: [...ORDEN_TOTAL],
        skip: f.rango.skip,
        take: f.rango.take,
      }),
      this.prisma.cierreDetail.count({ where }),
    ]);

    return {
      items: filas.map((d) => aFilaDeAporte(d, d.orden.gestiones)),
      total,
    };
  }

  /**
   * Ficha 464 (R37/R40) — el conteo por cierre de un tramo, con el `OR` de `buildWhere` (una rama
   * por cierre). Cada rama exige `cierreId = X`, asi que una fila del cierre X solo puede casar con
   * la rama X: el grupo X cuenta EXACTAMENTE lo que contaria `listarOrdenesQueAportan` para X.
   */
  async contarAportesPorCierre(f: FiltroAportesEnLote): Promise<Map<string, number>> {
    const conteos = new Map<string, number>();
    if (f.cierreIds.length === 0) return conteos;
    const grupos = await this.prisma.cierreDetail.groupBy({
      by: ["cierreId"],
      where: whereDelLote(f),
      _count: { _all: true },
    });
    for (const g of grupos) conteos.set(g.cierreId, g._count._all);
    return conteos;
  }

  /**
   * Ficha 464 (R18/R20/R21) — las filas del tramo en UNA consulta. La proyeccion es la del detalle de
   * una fila + `cierreId`. Las gestiones se piden de TODOS los cierres del tramo (Prisma no puede
   * correlacionar el `where` de una relacion con la fila padre) y aqui se quedan las de SU cierre:
   * es una seleccion de columnas, no un criterio (el criterio ya lo aplico el `WHERE` de la base).
   */
  async listarAportesDeCierres(f: FiltroAportesEnLote): Promise<OrdenAporteEnLoteRow[]> {
    if (f.cierreIds.length === 0) return [];
    const filas = await this.prisma.cierreDetail.findMany({
      where: whereDelLote(f),
      select: {
        ...SELECT_DE_APORTE,
        cierreId: true,
        orden: {
          select: {
            gestiones: {
              where: { cierreId: { in: [...f.cierreIds] } },
              orderBy: [...ORDEN_GESTIONES],
              select: { cierreId: true, resultado: true, montoRecibido: true, pagoMensajero: true, indemnizacion: true },
            },
          },
        },
      },
      orderBy: [{ cierreId: "asc" }, ...ORDEN_TOTAL],
    });
    return filas.map((d) => ({
      ...aFilaDeAporte(
        d,
        d.orden.gestiones.filter((g) => g.cierreId === d.cierreId),
      ),
      cierreId: d.cierreId,
    }));
  }

  /**
   * FICHA 469 (design §2.2) — el `whereDelLote` con la ORDEN fijada en cada rama: `OR` de
   * `(buildWhere(cierre, criterio, tiendaId) AND orden_id = orden)`. La orden va en un `AND` aparte para
   * no tocar `buildWhere` (es un acotamiento, como `tiendaId`, no una condicion del criterio).
   */
  async cierresDondeAporta(f: FiltroCierresDondeAporta): Promise<Array<{ cierreId: string; ordenId: string }>> {
    if (f.pares.length === 0) return [];
    return this.prisma.cierreDetail.findMany({
      where: {
        OR: f.pares.map((p) => ({ AND: [buildWhere(p.cierreId, f.criterio, f.tiendaId), { ordenId: p.ordenId }] })),
      },
      select: { cierreId: true, ordenId: true },
      orderBy: [{ cierreId: "asc" }, { ordenId: "asc" }],
    });
  }

  /** Ficha 464 — las cabeceras de un tramo de cierres, en una consulta. */
  async cabecerasDeCierres(cierreIds: readonly string[]): Promise<Map<string, CabeceraDeCierre>> {
    const cabeceras = new Map<string, CabeceraDeCierre>();
    if (cierreIds.length === 0) return cabeceras;
    const cierres = await this.prisma.cierreDia.findMany({
      where: { id: { in: [...cierreIds] } },
      select: { id: true, solicitadoAt: true, mensajero: { select: NOMBRE_USUARIO_SELECT } },
    });
    for (const c of cierres) {
      cabeceras.set(c.id, {
        fecha: c.solicitadoAt.toISOString(),
        mensajeroNombre: nombreCompletoUsuario(c.mensajero),
      });
    }
    return cabeceras;
  }

  /** R12: el «de 23». Mismo acotamiento por tienda que la pagina, escrito AL FINAL. */
  async contarOrdenesDelCierre(f: AlcanceDeCierre): Promise<number> {
    return this.prisma.cierreDetail.count({
      where: {
        cierreId: f.cierreId,
        ...(f.tiendaId !== undefined ? { tiendaId: f.tiendaId } : {}),
      },
    });
  }

  /** R9/R15: la fecha del cierre y el nombre del mensajero (el servicio decide si viaja). */
  async obtenerCabeceraDeCierre(cierreId: string): Promise<CabeceraDeCierre | null> {
    const cierre = await this.prisma.cierreDia.findUnique({
      where: { id: cierreId },
      select: { solicitadoAt: true, mensajero: { select: NOMBRE_USUARIO_SELECT } },
    });
    if (cierre === null) return null;
    return {
      fecha: cierre.solicitadoAt.toISOString(),
      mensajeroNombre: nombreCompletoUsuario(cierre.mensajero),
    };
  }
}
