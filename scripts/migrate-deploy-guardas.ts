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

// ── FICHA 432 — LA UNICA MIGRACION QUE ESTE PASO PUEDE DESATASCAR SOLA ────────────────────
//
// INCIDENTE que lo motiva (2026-09-16 02:33 UTC): al mergear la 429, `migrate deploy` aplico
// `20260918120100_zona_sinpe` (columnas nullables) y acto seguido intento
// `20260918120200_zona_sinpe_no_nulo`, que ABORTA A PROPOSITO si alguna zona no tiene SINPE.
// Entre las dos tenia que correr la siembra, y `migrate deploy` no deja hueco: las aplica
// todas de un tiron. El build murio —lo disenado— pero ese fallo queda apuntado en
// `_prisma_migrations`, y desde entonces TODO `migrate deploy` posterior se niega con P3009.
// Los deploys de preview estuvieron caidos hasta que alguien lo resolvio a mano.
//
// POR QUE UNA LISTA BLANCA Y NO "resuelve cualquier P3009". Auto-resolver a ciegas convertiria
// este paso en una maquina de enmascarar fallos reales: una migracion que falle por un dato
// corrupto quedaria marcada como revertida y el despliegue seguiria como si nada. La lista
// tiene UNA entrada y se exige que el nombre coincida EXACTAMENTE.
//
// CADUCA. En cuanto las tres bases (local, preview, produccion) tengan el SINPE sembrado y la
// migracion aplicada, esta lista se vacia y el reintento deja de existir. No es una
// caracteristica del despliegue: es la salida de un incidente concreto.
export const MIGRACIONES_AUTO_RESOLUBLES: readonly string[] = [
  "20260918120200_zona_sinpe_no_nulo",
];

export type DecisionAutoResolucion =
  | { resolver: false; motivo: string }
  | { resolver: true; migracion: string };

/**
 * Lee la salida de un `migrate deploy` que fallo y dice si este paso puede desatascarlo solo.
 *
 * PURA a proposito: es la pieza que decide si se toca `_prisma_migrations`, asi que tiene que
 * poder probarse sin base, sin CLI y sin red, con la salida real de Prisma pegada como texto.
 *
 * Exige LAS DOS cosas —el codigo `P3009` y un nombre de la lista blanca— porque cada una sola
 * es insuficiente: `P3009` a secas no dice CUAL fallo, y el nombre puede aparecer en la salida
 * de un fallo completamente distinto (por ejemplo un error de sintaxis al aplicarla).
 */
export function decidirAutoResolucion(salida: string): DecisionAutoResolucion {
  if (!salida.includes("P3009")) {
    return { resolver: false, motivo: "el fallo no es P3009 (migracion previa fallida)" };
  }

  const migracion = MIGRACIONES_AUTO_RESOLUBLES.find((nombre) => salida.includes(nombre));
  if (migracion === undefined) {
    return {
      resolver: false,
      motivo: "es P3009 pero la migracion fallida NO esta en la lista blanca",
    };
  }

  return { resolver: true, migracion };
}
