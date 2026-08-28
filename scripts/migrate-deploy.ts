// Paso de BASE DE DATOS del build (`pnpm run build`). Sustituye al
// `prisma migrate deploy` pelado, que se ejecutaba en TODOS los entornos.
//
// Hace DOS cosas, en este orden:
//   1. aplica las migraciones pendientes;
//   2. SIEMBRA la primera ocurrencia de cada job RECURRENTE (ficha 313; el por
//      que, con lo medido en produccion, esta en `sembrarRecurrentes` mas abajo).
//
// Tres guardas, en orden:
//   1. Solo migra el deploy de PRODUCCION. Un preview comparte la base con
//      produccion; migrarla al abrir un PR es un efecto secundario invisible.
//   2. Aborta si la URL de migraciones apunta al pooler TRANSACCIONAL (:6543),
//      donde `migrate deploy` espera un advisory lock que ese modo no sostiene.
//   3. Timeout duro: si aun asi se cuelga, el build muere con mensaje en
//      minutos, no en horas.
//
// La logica pura de las guardas vive en `migrate-deploy-guardas.ts` (testeada
// aparte). La ORQUESTACION —quien corre, en que orden y que pasa si uno falla—
// se exporta como `ejecutarPasoDeBaseDeDatos` con sus efectos inyectables, por
// el mismo motivo: sin eso, "el build siembra" solo se puede afirmar leyendo el
// archivo, y leerlo fue exactamente lo que no bastó en agosto de 2026.
import { execSync } from "child_process";
import { pathToFileURL } from "node:url";

import {
  decidirMigracion,
  validarUrlMigraciones,
} from "./migrate-deploy-guardas";
import {
  describirResultado,
  sembrarJobsRecurrentesEnBase,
  type ResultadoSiembra,
} from "./siembra-jobs-recurrentes";

// Mismo arranque que `prisma.config.ts`: en Vercel las variables ya estan en
// `process.env`, pero en un build local viven en el `.env`. Sin esto, la guarda
// de URL veria un entorno vacio que el CLI de Prisma si resuelve.
try {
  process.loadEnvFile();
} catch {
  // sin .env: se usan las variables ya presentes en process.env
}

/** Tope del `migrate deploy`. Sobra para el catalogo actual (~86 migraciones). */
const TIMEOUT_MS = 120_000;

const PREFIJO = "[migrate]";
const PREFIJO_SIEMBRA = "[siembra]";

/**
 * Lo UNICO que este paso lee del entorno. Se tipa aparte (y no como `NodeJS.ProcessEnv`) para
 * que un test pueda construir un entorno completo y determinista, sin arrastrar el de la
 * maquina —que en un portatil trae la `DATABASE_URL` local—.
 */
export interface EntornoDelPaso {
  VERCEL_ENV?: string;
  MIGRATE_ON_PREVIEW?: string;
  DIRECT_URL?: string;
  DATABASE_URL?: string;
}

/**
 * Los efectos del paso, inyectables. En produccion son los reales; un test los sustituye por
 * dobles y puede afirmar QUE se ejecuta, EN QUE ORDEN y que pasa cuando uno falla, sin tocar
 * ninguna base ni lanzar el CLI de Prisma.
 */
export interface EfectosDelPaso {
  /** Entorno leido. Ver `EntornoDelPaso`. */
  env: EntornoDelPaso;
  /** `prisma migrate deploy`. Lanza si falla (el orquestador traduce el desenlace). */
  aplicarMigraciones: () => void;
  /** Siembra de la primera ocurrencia de cada job recurrente. */
  sembrar: () => Promise<ResultadoSiembra[]>;
  log: (linea: string) => void;
  error: (linea: string, causa?: unknown) => void;
  /** Mata el proceso. NUNCA retorna: el tipo obliga a que el doble de un test lance. */
  salir: (codigo: number) => never;
}

function efectosReales(): EfectosDelPaso {
  return {
    // Explicito y no `process.env` entero: deja a la vista las cuatro variables que este paso
    // lee, y evita que un test tenga que fabricar un `ProcessEnv` completo para probarlo.
    env: {
      VERCEL_ENV: process.env.VERCEL_ENV,
      MIGRATE_ON_PREVIEW: process.env.MIGRATE_ON_PREVIEW,
      DIRECT_URL: process.env.DIRECT_URL,
      DATABASE_URL: process.env.DATABASE_URL,
    },
    aplicarMigraciones: () => {
      execSync("npx prisma migrate deploy", { stdio: "inherit", timeout: TIMEOUT_MS });
    },
    sembrar: () => {
      // El cliente Prisma de la app lee DATABASE_URL; el `migrate deploy` de arriba prefiere
      // DIRECT_URL. Si en el build solo estuviera la segunda, sembrar moriria por una variable
      // que aqui no aporta nada: se cae a la MISMA URL con la que se acaba de migrar, que es
      // justo la base que se quiere sembrar. Red, no suposicion — en produccion las dos estan.
      if (!process.env.DATABASE_URL && process.env.DIRECT_URL) {
        process.env.DATABASE_URL = process.env.DIRECT_URL;
      }
      return sembrarJobsRecurrentesEnBase();
    },
    log: (linea) => console.log(linea),
    error: (linea, causa) =>
      causa === undefined ? console.error(linea) : console.error(linea, causa),
    salir: (codigo) => process.exit(codigo),
  };
}

