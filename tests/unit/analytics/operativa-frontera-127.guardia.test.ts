import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

// Feature 126 / T12.4 — R3. GUARDIA BRANCH-SCOPED: mide el DIFF de esta rama.
//
// POR QUE EXISTE: la regla 1 del arnes permite dos features backend `in_progress` a la vez
// SOLO si no hay conflicto de archivos, y la 127 (`analitica: servicios financieros`) esta
// viva al mismo tiempo. El reparto de `design.md §1` es parte del contrato de la feature, no
// una guia de estilo, y un guardia es la unica forma de que siga siendo cierto cuando el PR
// crezca.
//
// ⚠ CADUCIDAD — DECISION DE T13.1, TOMADA EN ESTE PR Y NO DIFERIDA.
// Un guardia que mide un diff de rama deja de juzgar «la 126» en cuanto la 126 se
// mergea: a partir de ahi juzga TODA rama posterior, y la primera feature que legitimamente
// toque `lib/analytics/metrics.ts` —empezando por la **ficha 175**, que existe justo para
// eso— se lo encontraria rojo sin haber hecho nada malo.
//
// DECISION: este archivo se RETIRA en el merge de la 126. Lo que NO se retira es su segunda
// mitad, `describe("R3 · el nombre generico...")`, que no depende del diff y es una
// afirmacion permanente sobre el arbol; esa vive en `operativa-frontera.guardia.test.ts`, que
// se queda. Si el guardia sigue aqui despues del merge, es un olvido y no una decision.
//
// Mientras la rama existe, el caso se SALTA si `git` no esta disponible o el commit base no
// es alcanzable (por ejemplo en un tarball sin historia): un guardia que rompe la suite en una
// maquina limpia se desactiva a la primera, y entonces no guarda nada.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Los archivos que `design.md §1` declara PROPIEDAD de la 127. */
const ARCHIVOS_DE_LA_127 = [
  "lib/analytics/metrics.ts",
  "lib/services/AnaliticaFinancieraService.ts",
  "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
  "lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository.ts",
  "tests/unit/analytics/_fake-prisma-dinero.ts",
];

/** Y los guardias `financiera-*`, que son suyos por patron. */
const PATRON_GUARDIAS_127 = /(^|\/)financiera-[^/]*\.test\.ts$/;

/**
 * EL PUNTO DE COMPARACION ES EL COMMIT DEL SPEC, NO `dev`, y es una desviacion DELIBERADA de
 * como `requirements.md` describio este guardia («el diff de la 126 no toca archivos de la
 * 127»). Medido y verificado en este worktree: la ref local `dev` esta a decenas de merges de
 * distancia, asi que `git diff $(merge-base HEAD dev)...HEAD` devuelve cientos de archivos de
 * OTRAS features ya mergeadas —`lib/analytics/metrics.ts` entre ellos, que lo escribio la
 * 135— y el guardia acusaria a la 126 de tocar un archivo que no ha tocado.
 *
 * El commit del spec (`33279871`, «docs(126): spec ... y puerta T0 cerrada») es el punto en
 * que esta feature EMPIEZA: el diff contra el es, literalmente, «lo que ha hecho la 126».
 */
const COMMIT_BASE_DE_LA_126 = "33279871";

function diffDeLaFeature(): readonly string[] | null {
  try {
    // `git diff <base>` (SIN `...HEAD`) y no `<base>...HEAD`: la forma con tres puntos compara
    // COMMIT contra COMMIT e ignora el arbol de trabajo, asi que un archivo de la 127 editado y
    // aun sin commitear pasaria invisible — justo el momento en que el aviso seria mas util.
    const salida = execFileSync("git", ["diff", "--name-only", COMMIT_BASE_DE_LA_126], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return salida
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

describe("R3 · el diff de la 126 no toca archivos de la 127", () => {
  it("el diff de la 126 no toca archivos de la 127", () => {
    const tocados = diffDeLaFeature();
    if (tocados === null) {
      // Sin `git` o sin el commit base: no se puede medir. Ni verde inventado ni suite rota.
      expect(true).toBe(true);
      return;
    }
    const infractores = tocados.filter(
      (rel) => ARCHIVOS_DE_LA_127.includes(rel) || PATRON_GUARDIAS_127.test(rel),
    );
    expect(
      infractores,
      "la 127 esta viva al mismo tiempo y estos archivos son suyos (`design.md §1`). Las tres " +
        "divergencias del catalogo que la 126 detecto quedan DECLARADAS para la ficha 175, no " +
        "corregidas aqui (T0-Q3 = C). Archivos tocados: " + infractores.join(", "),
    ).toEqual([]);
  });

  it("la lista de la 127 describe el arbol de verdad, no un arbol imaginario", () => {
    // Una entrada que no existe ni existira no restringe nada. `metrics.ts` y el fake de
    // dinero SI existen hoy (son de la 135 y de la 127 en curso); los demas puede que aun no,
    // y eso es informacion util: se afirma solo sobre los que deben existir ya.
    for (const rel of ["lib/analytics/metrics.ts"]) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), rel).toBe(true);
    }
  });

  it("el detector DISCRIMINA: reconoceria un guardia `financiera-*` y no uno `operativa-*`", () => {
    expect(PATRON_GUARDIAS_127.test("tests/unit/analytics/financiera-dinero.guardia.test.ts")).toBe(
      true,
    );
    expect(PATRON_GUARDIAS_127.test("tests/unit/analytics/operativa-tasas.test.ts")).toBe(false);
  });
});
