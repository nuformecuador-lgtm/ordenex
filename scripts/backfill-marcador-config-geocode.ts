import { pathToFileURL } from "node:url";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { MARCADOR_FALLO_CONFIG_GEOCODE } from "@/lib/geo/fallo-config-geocode";

// FEATURE 400 (T18, design §7, R17/R18) — REPARACION DE UN SOLO USO: ponerle el marcador a
// los jobs de geocodificacion que murieron por un fallo de configuracion NUESTRO ANTES de
// que el marcador existiera.
//
// Uso:
//   node --env-file=.env ./node_modules/tsx/dist/cli.mjs \
//        scripts/backfill-marcador-config-geocode.ts [--apply]
//
// **Sin flag NO escribe nada**: el modo por defecto es solo-lectura. Imprime cuantas filas
// son candidatas y el desglose por estado de todo lo que lleva el texto legado, para poder
// decir el numero ANTES de tocar produccion (memoria del repo: medir el backfill antes de
// desplegar).
//
// ── POR QUE EXISTE, MEDIDO EL 2026-09-09 A LAS 15:41 UTC ────────────────────────────────
// HOY NO TIENE SUJETOS. El incidente que origina la ficha 400 ya se resolvio A MANO: el
// leader resucito los 47 jobs afectados directamente en la base de produccion
// (`intentos=0`, `last_error=null`, `run_after` adelantado) y quedaron 0 `failed`, 0
// `pending` y 42 geocodificaciones nuevas. Este script NO fue lo que las desbloqueo.
//
// Se conserva porque el rescate fue MANUAL, y eso es exactamente lo que no debe repetirse:
// un job `failed` no vuelve a ejecutarse nunca (el reencolado automatico es la ficha 401,
// aun sin planificar), asi que la proxima vez que el proveedor rechace peticiones la unica
// via de recuperar los `failed` acumulados volveria a ser alguien entrando a produccion a
// mano, sin ensayar y bajo presion. Esto es la red probada para esa vez. Los `pending` y
// `processing` NO necesitan nada: su proximo intento corre con el codigo nuevo, vuelve a
// fallar por la misma causa y `fail()` reescribe `last_error` YA con marcador.
//
// ── POR QUE AQUI SI SE COMPARA POR PROSA, Y ES CORRECTO ─────────────────────────────────
// La ficha prohibe atar el predicado EN CALIENTE del gate a la redaccion de un mensaje —ese
// corre en cada asignacion y tiene que sobrevivir a cualquier reescritura futura—. Esto es
// otra cosa: una reparacion PUNTUAL de datos historicos, que corre una vez contra una
// fotografia conocida y con el numero medido antes. No hay otra forma de reconocer filas
// escritas cuando el marcador no existia.

/** Cliente Prisma MINIMO consumido: solo lo que hace falta para leer y para el UPDATE. */
export interface BackfillMarcadorClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

export interface InformeBackfillMarcador {
  /** Filas que el `WHERE` tocaria: `geocodificacion` + `failed` + texto legado + sin marcar. */
  candidatas: number;
  /** Contexto para el humano: TODO lo que lleva el texto legado, partido por estado. */
  porEstado: { estado: string; total: number }[];
  /** Filas realmente actualizadas. `null` en solo-lectura (no se escribio nada). */
  actualizadas: number | null;
}

/**
 * Los dos textos legados de un fallo de configuracion NUESTRA, tal como los escribia el
 * codigo ANTES de la ficha 400:
 *   - el proveedor rechaza la peticion  -> `lib/clients/google-geocode.ts` (REQUEST_DENIED)
 *   - falta la credencial               -> `GeocodeNoConfiguradoError`
 * Se citan como fragmentos, no como frases completas, porque el prefijo de la operacion
 * (`geocodificar direccion: `) podria haber variado entre despliegues.
 */
const FRAGMENTO_REQUEST_DENIED = "%el proveedor rechazo la peticion (REQUEST_DENIED)%";
const FRAGMENTO_SIN_CREDENCIAL = "%GOOGLE_MAPS_API_KEY no esta configurada%";

/**
 * R17/R18 — la operacion, idempotente y acotada.
 *
 * ALCANCE DEL `WHERE`, y por que cada condicion:
 *   - `tipo = 'geocodificacion'`: no toca ninguno de los otros ocho tipos de job.
 *   - `estado = 'failed'`: los `pending`/`processing` se curan solos en su proximo intento,
 *     y reescribirles el error de un intento pasado seria mentir sobre el ultimo.
 *   - texto legado: solo las que murieron por configuracion NUESTRA.
 *   - `NOT LIKE marcador || '%'`: IDEMPOTENCIA (R17). Correrlo dos veces no vuelve a tocar
 *     lo ya marcado, y por tanto no duplica el prefijo.
 *
 * EFECTO: prefija el marcador y NADA MAS. Un solo `UPDATE ... SET last_error = ...`: no
 * toca `estado`, `intentos`, `run_after`, `dedupe_key`, `payload` ni `updated_at` (R18) —
 * por eso es SQL crudo y no `prisma.job.update`, que bumpearia `updated_at` por el
 * `@updatedAt` del modelo y borraria la evidencia de que no se movio nada mas.
 */
