import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

// Feature 128 / T8.1 — GUARDIA DE R18 y R19: LA FRONTERA DE LA 128.
//
// ══════════════════════════════════════════════════════════════════════════════════════════
// ⚠ ESTE GUARDIA **CADUCA AL MERGEAR**, Y SE RETIRA EN EL MISMO PR QUE LO INTRODUCE (T8.5).
//
// Mide el diff de ESTA rama contra `origin/dev`. Una vez en `dev`, «el diff contra `dev`» pasa
// a juzgar toda rama posterior: cualquier feature ajena que toque un archivo que no este en la
// lista de ABAJO —una lista que habla de la 128 y de nada mas— se pondria roja sin haber hecho
// nada mal. Deja de proteger a la 128 y se convierte en un impuesto sobre las demas. Decidir su
// retirada AQUI, y no «cuando duela», es lo unico que evita el rojo sin infraccion.
//
// **LO QUE SOBREVIVE AL MERGE son otros CUATRO guardias**, que no miden diff y valen para
// siempre. NINGUNO cuelga de este, precisamente porque este se va:
//   - `cache-aislamiento.guardia.test.ts`     (R21) — solo el adaptador importa `next/cache`
//   - `cache-financiera.guardia.test.ts`      (R15) — nadie cachea dinero
//   - `cache-clave-alcance.guardia.test.ts`   (R6)  — la clave cubre las 4 variantes de alcance
//   - `cache-tags.guardia.test.ts`            (R20) — nadie escribe el literal del tag
// ══════════════════════════════════════════════════════════════════════════════════════════
//
// Lo que R19 protege NO es el orden por el orden: es que esta feature no mueva un solo numero.
// `lib/analytics/metrics.ts` (el catalogo de la 135) y la logica de calculo de la 124, 125,
// 126 y 127 quedan intactos; lo unico que cambia es DE DONDE salen los cubos.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const BASE = "origin/dev";

/**
 * Los archivos EXISTENTES que la 128 modifica, y por que. Es la lista de `design.md §1` mas
 * `db/schema.prisma`, que aquel documento no listaba (§9 hablaba solo de los dos `.sql`).
 */
const MODIFICABLES = new Map<string, string>([
  [
    "lib/actions/analitica-operativa.ts",
    "solo el composition root `construirServicio`: envuelve el repositorio de rollup y deja el " +
      "vivo desnudo. Cero cambios en `consultarAnaliticaOperativa` (R18).",
  ],
  [
    "lib/services/jobs/analitica-rollup-diario-handler.ts",
    "un parametro `invalidador` con default y una llamada DESPUES de que `agregarFecha` " +
      "resuelva (R10/R11). No se toca `AnaliticaRollupService` ni el calculo.",
  ],
  [
    "scripts/backfill-analitica.ts",
    "encola el job de invalidacion al cerrar una corrida con escritura (R12/R13), entrando por " +
      "`EntornoCli`, que ya existia y ya era inyectable.",
  ],
  [
    "app/api/cron/procesar-jobs/route.ts",
    "registra el tipo nuevo en `buildHandlers` y NO en `buildRecurrencias` (R14), y pasa el " +
      "invalidador real al handler del rollup diario.",
  ],
  [
    "db/schema.prisma",
    "DESVIACION DECLARADA respecto de design.md §1, que no lo listaba: el valor nuevo del enum " +
      "`job_tipo` tiene que existir tambien en el datamodel o Prisma y la base divergen. Mismo " +
      "alcance que la migracion de la 124 (un valor de enum, cero tablas).",
  ],
  [
    "feature_list.json",
    "bookkeeping del leader, no de esta feature. Entra en el diff porque el alta de la 128 se " +
      "commiteo en esta misma rama.",
  ],
]);

/** Los sitios donde la 128 puede AÑADIR archivos. */
const PREFIJOS_NUEVOS = [
  "lib/analytics/cache-",
  "lib/cache/",
  "lib/config/analitica-cache.ts",
  "lib/interfaces/external/IAnaliticaCache.ts",
  "lib/repositories/CachedAnalitica",
  "lib/services/jobs/analitica-invalidacion-",
  "db/migrations/20260803140000_job_tipo_analitica_invalidacion_cache/",
  "specs/128-analitica-cache-invalidacion/",
  "progress/impl_128",
  "tests/unit/analytics/_cache-falsa.ts",
  "tests/unit/analytics/cache-",
  "tests/unit/scripts/backfill-analitica-invalidacion.test.ts",
  "tests/unit/services/jobs-registro.test.ts",
  "tests/integration/db/job-tipo-analitica-invalidacion-migration.test.ts",
];

interface CambioGit {
  readonly estado: string;
  readonly ruta: string;
}

function diffContraDev(): CambioGit[] {
  const salida = execFileSync("git", ["diff", "--name-status", BASE], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return salida
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const partes = l.split(/\s+/);
      return { estado: partes[0], ruta: partes[partes.length - 1] };
    });
}