/**
 * Ficha 313 — SIEMBRA de la primera ocurrencia de cada job recurrente, DESPUES de migrar.
 *
 * POR QUE VIVE EN ESTE PASO Y NO EN UNO PROPIO. Un job recurrente se re-agenda solo DESPUES
 * de cada corrida: sin la primera fila la serie no arranca nunca. Los seeds existian desde
 * las features 90 y 124 y no estaban colgados de nada. Medido el 2026-08-28 contra la base de
 * produccion: 0 filas de `liberar_reprogramadas`, 0 transiciones `liberacion_reprogramada` en
 * TODA la historia de la base, 40 ordenes atrapadas en `reprogramada` con el mensajero del dia
 * anterior puesto (fuera del filtro de reasignables), y el rollup diario sin escribirse una
 * sola vez. Nada fallo: el build salio verde dos dias seguidos y la unica senal fue un
 * operador que no podia trabajar.
 *
 * Este es el UNICO paso del despliegue que corre contra la base, y ya tomo —arriba— la
 * decision de si esa base es suya para escribirla. Colgar la siembra de aqui evita duplicar
 * esa decision y hace que recrear la base (como el 2026-08-25) no vuelva a dejar las series
 * muertas: el siguiente despliegue las repone.
 *
 * ES IDEMPOTENTE: cada sembrador encola con la misma `dedupe_key` que usaria la recurrencia
 * para esa corrida y `enqueue` hace `ON CONFLICT DO NOTHING`, asi que en un despliegue normal
 * esto no crea nada y lo dice ("ya estaba encolada").
 *
 * Y SI FALLA, EL BUILD MUERE. Es deliberado: el fallo que motiva la ficha fue MUDO durante dos
 * dias. Un despliegue rojo es la senal mas barata que hay. Las migraciones ya se aplicaron
 * cuando esto corre, asi que morir aqui no deja la base a medias: deja la version anterior
 * sirviendo, que es lo correcto.
 */
async function sembrarRecurrentes(efectos: EfectosDelPaso): Promise<void> {
  efectos.log(`${PREFIJO_SIEMBRA} sembrando la primera ocurrencia de los jobs recurrentes…`);
  let resultados: ResultadoSiembra[];
  try {
    resultados = await efectos.sembrar();
  } catch (causa) {
    efectos.error(
      `${PREFIJO_SIEMBRA} FALLO la siembra de los jobs recurrentes.\n` +
        `${PREFIJO_SIEMBRA} sin la primera fila la serie NO arranca, y nada mas lo avisa:\n` +
        `${PREFIJO_SIEMBRA} las reprogramadas se quedan con el mensajero de ayer y el rollup diario no se escribe.`,
      causa,
    );
    efectos.salir(1);
    return;
  }
  for (const resultado of resultados) {
    efectos.log(`${PREFIJO_SIEMBRA} ${describirResultado(resultado)}`);
  }
}

/** Orquestacion completa del paso. Ver `EfectosDelPaso` para el porque de la inyeccion. */
export async function ejecutarPasoDeBaseDeDatos(
  parciales: Partial<EfectosDelPaso> = {},
): Promise<void> {
  const efectos: EfectosDelPaso = { ...efectosReales(), ...parciales };
  const { env, log, error, salir } = efectos;

  const decision = decidirMigracion(env.VERCEL_ENV, env.MIGRATE_ON_PREVIEW);
  if (!decision.aplicar) {
    // La misma decision gobierna la SIEMBRA: si esta base no es suya para migrarla, tampoco
    // lo es para escribirle filas. Un build local no encola nada en la base de nadie.
    log(`${PREFIJO} migraciones OMITIDAS — ${decision.motivo}`);
    log(`${PREFIJO_SIEMBRA} siembra de jobs recurrentes OMITIDA por el mismo motivo`);
    return;
  }

  // Nunca se imprime la URL: lleva credenciales. Solo el nombre de la variable.
  const url = validarUrlMigraciones({
    DIRECT_URL: env.DIRECT_URL,
    DATABASE_URL: env.DATABASE_URL,
  });

  if (url.status === "ausente") {
    error(`${PREFIJO} no hay DIRECT_URL ni DATABASE_URL definidas: no se puede migrar.`);
    salir(1);
    return;
  }

  if (url.status === "pooler_transaccional") {
    error(
      `${PREFIJO} ${url.variable} apunta al pooler TRANSACCIONAL (:6543 o pgbouncer=true).\n` +
        `${PREFIJO} \`migrate deploy\` necesita modo SESION (:5432) por el advisory lock:\n` +
        `${PREFIJO} define DIRECT_URL con el pooler en modo sesion y reintenta.`,
    );
    salir(1);
    return;
  }

  log(`${PREFIJO} aplicando migraciones (URL de ${url.variable})…`);
  try {
    efectos.aplicarMigraciones();
  } catch (causa) {
    // `execSync` mata el proceso por timeout con SIGTERM; distinguirlo del
    // fallo normal es lo que convierte "el build se colgo" en un diagnostico.
    const señal = (causa as { signal?: string }).signal;
    if (señal === "SIGTERM") {
      error(
        `${PREFIJO} \`migrate deploy\` excedio ${TIMEOUT_MS / 1000}s y fue abortado.\n` +
          `${PREFIJO} causa tipica: la URL no esta en modo sesion, o hay otro build migrando a la vez.`,
      );
    }
    // Sin migraciones aplicadas NO se siembra: la tabla `jobs` o el enum `job_tipo` podrian
    // no existir todavia, y el error real es el de arriba.
    salir(1);
    return;
  }

  // Migraciones aplicadas: `jobs` y `job_tipo` existen con seguridad, que es por lo que la
  // siembra va DESPUES y no antes.
  await sembrarRecurrentes(efectos);
}

// Solo auto-ejecuta cuando este archivo es el entrypoint (`tsx scripts/migrate-deploy.ts`,
// que es lo que corre `pnpm run build`); nunca cuando un test lo importa.
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  ejecutarPasoDeBaseDeDatos().catch((causa: unknown) => {
    console.error(`${PREFIJO} paso de base de datos abortado:`, causa);
    process.exit(1);
  });
}
