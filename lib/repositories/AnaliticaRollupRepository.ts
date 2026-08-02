import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  EntregaVigente,
  EscrituraFecha,
  GrupoCiclo,
  GrupoEstadoStock,
  GrupoGestiones,
  GrupoOrdenesCreadas,
  IAnaliticaRollupRepository,
  MedidasReconciliables,
  ResultadoEscritura,
} from "@/lib/interfaces/repositories/IAnaliticaRollupRepository";
import { fechaComoDate, type VentanaDia } from "@/lib/analytics/rollup-dia";
import { TIMEOUT_TX_ROLLUP_MS } from "@/lib/config/analitica-rollup";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";

// Feature 124 (design §2/§4/§5) — el UNICO archivo del arbol que toca `analytics_daily`.
// SOLO queries: no hay ni una decision de negocio aqui. Quien funde los cubos, quien valida
// los invariantes y quien decide abortar es `AnaliticaRollupService`, que no habla Prisma.
//
// Las cotas llegan YA resueltas en `VentanaDia` (R5/R6): este archivo no deriva fechas, no
// hace aritmetica de zona horaria y NO importa `startOfDayCR`. `ventana.hasta` es a la vez
// el fin EXCLUSIVO de la ventana y el CORTE del dia (cota ESTRICTA, R24).
//
// Las cinco lecturas de dominio (Q1-Q6) son de SOLO LECTURA (R4): ni un UPDATE, ni un INSERT
// ni un DELETE sobre `orden`, `gestion_orden`, `orden_historial_estado` ni ninguna tabla de
// dinero. Lo unico que este repositorio escribe es el propio rollup.

/** Fila cruda de una medida de ORDEN: las cuatro coordenadas + el conteo. */
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
  causa_devolucion: GrupoGestiones["causaDevolucion"];
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

interface FilaTotalesRow {
  ordenes_creadas: number;
  entregas: number;
  devoluciones: number;
  rechazos: number;
  reprogramaciones: number;
  incidentes: number;
  ordenes_estado_stock: number;
}

interface FilaSumasRow {
  ordenes_creadas: number;
  entregas: number;
  devoluciones: number;
  rechazos: number;
  reprogramaciones: number;
  incidentes: number;
  ordenes_estado_stock: number;
}

/**
 * Los tres `value` TERMINALES del catalogo (`ESTADOS_TERMINALES`), como lista SQL. Se
 * importan del dominio y NO se reescriben aqui: si manana entra un cuarto terminal, el
 * universo B2 (D2) y el tiempo de ciclo lo heredan sin tocar este archivo.
 */
const TERMINALES = Prisma.join([...ESTADOS_TERMINALES]);

/**
 * D1→A2 — el ESTATUS CONGELADO, transversal a Q1, Q2, Q3 y Q5.
 *
 * Ultima transicion de cada orden con `created_at < corte`. La cota es ESTRICTA a proposito:
 * el corte diario escribe sus transiciones `corte_sin_gestionar` a las 00:00:00 CR del dia
 * siguiente, es decir EXACTAMENTE en `corte`, y esas pertenecen al dia siguiente (R24).
 *
 * El desempate `ORDER BY orden_id, created_at DESC, id DESC` NO es defensivo: dos filas con
 * el mismo `created_at` (un `INSERT` en lote) harian el `DISTINCT ON` no determinista y el
 * job dejaria de ser idempotente SIN QUE NADA FALLARA (R12/R27).
 *
 * `orden_historial_estado` es append-only e inmutable (49/R2), asi que esta es la unica
 * coordenada del rollup que se reproduce siempre (design §6).
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
 * Feature 124 — repositorio de agregacion del rollup diario.
 *
 * Cliente Prisma MINIMO consumido (patron `JobRepository` / `ApiKeyRepository`): las cinco
 * consultas van por `$queryRaw` (`DISTINCT ON`, `FILTER`, `EXTRACT(EPOCH)` y el upsert con
 * `ON CONFLICT` no se expresan con el query builder) y la escritura abre UNA transaccion.
 */
type AnaliticaRollupPrismaClient = Pick<PrismaClient, "$queryRaw" | "$transaction">;

export class AnaliticaRollupRepository implements IAnaliticaRollupRepository {
  constructor(private readonly prisma: AnaliticaRollupPrismaClient) {}

