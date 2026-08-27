import { Prisma, type PrismaClient } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type {
  GrupoCierrePorEstado,
  IConciliacionCierresAnaliticaRepository,
  LedgerConciliable,
  SnapshotCierreAprobado,
  TipoMovimientoLedger,
  TotalLedgerPorOrigenCierre,
} from "@/lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository";
import type {
  ClaveTotalCierre,
  EstadoCierreAnalitica,
  NivelCierre,
} from "@/lib/types/analitica-financiera";
import { CIERRE_ESTADO_SEED } from "@/lib/types/cierre";

// Feature 127 (T C.4) — repositorio de la CONCILIACION DE CIERRES.
//
// ⟨D10⟩, humano 2026-08-02 (`progress/decision_C2_127.md`) — este es el unico repositorio de la
// feature que toca las CINCO tablas del universo, y puede hacerlo porque el catalogo de la 135
// las declara: la contradiccion R4 ↔ R23 (C2) se cerro ampliando `conciliacion_cierres.fuente.
// tablas` con los tres ledgers, no aflojando el guardia B.3. Cruzar el snapshot aprobado contra
// el dinero realmente movido ES la metrica; sin el ledger, la conciliacion no concilia nada.
//
// ⟨D2(b)⟩ + ⟨D4(b)⟩ / R22 / R25 / R26 / R39 — DOBLE COORDENADA TEMPORAL, y por eso hay CUATRO
// consultas de cierre y no dos. Un cierre `aprobado` se fecha por `resuelto_at`, que es el mismo
// instante en que el feed escribe en los ledgers: las dos caras de la conciliacion miran el
// mismo dia y un descuadre deja de poder ser un artefacto de fechado. Los `solicitado`,
// `vencido` y `rechazado` **no tienen** `resuelto_at` —es NULL en el esquema—, asi que se fechan
// por `solicitado_at`. Una sola consulta con un `OR` los fecharia a todos igual y le atribuiria
// a una fila una coordenada que su cierre no puede tener.
//
// LOS DOS NIVELES, POR SEPARADO (R22). Un `cierre_bodega` consolida varios `cierre_dia`: sumar
// los dos niveles cuenta el mismo dinero dos veces. Aqui no se suman ni se pueden sumar — salen
// etiquetados con su `nivel` y el DTO los publica asi.
//
// EL LADO LEDGER SE FILTRA POR ORIGEN, NO POR RANGO (R23). La Σ se toma sobre los movimientos
// con `origen_tipo = cierre_dia` y `origen_id ∈` los cierres aprobados que la consulta anterior
// devolvio. Comparar contra "todos los movimientos del rango" declararia un descuadre cada vez
// que alguien registrase un ajuste manual dentro de la ventana.
//
// SOLO CONSULTAS (R30): aqui no se resta, no se compara y no se decide si algo cuadra. El
// cuadre, el umbral y la emision por el `ErrorLogger` son del servicio. Sin `try/catch` (R32).
// No se usa `consulta.alcance` (R9). R14: de un cierre sale su `id`, jamas su `mensajero_id`.

/** Cliente Prisma MINIMO: las cinco tablas que ⟨D10⟩ declara, y ninguna mas. */
type ConciliacionPrismaClient = Pick<
  PrismaClient,
  | "cierreDia"
  | "cierreBodega"
  | "walletMovimiento"
  | "walletTiendaMovimiento"
  | "pagoMensajeroMovimiento"
>;

/**
 * El estado que ⟨D2(b)⟩ fecha por `resuelto_at`. Es el UNICO literal de estado del archivo: los
 * otros tres salen del seed (`lib/types/cierre.ts`), que es la fuente unica de la 37. Si el enum
 * ganara un quinto estado, entraria solo por la rama de `solicitado_at`, que es donde tiene que
 * entrar mientras nadie decida otra cosa.
 */
const ESTADO_RESUELTO = "aprobado" as const;