export async function backfillMarcadorConfigGeocode(
  cliente: BackfillMarcadorClient,
  opts: { aplicar: boolean },
): Promise<InformeBackfillMarcador> {
  const marcadorLike = `${MARCADOR_FALLO_CONFIG_GEOCODE}%`;

  const candidatasRows = await cliente.$queryRaw<{ total: bigint }[]>`
    SELECT COUNT(*)::bigint AS total
    FROM "jobs"
    WHERE "tipo" = 'geocodificacion'
      AND "estado" = 'failed'
      AND ("last_error" LIKE ${FRAGMENTO_REQUEST_DENIED}
        OR "last_error" LIKE ${FRAGMENTO_SIN_CREDENCIAL})
      AND "last_error" NOT LIKE ${marcadorLike}
  `;
  const candidatas = Number(candidatasRows[0]?.total ?? 0);

  const porEstadoRows = await cliente.$queryRaw<{ estado: string; total: bigint }[]>`
    SELECT "estado"::text AS estado, COUNT(*)::bigint AS total
    FROM "jobs"
    WHERE "tipo" = 'geocodificacion'
      AND ("last_error" LIKE ${FRAGMENTO_REQUEST_DENIED}
        OR "last_error" LIKE ${FRAGMENTO_SIN_CREDENCIAL})
    GROUP BY "estado"
    ORDER BY "estado"
  `;
  const porEstado = porEstadoRows.map((r) => ({ estado: r.estado, total: Number(r.total) }));

  if (!opts.aplicar) return { candidatas, porEstado, actualizadas: null };

  const actualizadas = await cliente.$executeRaw`
    UPDATE "jobs"
    SET "last_error" = ${`${MARCADOR_FALLO_CONFIG_GEOCODE} `} || "last_error"
    WHERE "tipo" = 'geocodificacion'
      AND "estado" = 'failed'
      AND ("last_error" LIKE ${FRAGMENTO_REQUEST_DENIED}
        OR "last_error" LIKE ${FRAGMENTO_SIN_CREDENCIAL})
      AND "last_error" NOT LIKE ${marcadorLike}
  `;

  return { candidatas, porEstado, actualizadas };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

export interface EntornoBackfillMarcador {
  readonly argv: readonly string[];
  readonly salida: (linea: string) => void;
  readonly errores: (linea: string) => void;
  /** Perezoso A PROPOSITO: mientras no se llame, no se abre ninguna conexion. */
  readonly crearCliente: () => BackfillMarcadorClient;
}

/** Devuelve el codigo de salida del proceso. Toda la I/O va inyectada. */
export async function ejecutarCli(entorno: EntornoBackfillMarcador): Promise<number> {
  const desconocidos = entorno.argv.filter((a) => a !== "--apply");
  if (desconocidos.length > 0) {
    entorno.errores(`argumento no reconocido: ${desconocidos.join(", ")}. Solo se admite --apply.`);
    return 2;
  }
  const aplicar = entorno.argv.includes("--apply");

  entorno.salida(
    aplicar
      ? "== backfill del marcador de fallo de configuracion :: APLICAR =="
      : "== backfill del marcador de fallo de configuracion :: SOLO LECTURA (usa --apply para escribir) ==",
  );

  const informe = await backfillMarcadorConfigGeocode(entorno.crearCliente(), { aplicar });

  entorno.salida(`candidatas (geocodificacion + failed + texto legado + sin marcar): ${informe.candidatas}`);
  if (informe.porEstado.length === 0) {
    entorno.salida("desglose por estado: ninguna fila con el texto legado");
  } else {
    for (const fila of informe.porEstado) {
      entorno.salida(`  ${fila.estado}: ${fila.total}`);
    }
  }
  entorno.salida(
    informe.actualizadas === null
      ? "no se escribio nada (solo lectura)"
      : `filas actualizadas: ${informe.actualizadas}`,
  );
  return 0;
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  try {
    process.exitCode = await ejecutarCli({
      argv: process.argv.slice(2),
      salida: (linea) => console.log(linea),
      errores: (linea) => console.error(linea),
      crearCliente: () => prisma as unknown as BackfillMarcadorClient,
    });
  } finally {
    await prisma.$disconnect();
  }
}

// Solo se auto-ejecuta como entrypoint del proceso: importarlo desde un test no ejecuta
// nada (patron de `scripts/backfill-caja-tesoreria.ts`).
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("Fallo el backfill del marcador de fallo de configuracion:", error);
    process.exit(1);
  });
}
