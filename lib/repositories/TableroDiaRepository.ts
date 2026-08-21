import { Prisma, type GestionResultado, type PrismaClient } from "@prisma/client";

import type {
  EntregasEnHora,
  FilaConteoMensajero,
  FiltroAlcanceTablero,
  ITableroDiaRepository,
  PaginaDetalle,
  PaginaOrdenesDelDia,
} from "@/lib/interfaces/repositories/ITableroDiaRepository";
import type { OrdenDetalleDia, TotalesTableroDia } from "@/lib/types/tablero-dia";
import { ESTATUS_CON_BUCKET_EXPLICITO, estatusDelBucket } from "@/lib/types/tablero-dia";
import type { VentanaDiaCR } from "@/lib/utils/ventana-dia-cr";

// Feature 192 (B2.2/B7.2/B8.1-B8.3, design.md §5 y §5.bis) — LAS CONSULTAS DEL TABLERO.
// Feature 258 (B3.1) añade la TERCERA: el histograma de entregas por hora (al final del archivo).
//
// SOLO LECTURA. Ni un `INSERT`, `UPDATE` ni `DELETE`; en particular NUNCA sobre
// `orden.asignado_at` (R59). Aqui se lee en un `WHERE` y en un `SELECT`, y nada mas. Un guardia lo
// atornilla (`tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts`).
//
// ⚠️ CORRECCION (feature 246 / T8.1, 2026-08-20) — ESTE COMENTARIO AFIRMABA ALGO QUE YA NO ES
// CIERTO, y se corrige en vez de dejarlo envejecer. Decia que `asignado_at` «es el denominador del
// ranking diario del mensajero». Con **D7 firmada** (en contra de la recomendacion del spec de la
// 246), el denominador del ranking pasa a contarse por **dia de reparto**
// (`orden.fecha_reparto`), y `asignado_at` queda como la **rama de respaldo** de ese denominador:
// solo cuenta las ordenes que NO tienen dia de reparto — las anteriores al despliegue.
//
// ⚠️ Y DE AHI SALE UNA CONSECUENCIA QUE HAY QUE SABER ANTES DE MIRAR ESTA PANTALLA: el CTE
// `ids_del_dia` de aqui abajo sigue contando «asignadas hoy» por `asignado_at`, sin la rama del
// dia de reparto. Por tanto, **desde el despliegue de la 246 el «asignadas hoy» de este tablero y
// el denominador de `/ranking` pueden dar cifras distintas el mismo dia**: una orden asignada hoy
// para mañana cuenta AQUI hoy y en el ranking mañana. Ninguna de las dos esta mal; miden cosas
// distintas.
//
// ⚠️ Y ESO ES DELIBERADO: **D10 se firmo el 2026-08-20 y dice que este tablero NO sigue al
// ranking**, en contra de la recomendacion del diseño. El motivo, en una linea: las dos pantallas
// NO miden lo mismo. Este tablero responde «¿que carga le eche HOY a este mensajero?» —una
// pregunta de OPERACION, y para esa `asignado_at` es el dato correcto: la orden entro en su monton
// hoy, la reserve para el dia que la reserve—. El ranking responde «¿de que dia es esta orden a
// efectos de su porcentaje?». Alinearlos no habria hecho que las dos dijeran la verdad: le habria
// quitado a este su propia respuesta.
//
// Consecuencia practica, dicha aqui para que nadie la diagnostique como un bug: una orden asignada
// hoy para mañana **cuenta HOY en esta pantalla y MAÑANA en `/ranking`**. Ninguna de las dos esta
// mal. El razonamiento completo esta en `specs/246-asignacion-por-dia/requirements.md` §D10 y en
// `design.md` §6.bis.7. Si algun dia se quiere alinearlas, el `OR` ya esta escrito y probado en
// `RankingRepository` para copiarlo — pero es una decision nueva, no un arreglo.
//
// Lo que NO cambia: mover `asignado_at` sigue moviendo el pago y el premio de un mensajero, asi
// que esta pantalla sigue sin escribirla NUNCA.
//
// Sin logica de negocio y sin validacion de permisos: el `filtro` llega YA resuelto por la
// lista blanca del servicio. Lo que si hace este archivo es ESCRIBIRLO en el `WHERE` (R10),
// que es donde vive la frontera multi-tenant de esta pantalla: no hay RLS debajo.
//
// ⚠ LAS TRES CONSULTAS COMPARTEN DEFINICION Y NO SE PUEDEN TOCAR POR SEPARADO:
//   - el universo "asignada hoy" es el MISMO fragmento (`cteIdsDelDia`, R57/R58);
//   - "resultado del dia" es la MISMA definicion (ultima gestion vigente de la ventana):
//     `DISTINCT ON` en el tablero y en la serie por hora, `LATERAL ... LIMIT 1` en el detalle.
// Si una cambia y las otras no, el detalle contradice a la tarjeta (R51 de la 192) o la linea
// contradice al contador `entregadas` que se pinta a su lado (R52 de la 258). Los tests de
// cuadre (`tests/integration/tablero-dia-detalle-cuadre.test.ts` y
// `tests/integration/tablero-dia-ritmo.test.ts`) son los que lo cazan.