/** Los otros tres, derivados del seed: ni se escriben a mano ni se pueden desincronizar. */
const ESTADOS_NO_RESUELTOS = CIERRE_ESTADO_SEED.filter((e) => e !== ESTADO_RESUELTO);

/**
 * El vinculo cierre ↔ ledger que R23 nombra literalmente: `origen_tipo = cierre_dia`. Es un
 * valor del enum `WalletOrigenTipo` del esquema, compartido por los tres libros, y esta indexado
 * junto con `origen_id` en los tres — que es lo que hace esta conciliacion barata y exacta en
 * vez de heuristica (design.md §2.1 hecho 5).
 */
const ORIGEN_CIERRE_DIA = "cierre_dia" as const;

/**
 * El orden en que se emiten los niveles. Fijo y declarado (R28): la determinacion del orden no
 * puede depender de que dos `Promise.all` resuelvan en el mismo orden dos veces seguidas.
 */
const NIVELES: readonly NivelCierre[] = ["cierre_dia", "cierre_bodega"];

/** Los tres libros, en orden fijo (R28). */
const LEDGERS: readonly LedgerConciliable[] = [
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
];

/** `Decimal | null` -> STRING escala 2 (S1/R27). Nunca pasa por `number`. */
function importe(valor: Prisma.Decimal | null): string {
  return (valor ?? new Prisma.Decimal(0)).toFixed(2);
}

/** Las cuatro columnas snapshot que la conciliacion publica, con su nombre en el DTO. */
interface SumaSnapshot {
  readonly totalEfectivo: Prisma.Decimal | null;
  readonly totalSimpe: Prisma.Decimal | null;
  readonly totalTransferencia: Prisma.Decimal | null;
  readonly totalGeneral: Prisma.Decimal | null;
}

function totales(suma: SumaSnapshot): Readonly<Record<ClaveTotalCierre, string>> {
  return {
    efectivo: importe(suma.totalEfectivo),
    simpe: importe(suma.totalSimpe),
    transferencia: importe(suma.totalTransferencia),
    general: importe(suma.totalGeneral),
  };
}

/**
 * Lo que las cuatro consultas de cierre piden, identico en los dos niveles. Es una FUNCION y no
 * una constante porque Prisma exige arrays mutables en `by`/`orderBy`: compartir el mismo array
 * entre cuatro llamadas dejaria que una de ellas lo modificase para las otras tres.
 */
function agregadoDeCierre() {
  return {
    by: ["estado"] as ["estado"],
    _count: { _all: true as const },
    _sum: {
      totalEfectivo: true as const,
      totalSimpe: true as const,
      totalTransferencia: true as const,
      totalGeneral: true as const,
    },
    orderBy: [{ estado: "asc" as const }],
  };
}

/** La forma que devuelven las cuatro consultas de cierre, sea cual sea el nivel. */
interface GrupoCrudo {
  readonly estado: EstadoCierreAnalitica;
  readonly _count: { readonly _all: number };
  readonly _sum: SumaSnapshot;
}