  /**
   * Q1 (R10) — `ordenes_creadas`. Se cuenta LA ORDEN por su `created_at`, no sus
   * transiciones: una orden con dos filas de historial el mismo dia se contaria dos veces
   * por esa via. Coordenadas de la propia orden + estatus AL CORTE (R22/R23/R24), y
   * `deleted_at IS NULL` (D7).
   */
  async contarOrdenesCreadas(ventana: VentanaDia): Promise<GrupoOrdenesCreadas[]> {
    const filas = await this.prisma.$queryRaw<FilaOrdenRow[]>`
      WITH ${cteEstatusAlCorte(ventana.hasta)}
      SELECT o."zona_id"                AS zona_id,
             o."tienda_id"              AS tienda_id,
             o."mensajero_asignado_id"  AS mensajero_id,
             e.estatus_id               AS estatus_id,
             COUNT(*)::int              AS n
      FROM "orden" o
      JOIN estatus_al_corte e ON e.orden_id = o."id"
      WHERE o."deleted_at" IS NULL
        AND o."created_at" >= ${ventana.desde}
        AND o."created_at" <  ${ventana.hasta}
      GROUP BY 1, 2, 3, 4`;
    return filas.map((f) => ({ ...coordenadasDeOrden(f), ordenesCreadas: Number(f.n) }));
  }

  /**
   * Q2 (R11/R12, universo B2 de D2) — stock al corte. El universo es la UNION de:
   *   (a) ordenes no borradas cuyo estatus al corte NO es terminal, y
   *   (b) ordenes no borradas que llegaron a un terminal DENTRO de la ventana.
   * Cada orden aporta EXACTAMENTE 1, en su estatus de CIERRE. La rama (b) existe para que el
   * dia en que una orden cierra no desaparezca del embudo sin dejar rastro; la (a) es lo que
   * impide que cada dia re-fotografie el archivo historico completo (alternativa B1).
   */
  async contarOrdenesEnEstadoAlCorte(ventana: VentanaDia): Promise<GrupoEstadoStock[]> {
    const filas = await this.prisma.$queryRaw<FilaOrdenRow[]>`
      WITH ${cteEstatusAlCorte(ventana.hasta)},
           ${cteTerminalEnVentana(ventana)}
      SELECT o."zona_id"                AS zona_id,
             o."tienda_id"              AS tienda_id,
             o."mensajero_asignado_id"  AS mensajero_id,
             e.estatus_id               AS estatus_id,
             COUNT(*)::int              AS n
      FROM "orden" o
      JOIN estatus_al_corte e ON e.orden_id = o."id"
      JOIN "order_status" s   ON s."id" = e.estatus_id
      WHERE o."deleted_at" IS NULL
        AND (
          s."value" NOT IN (${TERMINALES})
          OR EXISTS (SELECT 1 FROM terminal_en_ventana t WHERE t.orden_id = o."id")
        )
      GROUP BY 1, 2, 3, 4`;
    return filas.map((f) => ({ ...coordenadasDeOrden(f), ordenesEstadoStock: Number(f.n) }));
  }

  /**
   * Q3 (R13/R14/R15/R16) — las cinco medidas de gestion. Gestiones VIGENTES
   * (`anulada_at IS NULL`) de ordenes NO borradas, con `created_at` en la ventana.
   *
   * Zona y tienda salen de la ORDEN, nunca del usuario que gestiono (R22): el caso «orden de
   * la zona A gestionada por un mensajero de la zona B» tiene que escribir la zona A. El
   * mensajero, en cambio, sale de la GESTION (R23) y es `NOT NULL`, asi que por esta via el
   * cubo sin asignar no puede aparecer.
   *
   * `causa_devolucion` se informa SOLO en las filas que cuentan `devuelta` (R15): el `CASE`
   * la anula en el resto, y por eso un mensajero que el mismo dia entrega y devuelve produce
   * DOS filas. Una `devuelta` sin causa tipificada produce `NULL`, nunca un cubo «otro».
   */
  async contarGestionesVigentes(ventana: VentanaDia): Promise<GrupoGestiones[]> {
    const filas = await this.prisma.$queryRaw<FilaGestionRow[]>`
      WITH ${cteEstatusAlCorte(ventana.hasta)}
      SELECT o."zona_id"     AS zona_id,
             o."tienda_id"   AS tienda_id,
             g."mensajero_id" AS mensajero_id,
             e.estatus_id    AS estatus_id,
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

  /**
   * Q4 (R17) — una fila POR GESTION vigente de resultado `entregada` del dia, con las MISMAS
   * coordenadas que su fila de `entregas` en Q3. Aqui NO se decide que es un «primer
   * intento»: ese criterio es el punto unico de la feature 160 y lo aplica el servicio
   * llamando a `contarIntentosEnLote`. Este archivo no tiene ni un `COUNT` propio sobre
   * `orden_historial_estado` para eso (alternativa 11 descartada en design §11).
   */
  async listarEntregasVigentes(ventana: VentanaDia): Promise<EntregaVigente[]> {
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
        AND g."created_at" <  ${ventana.hasta}`;
    return filas.map((f) => ({
      ordenId: f.orden_id,
      zonaId: f.zona_id,
      tiendaId: f.tienda_id,
      mensajeroId: f.mensajero_id,
      estatusId: f.estatus_id,
    }));
  }