describe("R19 · el diff de la rama contra `dev` no toca ningun archivo fuera de la lista declarada", () => {
  const cambios = diffContraDev();

  it("el guardia esta midiendo algo (si el diff fuera vacio, seria verde por vacio)", () => {
    expect(cambios.length).toBeGreaterThan(10);
  });

  it("los archivos EXISTENTES modificados son exactamente los declarados", () => {
    const modificados = cambios
      .filter((c) => c.estado !== "A")
      .map((c) => c.ruta)
      .filter((ruta) => !MODIFICABLES.has(ruta));

    expect(
      modificados,
      "R19: la 128 no modifica mas archivos existentes que los de `design.md §1`. En " +
        "particular NO toca `lib/analytics/metrics.ts` (catalogo de la 135) ni la logica de " +
        "calculo de la 124/125/126/127: esta feature no mueve un solo numero. Fuera de la " +
        "lista: " +
        modificados.join(", "),
    ).toEqual([]);
  });

  it("los archivos NUEVOS caen dentro de los prefijos de la feature", () => {
    const nuevos = cambios
      .filter((c) => c.estado === "A")
      .map((c) => c.ruta)
      .filter((ruta) => !PREFIJOS_NUEVOS.some((p) => ruta.startsWith(p)));

    expect(nuevos, "archivos nuevos fuera del ambito de la 128: " + nuevos.join(", ")).toEqual([]);
  });

  it("`lib/analytics/metrics.ts` NO aparece en el diff", () => {
    // Se dice aparte porque es LA linea que no se cruza: la 135 lo dejo escrito con
    // `ANALITICA_TAGS` «consumidas por la 128», y sus tres divergencias estan aplazadas a la
    // ficha 175. La 128 lo CONSUME y no lo corrige.
    expect(cambios.map((c) => c.ruta)).not.toContain("lib/analytics/metrics.ts");
  });

  it("ningun archivo de calculo de la 124/125/126/127 aparece en el diff", () => {
    const intocables = [
      "lib/services/AnaliticaOperativaService.ts",
      "lib/services/AnaliticaFinancieraService.ts",
      "lib/services/AnaliticaRollupService.ts",
      "lib/services/AnaliticaBackfillService.ts",
      "lib/repositories/AnaliticaOperativaRollupRepository.ts",
      "lib/repositories/AnaliticaOperativaVivaRepository.ts",
      "lib/repositories/AnaliticaRollupRepository.ts",
      "lib/analytics/consulta.ts",
      "lib/analytics/alcance.ts",
      "lib/analytics/alcance-columnas.ts",
      "next.config.ts",
    ];
    const tocados = cambios.map((c) => c.ruta).filter((r) => intocables.includes(r));
    expect(
      tocados,
      "`next.config.ts` esta en esta lista por D1: activar `cacheComponents` es una bandera " +
        "GLOBAL que cambia el modelo de renderizado de toda la app, y ningun gate de este repo " +
        "corre `next build`. Tocados: " + tocados.join(", "),
    ).toEqual([]);
  });
});

describe("R18 · las dos Server Actions conservan su aridad y su tipo de retorno", () => {
  // La 131 (tablero operativo) y la 132 (tablero financiero) las consumen y estan vivas.
  const operativa = fs.readFileSync(
    path.join(REPO_ROOT, "lib", "actions", "analitica-operativa.ts"),
    "utf8",
  );
  const financiera = fs.readFileSync(
    path.join(REPO_ROOT, "lib", "actions", "analitica-financiera.ts"),
    "utf8",
  );

  it("`consultarAnaliticaOperativa(entrada, deps = {})` -> `Promise<ResultadoOperativo>`", () => {
    expect(operativa).toMatch(
      /export async function consultarAnaliticaOperativa\(\s*entrada: EntradaOperativa,\s*deps: AnaliticaOperativaDeps = \{\},\s*\): Promise<ResultadoOperativo>/,
    );
  });

  it("`consultarMetricaFinanciera(metricaId, filtroRaw, deps = {})` -> `Promise<RespuestaFinanciera>`", () => {
    expect(financiera).toMatch(
      /export async function consultarMetricaFinanciera\(\s*metricaId: string,\s*filtroRaw: unknown,\s*deps: AnaliticaFinancieraActionDeps = \{\},\s*\): Promise<RespuestaFinanciera>/,
    );
  });

  it("ningun parametro nuevo OBLIGATORIO: los consumidores no cambian ni una llamada", () => {
    // Un tercer parametro sin default en la operativa (o un cuarto en la financiera) romperia
    // a la 131 y a la 132 en `pnpm typecheck`, no aqui; este guardia lo dice antes y con nombre.
    const firmaOperativa = /consultarAnaliticaOperativa\(([\s\S]*?)\): Promise/.exec(operativa)![1];
    expect(firmaOperativa.split(",").filter((p) => p.trim().length > 0)).toHaveLength(2);
    const firmaFinanciera = /consultarMetricaFinanciera\(([\s\S]*?)\): Promise/.exec(financiera)![1];
    expect(firmaFinanciera.split(",").filter((p) => p.trim().length > 0)).toHaveLength(3);
  });
});