export class ConciliacionCierresAnaliticaRepository
  implements IConciliacionCierresAnaliticaRepository
{
  constructor(private readonly prisma: ConciliacionPrismaClient) {}

  /**
   * Conteo y `total_*` snapshot por `(nivel, estado)`, con la doble coordenada temporal.
   *
   * Cuatro consultas: aprobados y no resueltos, por cada nivel. El orden de salida es
   * `(nivel, estado)` y no depende del plan de la base: los niveles se recorren en el orden
   * declarado en `NIVELES` y, dentro de cada uno, `aprobado` va primero por ser el menor
   * alfabeticamente entre los cuatro estados y venir de su propia consulta ya ordenada.
   */
  async contarCierresPorEstado(
    consulta: ConsultaAnalitica,
  ): Promise<readonly GrupoCierrePorEstado[]> {
    const { desde, hasta } = consulta.rango;

    const [diaAprobados, diaPendientes, bodegaAprobados, bodegaPendientes] = await Promise.all([
      this.prisma.cierreDia.groupBy({
        ...agregadoDeCierre(),
        where: { estado: ESTADO_RESUELTO, resueltoAt: { gte: desde, lt: hasta } },
      }),
      this.prisma.cierreDia.groupBy({
        ...agregadoDeCierre(),
        where: { estado: { in: [...ESTADOS_NO_RESUELTOS] }, solicitadoAt: { gte: desde, lt: hasta } },
      }),
      this.prisma.cierreBodega.groupBy({
        ...agregadoDeCierre(),
        where: { estado: ESTADO_RESUELTO, resueltoAt: { gte: desde, lt: hasta } },
      }),
      this.prisma.cierreBodega.groupBy({
        ...agregadoDeCierre(),
        where: { estado: { in: [...ESTADOS_NO_RESUELTOS] }, solicitadoAt: { gte: desde, lt: hasta } },
      }),
    ]);

    const porNivel: Readonly<Record<NivelCierre, readonly [GrupoCrudo[], GrupoCrudo[]]>> = {
      cierre_dia: [diaAprobados as GrupoCrudo[], diaPendientes as GrupoCrudo[]],
      cierre_bodega: [bodegaAprobados as GrupoCrudo[], bodegaPendientes as GrupoCrudo[]],
    };

    const filas: GrupoCierrePorEstado[] = [];
    for (const nivel of NIVELES) {
      const [aprobados, pendientes] = porNivel[nivel];
      for (const g of aprobados) {
        filas.push(fila(nivel, g, "resuelto_at"));
      }
      for (const g of pendientes) {
        filas.push(fila(nivel, g, "solicitado_at"));
      }
    }
    return filas;
  }

  /**
   * El lado SNAPSHOT del cuadre: los `cierre_dia` aprobados del rango con su `total_general`.
   *
   * Es tambien la fuente de los `origen_id` que alimentan el otro lado. `select` explicito con
   * DOS columnas: de un cierre sale su `id`, nunca su `mensajero_id` (R14), y un `findMany`
   * sin `select` lo traeria entero. `orderBy` por `id` para que la secuencia sea reproducible
   * (R28) — el `id` es la unica columna que garantiza unicidad.
   */
  async totalesDeCierresAprobados(
    consulta: ConsultaAnalitica,
  ): Promise<readonly SnapshotCierreAprobado[]> {
    const filas = await this.prisma.cierreDia.findMany({
      where: {
        estado: ESTADO_RESUELTO,
        resueltoAt: { gte: consulta.rango.desde, lt: consulta.rango.hasta },
      },
      select: { id: true, totalGeneral: true },
      orderBy: { id: "asc" },
    });

    return filas.map((f) => ({ cierreId: f.id, totalGeneral: importe(f.totalGeneral) }));
  }

  /**
   * El lado LEDGER: Σ `monto` por `(libro, cierre, tipo)` de los movimientos con
   * `origen_tipo = cierre_dia` y `origen_id` entre los cierres aprobados que se le pasan.
   *
   * Con la lista VACIA no consulta y devuelve `[]`: sin ids que buscar no hay nada que
   * preguntarle a la base, y un `in: []` seria una consulta que siempre devuelve vacio pero
   * igual va y vuelve.
   *
   * El desglose por `tipo` es lo que hace comparable el resultado (S15): un cierre aprobado deja
   * en el libro de tienda el CREDITO del COD *y* los debitos de flete, comision e IVA, y la Σ de
   * todo junto no mide lo mismo que `total_general`. Que lado se compara con que es decision del
   * servicio; aqui solo se entrega el material.
   */
  async sumarLedgerPorOrigenDeCierre(
    consulta: ConsultaAnalitica,
    cierreIds: readonly string[],
  ): Promise<readonly TotalLedgerPorOrigenCierre[]> {
    if (cierreIds.length === 0) return [];

    const where = { origenTipo: ORIGEN_CIERRE_DIA, origenId: { in: [...cierreIds] } };
    const agregado = () => ({
      by: ["origenId", "tipo"] as ["origenId", "tipo"],
      where,
      _sum: { monto: true as const },
      orderBy: [{ origenId: "asc" as const }, { tipo: "asc" as const }],
    });

    /**
     * Feature 293 (T2.4, design §6/16, R28) — EL LIBRO DEL MENSAJERO EXCLUYE EL PREMIO.
     *
     * Esta conciliacion compara el SNAPSHOT del cierre contra lo que ese cierre movio **al
     * aprobarse**. El premio del ranking nace DESPUES, por un acto humano, y NO esta en el
     * snapshot: sin este filtro cada premio declararia un descuadre FALSO —y dispararia el aviso
     * del servicio— cada vez que alguien pagara uno.
     *
     * Se excluyen las DOS categorias del mundo del premio, no solo una: si se dejara fuera
     * `premio_ranking` pero entrara su compensacion (`ajuste_pago` con `premio_dia`), anular un
     * premio restaria del lado ledger un dinero que el snapshot nunca conto — el mismo descuadre
     * falso con el signo contrario. El `premioDia: { not: null }` es lo que separa esa
     * compensacion de un `ajuste_pago` cualquiera, que SI debe seguir contando.
     *
     * Los otros dos libros no llevan filtro: el premio no les escribe ni una fila (su egreso de
     * caja va con `origen_tipo = 'ranking_snapshot_fila'`, que este WHERE ya deja fuera).
     */
    const agregadoDelMensajero = () => ({
      ...agregado(),
      where: {
        ...where,
        // `NOT: { OR: [...] }` y NO `NOT: [a, b]`: el primero es `¬a AND ¬b` en cualquier
        // lectura; el segundo depende de como se interprete un `NOT` con lista, y con la lectura
        // «no se cumplen las dos a la vez» el premio se colaria igualmente. Sobre dinero, una
        // ambiguedad de semantica no es un detalle de estilo.
        NOT: {
          OR: [
            { categoria: "premio_ranking" as const },
            { categoria: "ajuste_pago" as const, premioDia: { not: null } },
          ],
        },
      },
    });

    const [caja, tienda, mensajero] = await Promise.all([
      this.prisma.walletMovimiento.groupBy(agregado()),
      this.prisma.walletTiendaMovimiento.groupBy(agregado()),
      this.prisma.pagoMensajeroMovimiento.groupBy(agregadoDelMensajero()),
    ]);

    const porLedger: Readonly<Record<LedgerConciliable, readonly GrupoLedgerCrudo[]>> = {
      wallet_movimiento: caja as readonly GrupoLedgerCrudo[],
      wallet_tienda_movimiento: tienda as readonly GrupoLedgerCrudo[],
      pago_mensajero_movimiento: mensajero as readonly GrupoLedgerCrudo[],
    };

    const filas: TotalLedgerPorOrigenCierre[] = [];
    for (const ledger of LEDGERS) {
      for (const g of porLedger[ledger]) {
        // `origen_id` es nullable en el esquema (NULL solo en `manual`). El `in` de arriba ya
        // lo excluye; el guardia esta para que un cambio de filtro no meta un `null` como
        // clave de cierre en vez de fallar.
        if (g.origenId === null) continue;
        filas.push({
          ledger,
          cierreId: g.origenId,
          tipo: g.tipo,
          suma: importe(g._sum.monto),
        });
      }
    }
    return filas;
  }
}

/** La forma que devuelven las tres consultas de ledger, sea cual sea el libro. */
interface GrupoLedgerCrudo {
  readonly origenId: string | null;
  readonly tipo: TipoMovimientoLedger;
  readonly _sum: { readonly monto: Prisma.Decimal | null };
}

/** Una fila del DTO a partir de un grupo crudo y de la coordenada con la que se selecciono. */
function fila(
  nivel: NivelCierre,
  grupo: GrupoCrudo,
  fechadoPor: GrupoCierrePorEstado["fechadoPor"],
): GrupoCierrePorEstado {
  return {
    nivel,
    estado: grupo.estado,
    cantidad: grupo._count._all,
    totales: totales(grupo._sum),
    fechadoPor,
  };
}