/** Cliente Prisma MINIMO consumido: solo SQL crudo (patron de `AnaliticaOperativaViva`). */
type TableroDiaPrismaClient = Pick<PrismaClient, "$queryRaw">;

/**
 * R57/R65 — el UNICO productor de esta familia de transiciones es la feature 157
 * (`por_recolectar_en_tienda -> recolectando`, misma tx que la asignacion), asi que el
 * criterio no puede pescar otra cosa. El literal viaja como PARAMETRO con su cast al enum:
 * el driver manda los parametros sin tipo y `enum = text` no tiene operador en Postgres.
 */
const ORIGEN_ASIGNACION_RECOLECCION = "asignacion_recoleccion";

/**
 * R24/R27 — la correspondencia entre los CINCO valores del enum `gestion_resultado` y sus
 * contadores. `satisfies Record<GestionResultado, ...>` la hace TOTAL: un sexto valor del
 * enum no compila aqui en vez de caer en `otros` en silencio.
 *
 * Los `COUNT(*) FILTER` del SQL se DERIVAN de este mapa (`filtrosDeResultado`), no se
 * escriben a mano: una lista paralela en la cadena SQL es exactamente el fallo silencioso
 * que R27 persigue.
 */
export const CONTADOR_POR_RESULTADO = {
  entregada: "entregadas",
  reprogramada: "reprogramadas",
  devuelta: "devueltas",
  rechazada: "rechazadas",
  incidente: "incidentes",
} as const satisfies Record<GestionResultado, keyof TotalesTableroDia>;

/**
 * FEATURE 258 (B3.1) — el value del enum que cuenta la serie de entregas acumuladas.
 *
 * `satisfies GestionResultado` lo ata al enum: si el value se renombrara, esto deja de
 * compilar en vez de producir una serie siempre a cero. Y
 * `tests/unit/repositories/tablero-dia-ritmo-sql.test.ts` afirma ademas que
 * `CONTADOR_POR_RESULTADO[RESULTADO_ENTREGADA] === "entregadas"`, que es lo que ata la serie
 * AL CONTADOR con el que tiene que cuadrar (R52) en vez de fiarlo a que los dos nombres se
 * parezcan.
 */
export const RESULTADO_ENTREGADA = "entregada" satisfies GestionResultado;

/** Fila cruda del tablero. `COUNT` devuelve `bigint`: se convierte en el mapeo (nota 5). */
interface FilaConteoRow {
  mensajero_id: string;
  mensajero_nombre: string;
  asignadas: bigint;
  entregadas: bigint;
  reprogramadas: bigint;
  devueltas: bigint;
  rechazadas: bigint;
  incidentes: bigint;
  sin_recoger: bigint;
  en_reparto: bigint;
  otros: bigint;
}

