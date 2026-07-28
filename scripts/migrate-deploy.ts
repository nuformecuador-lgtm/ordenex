// Paso de migraciones del build (`pnpm run build`). Sustituye al
// `prisma migrate deploy` pelado, que se ejecutaba en TODOS los entornos.
//
// Tres guardas, en orden:
//   1. Solo migra el deploy de PRODUCCION. Un preview comparte la base con
//      produccion; migrarla al abrir un PR es un efecto secundario invisible.
//   2. Aborta si la URL de migraciones apunta al pooler TRANSACCIONAL (:6543),
//      donde `migrate deploy` espera un advisory lock que ese modo no sostiene.
//   3. Timeout duro: si aun asi se cuelga, el build muere con mensaje en
//      minutos, no en horas.
//
// La logica pura vive en `migrate-deploy-guardas.ts` (testeada aparte).
import { execSync } from "child_process";

import {
  decidirMigracion,
  validarUrlMigraciones,
} from "./migrate-deploy-guardas";

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

function main(): void {
  const decision = decidirMigracion(
    process.env.VERCEL_ENV,
    process.env.MIGRATE_ON_PREVIEW,
  );
  if (!decision.aplicar) {
    console.log(`${PREFIJO} migraciones OMITIDAS — ${decision.motivo}`);
    return;
  }

  // Nunca se imprime la URL: lleva credenciales. Solo el nombre de la variable.
  const url = validarUrlMigraciones({
    DIRECT_URL: process.env.DIRECT_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  });

  if (url.status === "ausente") {
    console.error(
      `${PREFIJO} no hay DIRECT_URL ni DATABASE_URL definidas: no se puede migrar.`,
    );
    process.exit(1);
  }

  if (url.status === "pooler_transaccional") {
    console.error(
      `${PREFIJO} ${url.variable} apunta al pooler TRANSACCIONAL (:6543 o pgbouncer=true).\n` +
        `${PREFIJO} \`migrate deploy\` necesita modo SESION (:5432) por el advisory lock:\n` +
        `${PREFIJO} define DIRECT_URL con el pooler en modo sesion y reintenta.`,
    );
    process.exit(1);
  }

  console.log(`${PREFIJO} aplicando migraciones (URL de ${url.variable})…`);
  try {
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      timeout: TIMEOUT_MS,
    });
  } catch (error) {
    // `execSync` mata el proceso por timeout con SIGTERM; distinguirlo del
    // fallo normal es lo que convierte "el build se colgo" en un diagnostico.
    const señal = (error as { signal?: string }).signal;
    if (señal === "SIGTERM") {
      console.error(
        `${PREFIJO} \`migrate deploy\` excedio ${TIMEOUT_MS / 1000}s y fue abortado.\n` +
          `${PREFIJO} causa tipica: la URL no esta en modo sesion, o hay otro build migrando a la vez.`,
      );
    }
    process.exit(1);
  }
}

main();
