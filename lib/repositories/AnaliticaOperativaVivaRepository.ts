import { Prisma, type GestionCausaDevolucion, type PrismaClient } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { AlcanceDatos } from "@/lib/analytics/alcance";
import type { VentanaDia } from "@/lib/analytics/rollup-dia";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";
import { DIMENSION_AGREGADA } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import type { CuboRollup } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import type {
  AgingPorEstadoFila,
  CubosDelDiaEnCurso,
  EntregaVigenteOperativa,
  IAnaliticaOperativaVivaRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaVivaRepository";

// Feature 126 (T5.1/T6.2, design §D6/§D13) — LECTOR DE LAS TABLAS VIVAS.
//
// Dos trabajos, ninguno de los cuales toca `analytics_daily` (R17; D11 deja escrito que D13
// NO amplia la apertura del guardia R42):
//   1. `agingPorEstado` — la unica metrica `clase: "live"` del catalogo.
//   2. `cubosDelDiaEnCurso` — el dia abierto, que por construccion no esta en el rollup.
//
// R2 — SOLO LECTURA. Ni un `INSERT`, `UPDATE` ni `DELETE` sobre `orden`, `gestion_orden` ni
// `orden_historial_estado`.
//
// R4/R18-de-la-122 — el alcance se empuja al `WHERE` (`fragmentoDeAlcance`), NUNCA a un
// filtro en memoria: el `where` es la frontera multi-tenant y filtrar despues es una capa mas
// de la que fiarse. Esto es exactamente lo que D13 compro al descartar el reuso del
// repositorio de la 124 (sus seis consultas son plantillas `$queryRaw` cerradas sobre
// `VentanaDia`, sin costura para inyectar un `where`).
//
// D3 — LA COLUMNA DEL RECORTE ES SIEMPRE LA DE `orden`: `o.zona_id`, `o.tienda_id` y
// `o.mensajero_asignado_id`. `gestion_orden.mensajero_id` existe, es NOT NULL y esta a mano,
// y aun asi NO se usa para RECORTAR: recortar gestiones por su propio actor daria un recorte
// distinto al de la orden. Que si sale de la gestion es la COORDENADA de las cinco medidas de
// gestion, porque asi lo hace el job de la 124 (Q3) y R33 exige reproducirlo exactamente.
// Recorte y coordenada son dos cosas distintas y aqui no se confunden.
//
// LAS DEFINICIONES SON LAS DE LA 124, LITERALMENTE. Cada consulta de abajo nombra la Q
// equivalente de `AnaliticaRollupRepository`. El precio de D13 son dos implementaciones de
// las mismas definiciones, y su contencion es `analitica-operativa-equivalencia.test.ts`
// (R33): sobre una fecha ya cerrada, esto debe reproducir cubo a cubo y medida a medida lo
// que el job escribio. Si diverge, el problema esta AQUI.

/** Cliente Prisma MINIMO consumido: solo SQL crudo (patron de la 124). */
type AnaliticaOperativaVivaPrismaClient = Pick<PrismaClient, "$queryRaw">;

/** Los `value` TERMINALES del catalogo, importados del dominio y no reescritos. */
const TERMINALES = Prisma.join([...ESTADOS_TERMINALES]);

/**
 * D1→A2 de la 124 — el ESTATUS CONGELADO. Ultima transicion de cada orden con
 * `created_at < corte`, cota ESTRICTA: el corte diario escribe sus transiciones
 * `corte_sin_gestionar` EXACTAMENTE en `corte` y esas pertenecen al dia siguiente.
 *
 * El desempate `ORDER BY orden_id, created_at DESC, id DESC` no es defensivo: sin el, dos
 * filas con el mismo `created_at` harian el `DISTINCT ON` no determinista.
 */
function cteEstatusAlCorte(corte: Date): Prisma.Sql {
  return Prisma.sql`
    estatus_al_corte AS (
      SELECT DISTINCT ON (h."orden_id")
             h."orden_id"            AS orden_id,
             h."estatus_destino_id"  AS estatus_id
      FROM "orden_historial_estado" h
      WHERE h."created_at" < ${corte}
      ORDER BY h."orden_id", h."created_at" DESC, h."id" DESC
    )`;
}

/** Ordenes que llegaron a un estado TERMINAL dentro de la ventana (rama 2 del universo B2). */
function cteTerminalEnVentana(ventana: VentanaDia): Prisma.Sql {
  return Prisma.sql`
    terminal_en_ventana AS (
      SELECT DISTINCT h."orden_id" AS orden_id
      FROM "orden_historial_estado" h
      JOIN "order_status" s ON s."id" = h."estatus_destino_id"
      WHERE h."created_at" >= ${ventana.desde}
        AND h."created_at" <  ${ventana.hasta}
        AND s."value" IN (${TERMINALES})
    )`;
}

/**
 * EL RECORTE MULTI-TENANT, sobre el alias `o` de `orden`. Las tres columnas canonicas de D3 y
 * ninguna otra; `global` no anade condicion porque el resolutor solo lo emite cuando la
 * metrica declara `total` para el rol.
 *
 * NO se reusa `whereOrden` de `alcance-columnas.ts` porque aquello produce un
 * `Prisma.OrdenWhereInput` (query builder) y esto es SQL crudo: son dos lenguajes. Lo que si
 * se conserva es su decision —QUE columna encarna cada recorte—, citada arriba en D3.
 */
function fragmentoDeAlcance(alcance: AlcanceDatos): Prisma.Sql {
  switch (alcance.tipo) {
    case "global":
      return Prisma.sql`TRUE`;
    case "zona":
      return Prisma.sql`o."zona_id" = ${alcance.zonaId}`;
    case "tienda":
      return Prisma.sql`o."tienda_id" = ${alcance.tiendaId}`;
    // R22 — un unico id, jamas `OR o."mensajero_asignado_id" IS NULL`: el cubo sin asignar
    // NO es «propio» de ningun mensajero (R28 de la 122).
    case "mensajero":
      return Prisma.sql`o."mensajero_asignado_id" = ${alcance.mensajeroId}`;
  }
}

/**
 * El filtro del cliente, YA INTERSECADO con el alcance por la 122. Se escribe igualmente en
 * el `WHERE` (cinturon y tirantes): aunque el alcance ya lo acote, el usuario puede haber
 * pedido un subconjunto y ese subconjunto tambien se respeta.
 */
function fragmentoDeFiltro(consulta: ConsultaAnalitica): Prisma.Sql {
  const { filtro } = consulta;
  const trozos: Prisma.Sql[] = [fragmentoDeAlcance(consulta.alcance)];
  if (filtro.zona_id) trozos.push(Prisma.sql`o."zona_id" IN (${Prisma.join([...filtro.zona_id])})`);
  if (filtro.tienda_id) {
    trozos.push(Prisma.sql`o."tienda_id" IN (${Prisma.join([...filtro.tienda_id])})`);
  }
  if (filtro.mensajero_id) {
    trozos.push(
      Prisma.sql`o."mensajero_asignado_id" IN (${Prisma.join([...filtro.mensajero_id])})`,
    );
  }
  return Prisma.join(trozos, " AND ");
}

interface FilaOrdenRow {
  zona_id: string;
  tienda_id: string;
  mensajero_id: string | null;
  estatus_id: string;
  n: number;
}

interface FilaGestionRow {
  zona_id: string;
  tienda_id: string;
  mensajero_id: string;
  estatus_id: string;
  causa_devolucion: GestionCausaDevolucion | null;
  entregas: number;
  devoluciones: number;
  rechazos: number;
  reprogramaciones: number;
  incidentes: number;
}

interface FilaEntregaRow {
  orden_id: string;
  zona_id: string;
  tienda_id: string;
  mensajero_id: string;
  estatus_id: string;
}

interface FilaCicloRow {
  zona_id: string;
  tienda_id: string;
  mensajero_id: string | null;
  estatus_id: string;
  seg_ciclo_acum: bigint;
  seg_ciclo_n: number;
}

interface FilaAgingRow {
  estatus_id: string;
  zona_id: string;
  tienda_id: string;
  ordenes: number;
  seg_en_estado_acum: bigint;
}

/** Separador y marca de nulo del merge de cubos: no aparecen en un uuid ni en un enum. */
const SEP = "\u001f";
const NULO = "\u0000";

interface ClaveCubo {
  readonly zonaId: string;
  readonly tiendaId: string;
  readonly mensajeroId: string | null;
  readonly estatusId: string;
  readonly causaDevolucion: GestionCausaDevolucion | null;
}

function clave(c: ClaveCubo): string {
  return [c.zonaId, c.tiendaId, c.mensajeroId ?? NULO, c.estatusId, c.causaDevolucion ?? NULO].join(
    SEP,
  );
}

type CuboMutable = { -readonly [K in keyof CuboRollup]: CuboRollup[K] };

function cuboVacio(fecha: string, c: ClaveCubo): CuboMutable {
  return {
    fecha,
    zonaId: c.zonaId,
    tiendaId: c.tiendaId,
    mensajeroId: c.mensajeroId,
    estatusId: c.estatusId,
    causaDevolucion: c.causaDevolucion,
    ordenesCreadas: 0,
    ordenesEstadoStock: 0,
    entregas: 0,
    devoluciones: 0,
    rechazos: 0,
    reprogramaciones: 0,
    incidentes: 0,
    // `primerIntentoOk` lo completa el SERVICIO con el criterio unico de la feature 160: aqui
    // reimplementarlo seria una TERCERA copia de una definicion (ver la interfaz).
    primerIntentoOk: 0,
    // `BigInt(0)` y no `0n`: el `target` del repo es ES2017.
    segCicloAcum: BigInt(0),
    segCicloN: 0,
  };
}

function tieneAlgunaMedida(f: CuboRollup): boolean {
  return (
    f.ordenesCreadas > 0 ||
    f.ordenesEstadoStock > 0 ||
    f.entregas > 0 ||
    f.devoluciones > 0 ||
    f.rechazos > 0 ||
    f.reprogramaciones > 0 ||
    f.incidentes > 0 ||
    f.primerIntentoOk > 0 ||
    f.segCicloN > 0 ||
    f.segCicloAcum > BigInt(0)
  );
}

export class AnaliticaOperativaVivaRepository implements IAnaliticaOperativaVivaRepository {
  constructor(private readonly prisma: AnaliticaOperativaVivaPrismaClient) {}

  /**
   * R17 — `aging_por_estado`: cuantas ordenes VIVAS hay en cada estado y cuantos segundos
   * llevan en el estado ACTUAL, al corte.
   *
   * Se apoya en `@@index([ordenId, createdAt])` de `orden_historial_estado`
   * (`db/schema.prisma`), que ya existe: el `DISTINCT ON (orden_id) ... ORDER BY created_at
   * DESC` es exactamente su forma. Por eso R25 no pide indice para esta tabla.
   *
   * «Vivas» = estatus al corte NO terminal. Una orden entregada no esta «envejeciendo».
   */
  async agingPorEstado(
    consulta: ConsultaAnalitica,
    corteAt: Date,
  ): Promise<readonly AgingPorEstadoFila[]> {
    const filas = await this.prisma.$queryRaw<FilaAgingRow[]>`
      WITH ultima_transicion AS (
        SELECT DISTINCT ON (h."orden_id")
               h."orden_id"           AS orden_id,
               h."estatus_destino_id" AS estatus_id,
               h."created_at"         AS desde_at
        FROM "orden_historial_estado" h
        WHERE h."created_at" < ${corteAt}
        ORDER BY h."orden_id", h."created_at" DESC, h."id" DESC
      )
      SELECT u.estatus_id                AS estatus_id,
             o."zona_id"                 AS zona_id,
             o."tienda_id"               AS tienda_id,
             COUNT(*)::int               AS ordenes,
             SUM(EXTRACT(EPOCH FROM (${corteAt}::timestamptz - u.desde_at))::bigint)::bigint
                                         AS seg_en_estado_acum
      FROM ultima_transicion u
      JOIN "orden" o        ON o."id" = u.orden_id
      JOIN "order_status" s ON s."id" = u.estatus_id
      WHERE o."deleted_at" IS NULL
        AND s."value" NOT IN (${TERMINALES})
        AND ${fragmentoDeFiltro(consulta)}
      GROUP BY 1, 2, 3`;
    return filas.map((f) => ({
      estatusId: f.estatus_id,
      zonaId: f.zona_id,
      tiendaId: f.tienda_id,
      ordenes: Number(f.ordenes),
      segEnEstadoAcum: BigInt(f.seg_en_estado_acum),
    }));
  }

  /**
   * D6/D13 — los cubos del dia en curso, con las MISMAS definiciones de la 124 (Q1, Q2, Q3,
   * Q4 y Q5) y el alcance en el `WHERE`.
   *
   * El merge es el mismo que hace `AnaliticaRollupService.componerFilas`: las medidas de
   * ORDEN entran con `causaDevolucion: null` y las de GESTION con la causa que informa Q3,
   * de modo que un mensajero que el mismo dia entrega y devuelve produce DOS cubos. Los
   * cubos sin ninguna medida se descartan (R46 de la 124), igual que el job.
   */
  async cubosDelDiaEnCurso(
    consulta: ConsultaAnalitica,
    ventana: VentanaDia,
  ): Promise<CubosDelDiaEnCurso> {
    // La fecha del cubo es la del DIA de la ventana, derivada de su cota inferior, que es la
    // medianoche CR: `desde` lleva las 06:00 UTC dentro, asi que la fecha calendario CR es la
    // parte de fecha de `desde` en UTC. No se reimplementa aritmetica horaria (D7).
    const fecha = ventana.desde.toISOString().slice(0, 10);

    const [creadas, stock, gestiones, ciclos, entregas] = await Promise.all([
      this.contarOrdenesCreadas(consulta, ventana),
      this.contarOrdenesEnEstadoAlCorte(consulta, ventana),
      this.contarGestionesVigentes(consulta, ventana),
      this.acumularCiclosCerrados(consulta, ventana),
      this.listarEntregasVigentes(consulta, ventana),
    ]);

    const cubos = new Map<string, CuboMutable>();
    const obtener = (c: ClaveCubo): CuboMutable => {
      const k = clave(c);
      const existente = cubos.get(k);
      if (existente !== undefined) return existente;
      const nuevo = cuboVacio(fecha, c);
      cubos.set(k, nuevo);
      return nuevo;
    };

    for (const g of creadas) obtener({ ...g, causaDevolucion: null }).ordenesCreadas += g.n;
    for (const g of stock) obtener({ ...g, causaDevolucion: null }).ordenesEstadoStock += g.n;
    for (const g of gestiones) {
      const cubo = obtener(g);
      cubo.entregas += g.entregas;
      cubo.devoluciones += g.devoluciones;
      cubo.rechazos += g.rechazos;
      cubo.reprogramaciones += g.reprogramaciones;
      cubo.incidentes += g.incidentes;
    }
    for (const g of ciclos) {
      const cubo = obtener({ ...g, causaDevolucion: null });
      cubo.segCicloAcum += g.segCicloAcum;
      cubo.segCicloN += g.segCicloN;
    }

    return { cubos: [...cubos.values()].filter(tieneAlgunaMedida), entregasVigentes: entregas };
  }

  /** Q1 de la 124 (R10) — `ordenes_creadas`: LA ORDEN por su `created_at`, no sus transiciones. */
  private async contarOrdenesCreadas(
    consulta: ConsultaAnalitica,
    ventana: VentanaDia,
  ): Promise<readonly (ClaveCubo & { n: number })[]> {
    const filas = await this.prisma.$queryRaw<FilaOrdenRow[]>`
      WITH ${cteEstatusAlCorte(ventana.hasta)}
      SELECT o."zona_id"               AS zona_id,
             o."tienda_id"             AS tienda_id,
             o."mensajero_asignado_id" AS mensajero_id,
             e.estatus_id              AS estatus_id,
             COUNT(*)::int             AS n
      FROM "orden" o
      JOIN estatus_al_corte e ON e.orden_id = o."id"
      WHERE o."deleted_at" IS NULL
        AND o."created_at" >= ${ventana.desde}
        AND o."created_at" <  ${ventana.hasta}
        AND ${fragmentoDeFiltro(consulta)}
      GROUP BY 1, 2, 3, 4`;
    return filas.map(coordenadasDeOrden);
  }

  /**
   * Q2 de la 124 (R11/R12, universo B2 de D2) — stock al corte: ordenes no terminales al
   * corte MAS las que llegaron a terminal DENTRO de la ventana. Cada orden aporta 1.
   */
  private async contarOrdenesEnEstadoAlCorte(
    consulta: ConsultaAnalitica,
    ventana: VentanaDia,
  ): Promise<readonly (ClaveCubo & { n: number })[]> {
    const filas = await this.prisma.$queryRaw<FilaOrdenRow[]>`
      WITH ${cteEstatusAlCorte(ventana.hasta)},
           ${cteTerminalEnVentana(ventana)}
      SELECT o."zona_id"               AS zona_id,
             o."tienda_id"             AS tienda_id,
             o."mensajero_asignado_id" AS mensajero_id,
             e.estatus_id              AS estatus_id,
             COUNT(*)::int             AS n
      FROM "orden" o
      JOIN estatus_al_corte e ON e.orden_id = o."id"
      JOIN "order_status" s   ON s."id" = e.estatus_id
      WHERE o."deleted_at" IS NULL
        AND (
          s."value" NOT IN (${TERMINALES})
          OR EXISTS (SELECT 1 FROM terminal_en_ventana t WHERE t.orden_id = o."id")
        )
        AND ${fragmentoDeFiltro(consulta)}
      GROUP BY 1, 2, 3, 4`;
    return filas.map(coordenadasDeOrden);
  }

  /**
   * Q3 de la 124 (R13-R16) — las cinco medidas de gestion. Gestiones VIGENTES
   * (`anulada_at IS NULL`) de ordenes no borradas, con `created_at` en la ventana.
   *
   * Zona y tienda salen de la ORDEN; el mensajero, de la GESTION (herencia 135/124). La
   * `causa_devolucion` se informa SOLO en las filas que cuentan `devuelta`.
   *
   * Esta es la consulta que R25 sostiene: filtra `g."created_at"` sin `orden_id` ni
   * `mensajero_id` por delante, y para eso existe `gestion_orden_created_at_idx`.
   */
  private async contarGestionesVigentes(
    consulta: ConsultaAnalitica,
    ventana: VentanaDia,
  ): Promise<readonly (ClaveCubo & FilaMedidasGestion)[]> {
    const filas = await this.prisma.$queryRaw<FilaGestionRow[]>`
      WITH ${cteEstatusAlCorte(ventana.hasta)}
      SELECT o."zona_id"      AS zona_id,
             o."tienda_id"    AS tienda_id,
             g."mensajero_id" AS mensajero_id,
             e.estatus_id     AS estatus_id,
             CASE WHEN g."resultado" = 'devuelta' THEN g."causa_devolucion" END AS causa_devolucion,
             COUNT(*) FILTER (WHERE g."resultado" = 'entregada')::int    AS entregas,
             COUNT(*) FILTER (WHERE g."resultado" = 'devuelta')::int     AS devoluciones,
             COUNT(*) FILTER (WHERE g."resultado" = 'rechazada')::int    AS rechazos,
             COUNT(*) FILTER (WHERE g."resultado" = 'reprogramada')::int AS reprogramaciones,
             COUNT(*) FILTER (WHERE g."resultado" = 'incidente')::int    AS incidentes
      FROM "gestion_orden" g
      JOIN "orden" o          ON o."id" = g."orden_id"
      JOIN estatus_al_corte e ON e.orden_id = g."orden_id"
      WHERE g."anulada_at" IS NULL
        AND o."deleted_at" IS NULL
        AND g."created_at" >= ${ventana.desde}
        AND g."created_at" <  ${ventana.hasta}
        AND ${fragmentoDeFiltro(consulta)}
      GROUP BY 1, 2, 3, 4, 5`;
    return filas.map((f) => ({
      zonaId: f.zona_id,
      tiendaId: f.tienda_id,
      mensajeroId: f.mensajero_id,
      estatusId: f.estatus_id,
      causaDevolucion: f.causa_devolucion,
      entregas: Number(f.entregas),
      devoluciones: Number(f.devoluciones),
      rechazos: Number(f.rechazos),
      reprogramaciones: Number(f.reprogramaciones),
      incidentes: Number(f.incidentes),
    }));
  }

  /** Q4 de la 124 (R17) — una fila POR entrega vigente, con las coordenadas de su cubo. */
  private async listarEntregasVigentes(
    consulta: ConsultaAnalitica,
    ventana: VentanaDia,
  ): Promise<readonly EntregaVigenteOperativa[]> {
    const filas = await this.prisma.$queryRaw<FilaEntregaRow[]>`
      WITH ${cteEstatusAlCorte(ventana.hasta)}
      SELECT g."orden_id"     AS orden_id,
             o."zona_id"      AS zona_id,
             o."tienda_id"    AS tienda_id,
             g."mensajero_id" AS mensajero_id,
             e.estatus_id     AS estatus_id
      FROM "gestion_orden" g
      JOIN "orden" o          ON o."id" = g."orden_id"
      JOIN estatus_al_corte e ON e.orden_id = g."orden_id"
      WHERE g."resultado" = 'entregada'
        AND g."anulada_at" IS NULL
        AND o."deleted_at" IS NULL
        AND g."created_at" >= ${ventana.desde}
        AND g."created_at" <  ${ventana.hasta}
        AND ${fragmentoDeFiltro(consulta)}`;
    return filas.map((f) => ({
      ordenId: f.orden_id,
      zonaId: f.zona_id,
      tiendaId: f.tienda_id,
      mensajeroId: f.mensajero_id,
      estatusId: f.estatus_id,
    }));
  }

  /** Q5 de la 124 (R19/R20) — tiempo de ciclo: numerador y denominador, jamas el promedio. */
  private async acumularCiclosCerrados(
    consulta: ConsultaAnalitica,
    ventana: VentanaDia,
  ): Promise<readonly (ClaveCubo & { segCicloAcum: bigint; segCicloN: number })[]> {
    const filas = await this.prisma.$queryRaw<FilaCicloRow[]>`
      WITH ${cteEstatusAlCorte(ventana.hasta)},
      ultimo_terminal AS (
        SELECT DISTINCT ON (h."orden_id")
               h."orden_id"   AS orden_id,
               h."created_at" AS cerrado_at
        FROM "orden_historial_estado" h
        JOIN "order_status" s ON s."id" = h."estatus_destino_id"
        WHERE h."created_at" >= ${ventana.desde}
          AND h."created_at" <  ${ventana.hasta}
          AND s."value" IN (${TERMINALES})
        ORDER BY h."orden_id", h."created_at" DESC, h."id" DESC
      )
      SELECT o."zona_id"               AS zona_id,
             o."tienda_id"             AS tienda_id,
             o."mensajero_asignado_id" AS mensajero_id,
             e.estatus_id              AS estatus_id,
             SUM(EXTRACT(EPOCH FROM (u.cerrado_at - o."created_at"))::bigint)::bigint AS seg_ciclo_acum,
             COUNT(*)::int             AS seg_ciclo_n
      FROM ultimo_terminal u
      JOIN "orden" o          ON o."id" = u.orden_id
      JOIN estatus_al_corte e ON e.orden_id = u.orden_id
      WHERE o."deleted_at" IS NULL
        AND ${fragmentoDeFiltro(consulta)}
      GROUP BY 1, 2, 3, 4`;
    return filas.map((f) => ({
      zonaId: f.zona_id,
      tiendaId: f.tienda_id,
      mensajeroId: f.mensajero_id,
      estatusId: f.estatus_id,
      causaDevolucion: null,
      segCicloAcum: BigInt(f.seg_ciclo_acum),
      segCicloN: Number(f.seg_ciclo_n),
    }));
  }
}

interface FilaMedidasGestion {
  readonly entregas: number;
  readonly devoluciones: number;
  readonly rechazos: number;
  readonly reprogramaciones: number;
  readonly incidentes: number;
}

/** Las cuatro coordenadas de una medida de ORDEN, tal cual salen del `GROUP BY`. */
function coordenadasDeOrden(f: FilaOrdenRow): ClaveCubo & { n: number } {
  return {
    zonaId: f.zona_id,
    tiendaId: f.tienda_id,
    mensajeroId: f.mensajero_id,
    estatusId: f.estatus_id,
    causaDevolucion: null,
    n: Number(f.n),
  };
}

/** Reexportado para que el guardia de fuente pueda nombrarlo sin importar toda la clase. */
export { DIMENSION_AGREGADA };