/**
 * Fila cruda del histograma. `hora` sale ya como `int` del `::int` del SELECT; `COUNT` viene
 * como `bigint` y se convierte en el mapeo, como en el tablero.
 */
interface FilaEntregasEnHoraRow {
  hora: number;
  entregadas: bigint;
}

interface FilaDetalleRow {
  orden_id: string;
  num_guia: number | null;
  estatus: string;
  resultado_del_dia: GestionResultado | null;
  cliente: string;
  destino: string | null;
  asignado_at: Date;
  total: bigint;
}

/**
 * B8.1 — LOS DOS CAMINOS DE "ASIGNADA HOY", declarados UNA sola vez y consumidos por el
 * tablero y por el detalle (design.md §1.ter, R57/R58/R64).
 *
 * ⛔ `UNION`, **nunca** `UNION ALL`. Es la linea de la que depende que los numeros cuadren:
 * una orden alcanzable por los dos caminos aparecería DOS veces con `UNION ALL`, inflando
 * `asignadas` y rompiendo la identidad de R25 en silencio. Un `LEFT JOIN` al historial
 * tendria el mismo fallo multiplicado (una reasignacion de recoleccion genera dos filas).
 *
 * R60 — `ids_recoleccion` selecciona SOLO `orden_id`, jamas `actor_usuario_id`: el actor del
 * historial es el maestro que DECIDE, no quien reparte. Agrupar por el pondria las ordenes en
 * la tarjeta del maestro.
 *
 * R10/nota 9 — aqui NO se filtra por zona a proposito: `ids_recoleccion` no conoce todavia la
 * orden. El recorte multi-tenant se aplica UNA vez, DESPUES de la union, sobre `orden`.
 */
function cteIdsDelDia(ventana: VentanaDiaCR): Prisma.Sql {
  return Prisma.sql`
    ids_reparto AS (
      SELECT o."id" AS id
      FROM "orden" o
      WHERE o."mensajero_asignado_id" IS NOT NULL
        AND o."asignado_at" >= ${ventana.desde}
        AND o."asignado_at" <  ${ventana.hasta}
    ),
    ids_recoleccion AS (
      SELECT DISTINCT h."orden_id" AS id
      FROM "orden_historial_estado" h
      WHERE h."origen_tipo" = ${ORIGEN_ASIGNACION_RECOLECCION}::"orden_historial_origen_tipo"
        AND h."created_at" >= ${ventana.desde}
        AND h."created_at" <  ${ventana.hasta}
    ),
    ids_del_dia AS (
      SELECT id FROM ids_reparto
      UNION
      SELECT id FROM ids_recoleccion
    )`;
}

/**
 * EL RECORTE MULTI-TENANT (R5/R6/R10), sobre el alias `o` de `orden` y NUNCA sobre la zona
 * del usuario mensajero: la zona de la orden esta congelada y puede diferir de la del
 * mensajero que la gestiono (`alcance.ts:197-198`).
 *
 * `zonaId` viaja como PARAMETRO de `Prisma.sql`, jamas interpolado en la cadena.
 */
function fragmentoDeAlcance(filtro: FiltroAlcanceTablero): Prisma.Sql {
  switch (filtro.tipo) {
    case "global":
      return Prisma.sql`TRUE`;
    case "zona":
      return Prisma.sql`o."zona_id" = ${filtro.zonaId}`;
  }
}

