// Guardas PURAS del paso de migraciones del build (sin efectos: ni env, ni
// proceso, ni red). Viven aparte de `scripts/migrate-deploy.ts` para poder
// testearlas sin ejecutar el script, siguiendo el patron de los helpers puros
// del repo (p. ej. `carga-masiva-clasificacion.ts`).
//
// Contexto (2026-07-27): el build era `prisma generate && prisma migrate deploy
// && next build` en TODOS los entornos, y los previews de Vercel comparten la
// base de Supabase con produccion -> el build de un preview migraba la base de
// PRODUCCION al abrir el PR. Ademas, con la URL equivocada (pooler
// transaccional) `migrate deploy` no falla: espera el advisory lock para
// siempre, y el build quedo ~2 h colgado sin un solo mensaje.

/** Puerto del pooler TRANSACCIONAL de Supabase; el CLI de Prisma no funciona ahi. */
const PUERTO_POOLER_TRANSACCIONAL = "6543";

/** Decision de si el build debe aplicar migraciones, con el motivo cuando no. */
export type DecisionMigracion =
  | { aplicar: true }
  | { aplicar: false; motivo: string };

/**
 * Migra el deploy de PRODUCCION. En preview solo migra si el entorno declara
 * `MIGRATE_ON_PREVIEW=true`, que significa "esta base es de pruebas, no la de
 * produccion". Development y los builds locales (sin `VERCEL_ENV`) nunca migran.
 *
 * El flag es explicito a proposito: mientras Preview apunte a la MISMA base que
 * produccion, migrar desde un PR le cambia el esquema a produccion sin que
 * nadie lo pida. Cuando Preview tenga su propia base, se pone el flag ahi y
 * cada preview aplica sus migraciones contra la suya — que es lo que se quiere.
 *
 * Sin el flag, un preview cuya rama trae una migracion nueva corre contra una
 * base que aun no la tiene: fallara en runtime hasta que alguien la aplique.
 */
export function decidirMigracion(
  vercelEnv: string | undefined,
  migrateOnPreview: string | undefined,
): DecisionMigracion {
  if (vercelEnv === "production") return { aplicar: true };

  if (vercelEnv === "preview") {
    if (migrateOnPreview === "true") return { aplicar: true };
    return {
      aplicar: false,
      motivo:
        "entorno 'preview' sin MIGRATE_ON_PREVIEW=true: la base podria ser la de produccion",
    };
  }

  if (vercelEnv === undefined || vercelEnv === "") {
    return {
      aplicar: false,
      motivo: "build local (sin VERCEL_ENV): usa `pnpm db:migrate` a mano",
    };
  }

  return {
    aplicar: false,
    motivo: `entorno '${vercelEnv}': solo migran produccion y los previews con base propia`,
  };
}

/** Variables candidatas a URL de migraciones, en orden de preferencia. */
export interface EnvUrls {
  DIRECT_URL?: string;
  DATABASE_URL?: string;
}

/** Nombre de la variable que aporto la URL (nunca la URL: lleva credenciales). */
export type VariableUrl = "DIRECT_URL" | "DATABASE_URL";

export type ResultadoUrl =
  /** Utilizable por el CLI de Prisma. */
  | { status: "ok"; variable: VariableUrl }
  /** No hay ninguna URL definida. */
  | { status: "ausente" }
  /** Apunta al pooler transaccional: `migrate deploy` se colgaria. */
  | { status: "pooler_transaccional"; variable: VariableUrl };

/** ¿La URL apunta al pooler transaccional? Ante duda (URL no parseable), no. */
function esPoolerTransaccional(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.port === PUERTO_POOLER_TRANSACCIONAL) return true;
    return parsed.searchParams.get("pgbouncer") === "true";
  } catch {
    // URL no parseable: no se puede afirmar nada, asi que no se bloquea el
    // build. La guarda es una ayuda de diagnostico, no una barrera de
    // seguridad; si la URL es invalida, el propio Prisma dara el error real.
    return false;
  }
}

/**
 * Resuelve que URL usaria el CLI de Prisma y valida que no sea el pooler
 * transaccional. Espeja la precedencia de `prisma.config.ts`
 * (`DIRECT_URL ?? DATABASE_URL`): si las dos divergen, el error saldria del
 * mismo sitio que la config real.
 */
export function validarUrlMigraciones(env: EnvUrls): ResultadoUrl {
  const candidatas: Array<[VariableUrl, string | undefined]> = [
    ["DIRECT_URL", env.DIRECT_URL],
    ["DATABASE_URL", env.DATABASE_URL],
  ];

  for (const [variable, url] of candidatas) {
    if (url === undefined || url.trim() === "") continue;
    return esPoolerTransaccional(url)
      ? { status: "pooler_transaccional", variable }
      : { status: "ok", variable };
  }

  return { status: "ausente" };
}
