import type { PrismaClient } from "@prisma/client";
import type {
  IGeocodeSaludRepository,
  RevivirFallosConfigOpts,
} from "@/lib/interfaces/repositories/IGeocodeSaludRepository";
// FICHA 401 (T6, R1) — el marcador y su longitud se IMPORTAN del modulo de la ficha 400. Ni un
// literal copiado: R13 de la 400 lo prohibe y su guardia
// (`tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts`) lo vigila —y esa
// guardia mide el ARCHIVO ENTERO, comentarios incluidos, asi que el prefijo no se escribe aqui ni
// para explicarlo—. Si alguien lo copiara, el dia que cambie las dos puntas se desincronizarian EN
// SILENCIO y esta ficha entera dejaria de reconocer el caso sin un solo test rojo.
import { MARCADOR_FALLO_CONFIG_GEOCODE } from "@/lib/geo/fallo-config-geocode";

// Cliente Prisma minimo consumido (patron `JobRepository`): las dos sentencias son SQL crudo
// parametrizado. Este repositorio NO tiene logica de negocio: el umbral, la ventana, el lote y el
// enfriamiento los decide `GeocodeSaludService` y llegan como argumentos.
type GeocodeSaludPrismaClient = Pick<PrismaClient, "$queryRaw">;

/** Longitud del marcador, DERIVADA del propio literal importado. Nunca escrita a mano. */
const LARGO_MARCADOR = MARCADOR_FALLO_CONFIG_GEOCODE.length;

/**
 * FICHA 401 (design §5.1) — las DOS sentencias de la salud del geocodificador sobre `jobs`.
 *
 * ⚠️ ESTE ARCHIVO NO SE PUEDE VERIFICAR CON DOBLES, y por eso su suite vive en
 * `tests/integration/db/geocode-recuperacion.test.ts`, contra Postgres real y con filas testigo
 * comparadas antes/despues. Medido cuatro veces en este repo: una mutacion del `WHERE` deja en
 * verde a cualquier test de servicio con un repositorio falso.
 *
 * Las dos consultas se apoyan en el indice PARCIAL `jobs_geocodificacion_estado_updated_idx`
 * (migracion `20260910110000`): sin el, serian un escaneo secuencial sobre una tabla que no se
 * purga.
 */
export class GeocodeSaludRepository implements IGeocodeSaludRepository {
  constructor(private readonly prisma: GeocodeSaludPrismaClient) {}

  async contarFallosConfigDesde(desde: Date, excluirJobId: string): Promise<number> {
    // R2/R3/R5 — se cuentan JOBS DISTINTOS (una fila = un job), no intentos.
    //
    // `left("last_error", $len) = $marcador` y NO `LIKE '%...%'`: es la traduccion SQL EXACTA del
    // `startsWith` que la 400 define como unica forma de detectar el marcador, y evita de raiz el
    // escapado de `LIKE` (memoria del repo: «todo lo inline pierde una capa»). Un error ajeno que
    // MENCIONE el marcador dentro de su texto no cuenta, igual que en `esFalloConfigGeocode`.
    //
    // `estado IN ('pending','processing','failed')` = «no completados». Un job `done` con marcador
    // es la fotografia de un intento anterior YA SUPERADO; contarlo seria contar un corte que
    // termino (mismo razonamiento con el que la 400 excluye `done` de su paso del gate).
    //
    // `"id" <> $excluirJobId` es EL OFF-BY-ONE de design §5.3: el fallo del job en curso todavia
    // no esta persistido (`fail()` corre despues, en `JobQueueService.manejarFallo`), asi que se
    // excluye aqui y el servicio suma 1.
    const filas = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM "jobs"
      WHERE "tipo"   = 'geocodificacion'
        AND "estado" IN ('pending', 'processing', 'failed')
        AND "updated_at" >= ${desde}
        AND "id" <> ${excluirJobId}
        AND left("last_error", ${LARGO_MARCADOR}) = ${MARCADOR_FALLO_CONFIG_GEOCODE}`;
    return Number(filas[0]?.n ?? 0);
  }

  async revivirFallosConfig(opts: RevivirFallosConfigOpts): Promise<number> {
    const { ahora, limite, espaciadoMs, tocadoAntesDe } = opts;
    // R13/R15/R16/R19/R21/R22/R23/R24 — UNA sola sentencia atomica.
    //
    // ⚠️ TRES CTEs Y NO DOS, Y NO ES ESTETICA. `design.md` §5.1 escribe `row_number()` y
    // `FOR UPDATE SKIP LOCKED` en la MISMA `SELECT`; Postgres lo rechaza en tiempo de ejecucion
    // (medido el 2026-09-09 contra la base local: `0A000 — FOR UPDATE no esta permitido con
    // funciones de ventana`), exactamente la misma restriccion que ya obligo a partir en tres el
    // `claimBatch` de `JobRepository`. Por eso el BLOQUEO va en `elegibles` (sin ventana) y la
    // NUMERACION en `candidatos` (sin bloqueo), sobre el conjunto ya fijado.
    //
    //  · `elegibles`  — el `WHERE` completo: tipo, `failed`, enfriamiento (R24) y marcador (R16),
    //    `ORDER BY "updated_at" ASC` (R19: los MAS ANTIGUOS primero) y `LIMIT` (R21).
    //    `FOR UPDATE SKIP LOCKED` como el claim: dos corridas solapadas del drenador no reviven el
    //    mismo job dos veces ni se esperan la una a la otra.
    //  · `candidatos` — numera 1..n en el mismo orden para escalonar el `run_after` (R22).
    //  · el `UPDATE`  — toca SOLO `estado`, `intentos`, `last_error`, `locked_at`, `run_after` y
    //    `updated_at`. NO toca `tipo`, `payload` ni `dedupe_key` (R15), y su `WHERE` no puede
    //    alcanzar ninguna fila de otro tipo ni ninguna que no estuviera `failed` (R23).
    //
    // `locked_at = NULL`: una fila `failed` puede arrastrar un `locked_at` viejo. El rescate manual
    // del 2026-09-09 dejo las filas limpias y esto lo replica; asi la fila queda indistinguible de
    // una recien encolada.
    //
    // `ahora`/`tocadoAntesDe` van INYECTADOS (nunca `NOW()` de Postgres), como en `claimBatch`:
    // es lo que hace la integracion determinista.
    const filas = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH elegibles AS (
        SELECT "id", "updated_at"
        FROM "jobs"
        WHERE "tipo"   = 'geocodificacion'
          AND "estado" = 'failed'
          AND "updated_at" < ${tocadoAntesDe}
          AND left("last_error", ${LARGO_MARCADOR}) = ${MARCADOR_FALLO_CONFIG_GEOCODE}
        ORDER BY "updated_at" ASC
        LIMIT ${limite}
        FOR UPDATE SKIP LOCKED
      ),
      candidatos AS (
        SELECT "id", row_number() OVER (ORDER BY "updated_at" ASC) AS pos
        FROM elegibles
      )
      UPDATE "jobs" AS j
      SET "estado"     = 'pending',
          "intentos"   = 0,
          "last_error" = NULL,
          "locked_at"  = NULL,
          "run_after"  = ${ahora}::timestamp(3)
                         + (c.pos * ${espaciadoMs}::int) * interval '1 millisecond',
          "updated_at" = ${ahora}
      FROM candidatos c
      WHERE j."id" = c."id"
      RETURNING j."id"`;
    return filas.length;
  }
}