/** `IN (...)` seguro: una lista vacia produciria `IN ()`, que es un error de sintaxis. */
function pertenece(columna: Prisma.Sql, valores: readonly string[]): Prisma.Sql {
  if (valores.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${columna} IN (${Prisma.join([...valores])})`;
}

/**
 * Los cinco contadores de resultado, DERIVADOS de `CONTADOR_POR_RESULTADO` (nota 3.bis): el
 * enum no se escribe dos veces, una en TypeScript y otra en la cadena SQL.
 *
 * El alias de cada columna es la clave del contador, que es un identificador simple del mapa
 * de arriba (`entregadas`, `devueltas`, ...): por eso `Prisma.raw` aqui no toca datos de
 * usuario ni de la base.
 */
function filtrosDeResultado(): Prisma.Sql {
  const columnas = Object.entries(CONTADOR_POR_RESULTADO).map(
    ([resultado, alias]) =>
      Prisma.sql`COUNT(*) FILTER (WHERE r.resultado = ${resultado}::"gestion_resultado") AS ${Prisma.raw(alias)}`,
  );
  return Prisma.join(columnas, ",\n             ");
}

/**
 * R21/R43/R45 — el segundo eje. Las tres ramas se construyen sobre el MISMO predicado
 * (`IN` / `IN` / `NOT IN` de la union de las dos listas), asi que son disjuntas y
 * exhaustivas POR CONSTRUCCION: es lo que hace cierta la identidad de ocho sumandos de R25
 * sin comprobarla a posteriori.
 *
 * Las listas se derivan de `BUCKET_POR_ESTATUS` y viajan como PARAMETROS (R46).
 */
function filtrosDeBucket(): Prisma.Sql {
  const estatus = Prisma.sql`a.estatus`;
  const sinRecoger = estatusDelBucket("sinRecoger");
  const enReparto = estatusDelBucket("enReparto");
  return Prisma.sql`
             COUNT(*) FILTER (WHERE r.resultado IS NULL
                                AND ${pertenece(estatus, sinRecoger)})  AS sin_recoger,
             COUNT(*) FILTER (WHERE r.resultado IS NULL
                                AND ${pertenece(estatus, enReparto)})   AS en_reparto,
             COUNT(*) FILTER (WHERE r.resultado IS NULL
                                AND NOT ${pertenece(estatus, ESTATUS_CON_BUCKET_EXPLICITO)}) AS otros`;
}

export class TableroDiaRepository implements ITableroDiaRepository {
  constructor(private readonly prisma: TableroDiaPrismaClient) {}

  /**
   * R36/R39/R64 — UNA sola llamada a `$queryRaw` para todo el tablero: los dos caminos de
   * "asignada hoy", el resultado del dia y los tres buckets del segundo eje.
   *
   * `DISTINCT ON` es lo que compra la rama B (decision humana): colapsa las N gestiones del
   * dia de una orden a la ULTIMA, de modo que cada orden aporta exactamente 1 (R20). Contar
   * `gestion_orden` directamente romperia la identidad de R25 porque `GestionOrden` no tiene
   * `@@unique(ordenId)`. El desempate `g."id" DESC` no es defensivo: sin el, dos gestiones
   * con el mismo `created_at` harian el resultado no determinista.
   *
   * R37 — el predicado de `ids_reparto` (`mensajero_asignado_id IS NOT NULL` + rango de
   * `asignado_at`) es exactamente el prefijo del indice `(mensajero_asignado_id,
   * asignado_at)` que YA existe. Esta feature no crea ninguno.
   *
   * ⚠️ FEATURE 246 (2026-08-20): ese indice pasa a ser `(mensajero_asignado_id, asignado_at,
   * fecha_reparto)` — se AMPLIA, no se sustituye por otro distinto. El prefijo sigue sirviendo a
   * esta consulta con EL MISMO `Index Cond`, verificado con `EXPLAIN` y no supuesto. Si alguien
   * reordenara las columnas de ese indice (p. ej. poniendo `fecha_reparto` delante), esta consulta
   * perderia su plan sin que nada aqui se rompiera: por eso queda escrito de quien depende.
   */
  async contarPorMensajero(
    ventana: VentanaDiaCR,
    filtro: FiltroAlcanceTablero,
  ): Promise<readonly FilaConteoMensajero[]> {
    const filas = await this.prisma.$queryRaw<FilaConteoRow[]>`
      WITH ${cteIdsDelDia(ventana)},
      asignadas AS (
        SELECT o."id"                    AS orden_id,
               o."mensajero_asignado_id" AS mensajero_id,
               s."value"                 AS estatus
        FROM ids_del_dia d
        JOIN "orden" o        ON o."id" = d.id
        JOIN "order_status" s ON s."id" = o."estatus_id"
        WHERE o."mensajero_asignado_id" IS NOT NULL
          AND o."deleted_at" IS NULL
          AND ${fragmentoDeAlcance(filtro)}
      ),
      resultado_final AS (
        SELECT DISTINCT ON (g."orden_id")
               g."orden_id"  AS orden_id,
               g."resultado" AS resultado
        FROM "gestion_orden" g
        JOIN asignadas a ON a.orden_id = g."orden_id"
        WHERE g."anulada_at" IS NULL
          AND g."created_at" >= ${ventana.desde}
          AND g."created_at" <  ${ventana.hasta}
        ORDER BY g."orden_id", g."created_at" DESC, g."id" DESC
      )
      SELECT a.mensajero_id                                        AS mensajero_id,
             TRIM(CONCAT_WS(' ', u."nombre", u."primer_apellido")) AS mensajero_nombre,
             COUNT(*)                                              AS asignadas,
             ${filtrosDeResultado()},
             ${filtrosDeBucket()}
      FROM asignadas a
      JOIN "usuario" u ON u."id" = a.mensajero_id
      LEFT JOIN resultado_final r ON r.orden_id = a.orden_id
      GROUP BY a.mensajero_id, u."nombre", u."primer_apellido"
      ORDER BY asignadas DESC, mensajero_nombre ASC, a.mensajero_id ASC`;

    return filas.map((f) => ({
      mensajeroId: f.mensajero_id,
      mensajeroNombre: f.mensajero_nombre,
      asignadas: Number(f.asignadas),
      entregadas: Number(f.entregadas),
      reprogramadas: Number(f.reprogramadas),
      devueltas: Number(f.devueltas),
      rechazadas: Number(f.rechazadas),
      incidentes: Number(f.incidentes),
      sinRecoger: Number(f.sin_recoger),
      enReparto: Number(f.en_reparto),
      otros: Number(f.otros),
    }));
  }

  /**
   * R47/R55 — el detalle: UNA consulta acotada al mensajero, al dia y al alcance, con
   * `LIMIT/OFFSET` como el listado de ordenes. Nunca materializa el dia entero para
   * recortarlo despues (esa es la deuda de la ficha 191).
   *
   * El `LEFT JOIN LATERAL ... LIMIT 1` es la version por-orden del `DISTINCT ON` del tablero:
   * la MISMA definicion de "resultado del dia", con el mismo desempate. Tocar una obliga a
   * tocar la otra (R51).
   *
   * `total` sale de `COUNT(*) OVER ()`, es decir del mismo `SELECT` que las filas: un segundo
   * viaje podria discrepar de la pagina que acompana y el cuadre con `asignadas` seria
   * casual en vez de cierto.
   */
  async listarOrdenesDelDia(
    ventana: VentanaDiaCR,
    filtro: FiltroAlcanceTablero,
    mensajeroId: string,
    pagina: PaginaDetalle,
  ): Promise<PaginaOrdenesDelDia> {
    const offset = (pagina.pagina - 1) * pagina.pageSize;
    const filas = await this.prisma.$queryRaw<FilaDetalleRow[]>`
      WITH ${cteIdsDelDia(ventana)}
      SELECT o."id"           AS orden_id,
             o."num_guia"     AS num_guia,
             s."value"        AS estatus,
             r.resultado      AS resultado_del_dia,
             o."destinatario" AS cliente,
             o."direccion"    AS destino,
             -- Una orden que entro por el camino de recoleccion tiene asignado_at NULL
             -- (R59: la 157 NO lo estampa a proposito). Se cae al instante de la transicion
             -- de recoleccion del dia, que es lo que de verdad la puso en manos de alguien.
             COALESCE(o."asignado_at", rec.at, ${ventana.desde}) AS asignado_at,
             COUNT(*) OVER ()                                    AS total
      FROM "orden" o
      JOIN "order_status" s ON s."id" = o."estatus_id"
      LEFT JOIN LATERAL (
        SELECT g."resultado" AS resultado
        FROM "gestion_orden" g
        WHERE g."orden_id" = o."id"
          AND g."anulada_at" IS NULL
          AND g."created_at" >= ${ventana.desde}
          AND g."created_at" <  ${ventana.hasta}
        ORDER BY g."created_at" DESC, g."id" DESC
        LIMIT 1
      ) r ON TRUE
      LEFT JOIN LATERAL (
        SELECT MIN(h."created_at") AS at
        FROM "orden_historial_estado" h
        WHERE h."orden_id" = o."id"
          AND h."origen_tipo" = ${ORIGEN_ASIGNACION_RECOLECCION}::"orden_historial_origen_tipo"
          AND h."created_at" >= ${ventana.desde}
          AND h."created_at" <  ${ventana.hasta}
      ) rec ON TRUE
      WHERE o."mensajero_asignado_id" = ${mensajeroId}
        AND o."id" IN (SELECT id FROM ids_del_dia)
        AND o."deleted_at" IS NULL
        AND ${fragmentoDeAlcance(filtro)}
      ORDER BY COALESCE(o."asignado_at", rec.at, ${ventana.desde}) DESC, o."id" ASC
      LIMIT ${pagina.pageSize} OFFSET ${offset}`;

    return {
      ordenes: filas.map(aOrdenDetalle),
      total: filas.length === 0 ? 0 : Number(filas[0].total),
    };
  }

  /**
   * FEATURE 258 (B3.1, R50/R51/R53/R58) — LA TERCERA CONSULTA: el histograma de entregas del
   * dia por hora de pared de Costa Rica. AGREGADA (`GROUP BY`), de SOLO LECTURA, con el
   * recorte de alcance como parametro.
   *
   * ⚠️ VA LA ULTIMA DEL ARCHIVO A PROPOSITO. `tests/unit/tablero-dia/frontera.guardia.test.ts`
   * clasifica las plantillas `$queryRaw` EN EL ORDEN EN QUE APARECEN EN EL TEXTO y afirma
   * `["agregada", "paginada", "agregada"]`. Moverla de sitio pone ese guardia rojo.
   *
   * CUENTA EXACTAMENTE EL MISMO CONJUNTO QUE `entregadas` de `contarPorMensajero`, y por eso
   * reutiliza `cteIdsDelDia` y `fragmentoDeAlcance` en vez de copiarlos: si el universo
   * "asignada hoy" cambia, cambia para las tres consultas a la vez, que es la unica forma de
   * que R51/R52 sigan siendo ciertos. El `DISTINCT ON (orden_id)` con el desempate
   * `created_at DESC, id DESC` es la MISMA definicion de "resultado del dia" del tablero: cada
   * orden aporta 1, en la hora de su gestion FINAL. Sin el, una orden con dos gestiones
   * `entregada` aportaria dos (`GestionOrden` no tiene `@@unique(ordenId)`) y la linea diria un
   * numero distinto del contador que se pinta a su lado.
   *
   * LA HORA SALE DE `ventana.desde`, NO DE UNA ZONA HORARIA EN SQL (R53). Costa Rica es UTC-6
   * fijo y sin horario de verano, y `ventana.desde` ES las 00:00 de pared de CR: restar y
   * dividir entre 3600 da la hora de pared directamente, 0..23, por construccion.
   *   ⛔ `AT TIME ZONE 'America/Costa_Rica'` esta descartado: meteria una SEGUNDA fuente de
   *      verdad de la zona horaria —una en `lib/utils/fecha-cr.ts` y otra dentro de una cadena
   *      SQL— y ataria el resultado al catalogo `tzdata` del servidor Postgres. Los off-by-one
   *      de esta familia ya costaron la ficha 166.
   *   ⛔ Agrupar en TypeScript sobre las ordenes del dia esta descartado: es lo que prohibe el
   *      guardia (`findMany`, consultas ni agregadas ni paginadas) y es la deuda de la 191.
   *
   * EL DIVISOR SE ESCRIBE COMO `INTERVAL '1 hour'` Y NO COMO `3600`, y no es estilo: el
   * guardia `tests/unit/analytics/cache-config.guardia.test.ts` prohibe el literal `3600` en
   * todo `lib/repositories/` porque ese numero es el TTL de la cache de analitica y tiene que
   * vivir en UNA sola constante. Escribirlo aqui —aunque signifique "segundos que tiene una
   * hora" y no tenga nada que ver con aquel TTL— pone ese guardia rojo. La forma de interval
   * dice ademas lo que hace: cuantas horas ENTERAS caben en lo transcurrido.
   * ⛔ No lo "simplifiques" de vuelta a `/ 3600`: rompe un guardia ajeno.
   *
   * Se conserva el `FLOOR(EPOCH / …)` en vez de `EXTRACT(HOUR FROM intervalo)` a proposito:
   * `EXTRACT(HOUR ...)` sobre un interval DESCARTA en silencio la componente de dias, asi que
   * si alguien ampliara la ventana mas alla de 24 h las horas del dia siguiente se colarian
   * disfrazadas de 0..23. Con el `FLOOR` saldria un 24, que es un fallo que se ve.
   *
   * El `::timestamp` explicito sobre el parametro es deliberado: el driver manda los
   * parametros sin tipo y la inferencia del operador `-` sobre `timestamp - unknown` es
   * ambigua en Postgres. Con el cast, el parametro se interpreta EXACTAMENTE igual que en las
   * comparaciones `created_at >= ${ventana.desde}` de arriba, que ya estan probadas contra
   * Postgres real.
   *
   * Devuelve SOLO las horas con entregas: rellenar los huecos y acumular es del servicio.
   */
  async contarEntregasPorHora(
    ventana: VentanaDiaCR,
    filtro: FiltroAlcanceTablero,
  ): Promise<readonly EntregasEnHora[]> {
    const filas = await this.prisma.$queryRaw<FilaEntregasEnHoraRow[]>`
      WITH ${cteIdsDelDia(ventana)},
      asignadas AS (
        SELECT o."id" AS orden_id
        FROM ids_del_dia d
        JOIN "orden" o ON o."id" = d.id
        WHERE o."mensajero_asignado_id" IS NOT NULL
          AND o."deleted_at" IS NULL
          AND ${fragmentoDeAlcance(filtro)}
      ),
      resultado_final AS (
        SELECT DISTINCT ON (g."orden_id")
               g."orden_id"   AS orden_id,
               g."resultado"  AS resultado,
               g."created_at" AS at
        FROM "gestion_orden" g
        JOIN asignadas a ON a.orden_id = g."orden_id"
        WHERE g."anulada_at" IS NULL
          AND g."created_at" >= ${ventana.desde}
          AND g."created_at" <  ${ventana.hasta}
        ORDER BY g."orden_id", g."created_at" DESC, g."id" DESC
      )
      SELECT FLOOR(
               EXTRACT(EPOCH FROM (r.at - ${ventana.desde}::timestamp))
               / EXTRACT(EPOCH FROM INTERVAL '1 hour')
             )::int     AS hora,
             COUNT(*)   AS entregadas
      FROM resultado_final r
      WHERE r.resultado = ${RESULTADO_ENTREGADA}::"gestion_resultado"
      GROUP BY 1
      ORDER BY 1`;

    return filas.map((f) => ({ hora: Number(f.hora), entregadas: Number(f.entregadas) }));
  }
}

function aOrdenDetalle(f: FilaDetalleRow): OrdenDetalleDia {
  return {
    ordenId: f.orden_id,
    numGuia: f.num_guia === null ? null : String(f.num_guia),
    estatus: f.estatus,
    resultadoDelDia: f.resultado_del_dia,
    cliente: f.cliente,
    destino: f.destino ?? "",
    asignadoAt: f.asignado_at.toISOString(),
  };
}