  /**
   * Q5 (R19/R20) — tiempo de ciclo: numerador y denominador, jamas el promedio.
   *
   * Aporta la orden cuya transicion a un `ESTADOS_TERMINALES` cae en la ventana, atribuida a
   * la fecha del EVENTO TERMINAL y nunca a la de su creacion. UNA sola contribucion por orden
   * y fecha: el `DISTINCT ON` se queda con la ULTIMA transicion terminal del dia, asi que el
   * caso «entra a terminal, se revierte y vuelve el mismo dia» sigue dando `n = 1`.
   */
  async acumularCiclosCerrados(ventana: VentanaDia): Promise<GrupoCiclo[]> {
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
      GROUP BY 1, 2, 3, 4`;
    return filas.map((f) => ({
      zonaId: f.zona_id,
      tiendaId: f.tienda_id,
      mensajeroId: f.mensajero_id,
      estatusId: f.estatus_id,
      segCicloAcum: BigInt(f.seg_ciclo_acum),
      segCicloN: Number(f.seg_ciclo_n),
    }));
  }

  /**
   * Q6 (R34, design §4.7) — los SIETE escalares del dia, por un camino DISTINTO al de Q1-Q5.
   *
   * No es «la misma consulta sin `GROUP BY`»: donde Q1-Q5 hacen `JOIN` contra la CTE del
   * estatus congelado, esta version usa subconsultas ESCALARES correlacionadas y `EXISTS`.
   * Sin un solo `JOIN` no hay fan-out posible, que es justo el fallo silencioso que la
   * reconciliacion existe para cazar: si un `JOIN` de Q1-Q5 multiplicara filas, este camino
   * no lo haria y los dos numeros dejarian de coincidir.
   */
  async totalesDeControl(ventana: VentanaDia): Promise<MedidasReconciliables> {
    const corte = ventana.hasta;
    const desde = ventana.desde;
    // Estatus al corte de `o`, como VALUE del catalogo, por subconsulta escalar.
    const valueAlCorte = Prisma.sql`(
      SELECT s."value"
      FROM "orden_historial_estado" x
      JOIN "order_status" s ON s."id" = x."estatus_destino_id"
      WHERE x."orden_id" = o."id" AND x."created_at" < ${corte}
      ORDER BY x."created_at" DESC, x."id" DESC
      LIMIT 1
    )`;
    // Misma condicion de existencia que el `JOIN` de Q1-Q5: sin transicion anterior al corte
    // la orden no tiene coordenada de estatus y por tanto no entra en ningun cubo.
    const tieneEstatusAlCorte = Prisma.sql`EXISTS (
      SELECT 1 FROM "orden_historial_estado" x
      WHERE x."orden_id" = o."id" AND x."created_at" < ${corte}
    )`;
    const cerroEnLaVentana = Prisma.sql`EXISTS (
      SELECT 1
      FROM "orden_historial_estado" y
      JOIN "order_status" s2 ON s2."id" = y."estatus_destino_id"
      WHERE y."orden_id" = o."id"
        AND y."created_at" >= ${desde} AND y."created_at" < ${corte}
        AND s2."value" IN (${TERMINALES})
    )`;
    const gestionesDe = (resultado: string): Prisma.Sql => Prisma.sql`(
      SELECT COUNT(*)::int
      FROM "gestion_orden" g
      WHERE g."anulada_at" IS NULL
        AND g."created_at" >= ${desde} AND g."created_at" < ${corte}
        AND g."resultado"::text = ${resultado}
        AND EXISTS (
          SELECT 1 FROM "orden" o
          WHERE o."id" = g."orden_id" AND o."deleted_at" IS NULL AND ${tieneEstatusAlCorte}
        )
    )`;

    const filas = await this.prisma.$queryRaw<FilaTotalesRow[]>`
      SELECT
        (SELECT COUNT(*)::int FROM "orden" o
          WHERE o."deleted_at" IS NULL
            AND o."created_at" >= ${desde} AND o."created_at" < ${corte}
            AND ${tieneEstatusAlCorte})                       AS ordenes_creadas,
        ${gestionesDe("entregada")}                           AS entregas,
        ${gestionesDe("devuelta")}                            AS devoluciones,
        ${gestionesDe("rechazada")}                           AS rechazos,
        ${gestionesDe("reprogramada")}                        AS reprogramaciones,
        ${gestionesDe("incidente")}                           AS incidentes,
        (SELECT COUNT(*)::int FROM "orden" o
          WHERE o."deleted_at" IS NULL
            AND ${tieneEstatusAlCorte}
            AND (${valueAlCorte} NOT IN (${TERMINALES}) OR ${cerroEnLaVentana})) AS ordenes_estado_stock`;
    const f = filas[0];
    return {
      ordenesCreadas: Number(f.ordenes_creadas),
      ordenesEstadoStock: Number(f.ordenes_estado_stock),
      entregas: Number(f.entregas),
      devoluciones: Number(f.devoluciones),
      rechazos: Number(f.rechazos),
      reprogramaciones: Number(f.reprogramaciones),
      incidentes: Number(f.incidentes),
    };
  }

  /**
   * R27-R31/R34 — la escritura de UNA fecha, TODO-O-NADA, en UNA sola transaccion y SIN
   * LOTES (D9). En este orden, y el orden importa:
   *
   *   1. `marcaCorrida = now()` del servidor de POSTGRES, no del proceso Node: asi dos
   *      corridas solapadas comparan contra el mismo reloj y el paso 3 no puede borrar las
   *      filas de la corrida rival (R31).
   *   2. Upsert de cada cubo resolviendo el conflicto contra el unico del grano.
   *   3. Retirada de las filas RANCIAS de la fecha (R29): las que esta corrida no reescribio.
   *   4. Reconciliacion (R34), aun DENTRO de la transaccion. Si no cuadra, lanza y aborta.
   *
   * DESVIACION DECLARADA respecto de `design.md §5`: el diseno pedia
   * `ON CONFLICT ON CONSTRAINT "analytics_daily_grano_key"`, y eso NO es ejecutable. La 123
   * creo el unico del grano con `CREATE UNIQUE INDEX` (hacia falta para `NULLS NOT DISTINCT`),
   * y un indice suelto no tiene fila en `pg_constraint`: Postgres responde «no existe la
   * restriccion "analytics_daily_grano_key" para la tabla "analytics_daily"». Se usa la
   * INFERENCIA por lista de columnas, que apunta a ese mismo indice —incluido su
   * `NULLS NOT DISTINCT`, verificado contra Postgres 17 local: dos upserts con
   * `mensajero_id` y `causa_devolucion` nulos dejan UNA fila, no dos (R28)—. Cambiar la lista
   * por un subconjunto (por ejemplo sin `mensajero_id`) duplicaria los cubos sin asignar.
   */
  async escribirFecha(escritura: EscrituraFecha): Promise<ResultadoEscritura> {
    // Convencion `@db.Date` del repo (feature 46): la fecha del rollup es la MEDIANOCHE UTC
    // de la fecha calendario, NO `ventana.desde`, que lleva las 06:00 dentro. Se renderiza
    // como literal `YYYY-MM-DD` para que el `::date` de Postgres no dependa del `TimeZone`
    // de la sesion ni del `TZ` del proceso (R9).
    const fechaDia = fechaComoDate(escritura.fecha).toISOString().slice(0, 10);

    return this.prisma.$transaction(
      async (tx) => {
        const [{ marca }] = await tx.$queryRaw<{ marca: Date }[]>`SELECT now() AS marca`;

        for (const fila of escritura.filas) {
          await tx.$queryRaw`
            INSERT INTO "analytics_daily" (
              "id", "fecha", "zona_id", "tienda_id", "mensajero_id", "estatus_id",
              "causa_devolucion", "ordenes_creadas", "ordenes_estado_stock", "entregas",
              "devoluciones", "rechazos", "reprogramaciones", "incidentes",
              "primer_intento_ok", "seg_ciclo_acum", "seg_ciclo_n", "created_at", "updated_at"
            ) VALUES (
              ${randomUUID()}, ${fechaDia}::date, ${fila.zonaId}, ${fila.tiendaId},
              ${fila.mensajeroId}, ${fila.estatusId},
              ${fila.causaDevolucion}::"gestion_causa_devolucion",
              ${fila.ordenesCreadas}, ${fila.ordenesEstadoStock}, ${fila.entregas},
              ${fila.devoluciones}, ${fila.rechazos}, ${fila.reprogramaciones},
              ${fila.incidentes}, ${fila.primerIntentoOk}, ${fila.segCicloAcum},
              ${fila.segCicloN}, ${marca}, ${marca}
            )
            ON CONFLICT ("fecha", "zona_id", "tienda_id", "mensajero_id", "estatus_id", "causa_devolucion")
            DO UPDATE SET
              "ordenes_creadas"      = EXCLUDED."ordenes_creadas",
              "ordenes_estado_stock" = EXCLUDED."ordenes_estado_stock",
              "entregas"             = EXCLUDED."entregas",
              "devoluciones"         = EXCLUDED."devoluciones",
              "rechazos"             = EXCLUDED."rechazos",
              "reprogramaciones"     = EXCLUDED."reprogramaciones",
              "incidentes"           = EXCLUDED."incidentes",
              "primer_intento_ok"    = EXCLUDED."primer_intento_ok",
              "seg_ciclo_acum"       = EXCLUDED."seg_ciclo_acum",
              "seg_ciclo_n"          = EXCLUDED."seg_ciclo_n",
              "updated_at"           = EXCLUDED."updated_at"`;
        }

        const filasRetiradas = await this.retirarFilasRancias(tx, fechaDia, marca);
        const sumasEscritas = await this.sumarMedidasEscritasDeFecha(tx, fechaDia);
        escritura.verificarReconciliacion(sumasEscritas);

        return { filasEscritas: escritura.filas.length, filasRetiradas };
      },
      { timeout: TIMEOUT_TX_ROLLUP_MS, maxWait: TIMEOUT_TX_ROLLUP_MS },
    );
  }

  /**
   * R29 — el barrido que convierte el recomputo en «como si la fecha se hubiera calculado
   * desde cero». Toda fila de la fecha que esta corrida NO reescribio conserva un
   * `updated_at` anterior a `marcaCorrida` y desaparece. Sin esto, el cubo cuya unica gestion
   * se anulo sobrevive con su valor viejo: el fallo silencioso mas probable de la feature.
   *
   * No puede borrar las filas de una corrida rival solapada: aquellas llevan un `updated_at`
   * POSTERIOR (R31).
   */
  private async retirarFilasRancias(
    tx: Prisma.TransactionClient,
    fechaDia: string,
    marcaCorrida: Date,
  ): Promise<number> {
    const borradas = await tx.$queryRaw<{ id: string }[]>`
      DELETE FROM "analytics_daily"
      WHERE "fecha" = ${fechaDia}::date
        AND "updated_at" < ${marcaCorrida}
      RETURNING "id"`;
    return borradas.length;
  }

  /**
   * R34 (D5) — la UNICA lectura del rollup que existe en todo el arbol. Suma las medidas de
   * la fecha recien escrita, DENTRO de la misma transaccion, para compararlas contra los
   * escalares independientes de Q6. Clavada a UNA fecha por igualdad: nunca un rango.
   */
  private async sumarMedidasEscritasDeFecha(
    tx: Prisma.TransactionClient,
    fechaDia: string,
  ): Promise<MedidasReconciliables> {
    const filas = await tx.$queryRaw<FilaSumasRow[]>`
      SELECT COALESCE(SUM("ordenes_creadas"), 0)::int      AS ordenes_creadas,
             COALESCE(SUM("entregas"), 0)::int             AS entregas,
             COALESCE(SUM("devoluciones"), 0)::int         AS devoluciones,
             COALESCE(SUM("rechazos"), 0)::int             AS rechazos,
             COALESCE(SUM("reprogramaciones"), 0)::int     AS reprogramaciones,
             COALESCE(SUM("incidentes"), 0)::int           AS incidentes,
             COALESCE(SUM("ordenes_estado_stock"), 0)::int AS ordenes_estado_stock
      FROM "analytics_daily" WHERE "fecha" = ${fechaDia}::date`;
    const f = filas[0];
    return {
      ordenesCreadas: Number(f.ordenes_creadas),
      ordenesEstadoStock: Number(f.ordenes_estado_stock),
      entregas: Number(f.entregas),
      devoluciones: Number(f.devoluciones),
      rechazos: Number(f.rechazos),
      reprogramaciones: Number(f.reprogramaciones),
      incidentes: Number(f.incidentes),
    };
  }
}

/** Las cuatro coordenadas de una medida de ORDEN, tal cual salen del `GROUP BY` (R26). */
function coordenadasDeOrden(f: FilaOrdenRow) {
  return {
    zonaId: f.zona_id,
    tiendaId: f.tienda_id,
    mensajeroId: f.mensajero_id,
    estatusId: f.estatus_id,
  };
}
