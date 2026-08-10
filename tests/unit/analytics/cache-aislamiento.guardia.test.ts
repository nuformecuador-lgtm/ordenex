import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 128 / T2.2 — GUARDIA DE R21: `next/cache` se importa desde UN SOLO archivo.
//
// ⚠ ESTE GUARDIA **SOBREVIVE AL MERGE**: censa CONTENIDO, no el diff contra `dev`. Vive en su
// propio archivo y NO cuelga del guardia de frontera de R19, que es branch-scoped y se retira
// en el mismo PR (T8.5).
//
// Y NO ES SOLO HIGIENE. Verificado en el arbol:
//   - `unstable_cache` lanza `Invariant: incrementalCache missing` fuera de un request de Next
//     (`node_modules/next/dist/server/web/spec-extension/unstable-cache.js:59-67`);
//   - `revalidateTag` lanza `Invariant: static generation store missing`
//     (`node_modules/next/dist/server/web/spec-extension/revalidate.js:104-107`).
// Un import mal colocado tumbaria la suite unitaria del servicio de analitica —que hoy corre
// sin runtime de Next y sin `DATABASE_URL`— y el script CLI del backfill, que es un proceso
// `tsx` fuera de Next. Esa es exactamente la razon por la que el backfill invalida por JOB
// ENCOLADO y no llamando a `revalidateTag` (design §7.1).

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const EXT = new Set([".ts", ".tsx"]);

/**
 * El ambito del guardia: las capas que NO pueden depender de un runtime de Next. Las Server
 * Actions de `lib/actions/` quedan fuera —viven dentro de un request y ya usan
 * `revalidatePath`—, y lo mismo `app/`.
 */
const AMBITO = ["lib/analytics", "lib/cache", "lib/services", "lib/repositories", "scripts"];

/**
 * Los archivos autorizados. La version original de este guardia decia «uno; si algun dia son
 * dos, esta lista lo dice en voz alta». Son dos, y aqui esta dicho en voz alta:
 *
 *  - `next-analitica-cache.ts` — feature 128.
 *  - `next-tablero-dia-cache.ts` — feature 192, la cache de ~15 s del tablero del dia. Es un
 *    puerto DISTINTO y a proposito (`ITableroDiaCache`, un solo metodo, sin `tags` y sin
 *    `invalidar`): reutilizar `IAnaliticaCache` habria arrastrado la invalidacion por evento
 *    que su R71 prohibe, y habria metido sus entradas en el espacio de tags de la analitica,
 *    que es justo lo que su R38 separa.
 *
 * Lo que el guardia protege NO cambia: cada adaptador sigue siendo el UNICO sitio de su
 * feature que toca `next/cache`, y ninguna otra capa puede importarlo. Un tercer archivo
 * tiene que volver a pasar por aqui y justificarse.
 */
const ADAPTADORES = ["lib/cache/next-analitica-cache.ts", "lib/cache/next-tablero-dia-cache.ts"];

function archivos(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      salida.push(...archivos(rel));
    } else if (EXT.has(path.extname(e.name))) {
      salida.push(rel);
    }
  }
  return salida;
}

function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** `import ... from "next/cache"`, `require("next/cache")` y el `import()` dinamico. */
const IMPORTA_NEXT_CACHE = /(from\s*|require\(\s*|import\(\s*)["']next\/cache["']/;

describe("R21 · solo el adaptador importa `next/cache`", () => {
  it("ningun servicio, repositorio, modulo de analitica, script ni handler de job lo importa", () => {
    const infractores = AMBITO.flatMap((d) => archivos(d))
      .filter((rel) => !ADAPTADORES.includes(rel))
      .filter((rel) => IMPORTA_NEXT_CACHE.test(soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))));

    expect(
      infractores,
      "`unstable_cache` lanza `Invariant: incrementalCache missing` y `revalidateTag` lanza " +
        "`Invariant: static generation store missing` fuera de un request de Next. Un import " +
        `de "next/cache" en estas capas tumba la suite unitaria y el CLI del backfill. El ` +
        `unicos archivos autorizados son ${ADAPTADORES.join(" y ")}. Archivos: ` +
        infractores.join(", "),
    ).toEqual([]);
  });

  it("los adaptadores SI lo importan (si no, el guardia seria verde por vacio)", () => {
    for (const adaptador of ADAPTADORES) {
      const fuente = fs.readFileSync(path.join(REPO_ROOT, adaptador), "utf8");
      expect(IMPORTA_NEXT_CACHE.test(soloCodigo(fuente)), adaptador).toBe(true);
    }
    expect(archivos("lib/services").length).toBeGreaterThan(20);
  });

  it("el censo DISCRIMINA un import de verdad de una mencion en prosa", () => {
    const infractor = `import { revalidateTag } from "next/cache";\nexport const x = 1;`;
    expect(IMPORTA_NEXT_CACHE.test(soloCodigo(infractor))).toBe(true);
    const prosa = `// algun dia quiza haga falta next/cache aqui\nexport const x = 1;`;
    expect(IMPORTA_NEXT_CACHE.test(soloCodigo(prosa))).toBe(false);
  });

  it("el puerto es neutral: `IAnaliticaCache` no conoce Next ni Prisma", () => {
    const puerto = soloCodigo(
      fs.readFileSync(path.join(REPO_ROOT, "lib/interfaces/external/IAnaliticaCache.ts"), "utf8"),
    );
    expect(puerto).not.toMatch(/next\//);
    expect(puerto).not.toMatch(/@prisma\/client/);
  });
});
