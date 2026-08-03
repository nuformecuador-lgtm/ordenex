import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 131 (T4.1, T4.2) — el guardia de frontera del tablero operativo.
//
// TODO lo que queda aqui censa EL ARBOL, no el diff: sobrevive al merge y sigue diciendo
// la verdad cualquier dia. R1 (la analitica entra por la Server Action y por ninguna otra
// puerta), R10 (el tablero no reimplementa alcance ni identidad) y R25 (el tablero
// operativo no toca nada financiero, ni el catalogo de servidor). Sigue el patron de
// `tests/unit/analytics/operativa-frontera.guardia.test.ts` (126).
//
// HUBO un segundo bloque BRANCH-SCOPED (T4.2) que medía el diff contra `origin/dev`.
// **Se retira en el PR de esta feature**, que es donde su propia cabecera de caducidad
// decia que habia que decidirlo. El razonamiento, para que nadie lo reponga:
//
//   - De las cinco cosas que afirmaba, la unica que habla del CODIGO FINAL —que el
//     tablero operativo no toca nada financiero— ya la cubre, y con mas fuerza, el censo
//     permanente de R25: aquel mira el arbol entero y no solo lo que esta rama cambio.
//   - Las otras cuatro eran propiedades del DIFF («esta rama no toca `AnaliticaShell.tsx`,
//     ni `components/private/analytics/`, ni `lib/**`»). Tras el merge son **falsas por
//     diseno**: la 132 TIENE que modificar `AnaliticaShell.tsx` para anadir su slot
//     `financiero`. Mantenerlas solo puede producir rojos ajenos —o verdes vacios, cuando
//     el diff contra `origin/dev` pase a estar vacio—, que es la leccion de
//     `frontera.guardia.test.ts` (retirado por el chore del PR #232) y de la T13.1 de la 126.
//
// R1 y R10 se censan sobre `app/(app)/analitica/` ENTERA, no solo sobre el subarbol de la
// 131: la puerta de datos y el recorte por rol son propiedades de la RUTA, y un archivo
// nuevo de la 132 o de la 133 que importara el servicio abriria el mismo agujero.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const EXT = new Set([".ts", ".tsx"]);

const DIR_ANALITICA = "app/(app)/analitica";
const DIR_OPERATIVO = "app/(app)/analitica/_components/operativo";

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

/** Quita comentarios: una MENCION EN PROSA no es una importacion. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function codigoDe(rel: string): string {
  return soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

function infractores(dir: string, patrones: readonly RegExp[]): string[] {
  return archivos(dir).filter((rel) => {
    const codigo = codigoDe(rel);
    return patrones.some((p) => p.test(codigo));
  });
}

/* ========================================================================== */
/* PARTE PERMANENTE — censa el arbol                                          */
/* ========================================================================== */

/**
 * R1 — la analitica operativa entra por `consultarAnaliticaOperativa` y por NINGUNA otra
 * puerta. Un componente que importase el servicio o el repositorio saltaria el borde que
 * resuelve el actor, interseca el filtro con el alcance y audita el denegado.
 *
 * `@prisma/client` se busca como import de VALOR: `import type` se borra en compilacion.
 */
const PUERTA_TRASERA: readonly RegExp[] = [
  /AnaliticaOperativaService/,
  /AnaliticaOperativa\w*Repository/,
  /from\s+["']@\/lib\/db/,
  /import\s+(?!type\b)[^;]*from\s+["']@prisma\/client["']/,
  /getPrismaClient/,
];

/** R10 — el alcance por rol y la identidad ya los aplico el servidor. No se reimplementan. */
const ALCANCE_E_IDENTIDAD: readonly RegExp[] = [
  /from\s+["']@\/lib\/analytics\/alcance/,
  /from\s+["']@\/lib\/analytics\/identidad["']/,
  /\besAccesoTotal\b/,
  /\bresolverAlcance\b/,
  /\bseudonimizar\w*/,
];

/** R25 — nada financiero, y nada del catalogo de SERVIDOR, en el subarbol del tablero. */
const FINANCIERO_Y_CATALOGO: readonly RegExp[] = [
  /analitica-financiera/,
  /from\s+["']@\/lib\/analytics\/metrics["']/,
  /["']financiera["']/,
];

describe("Feature 131 (R1) — la ruta de analitica consulta SOLO por la Server Action", () => {
  it("el tablero operativo solo consulta por la Server Action de la 126", () => {
    const malos = infractores(DIR_ANALITICA, PUERTA_TRASERA);
    expect(
      malos,
      "toda cifra del tablero sale de `consultarAnaliticaOperativa` (lib/actions/" +
        "analitica-operativa.ts). Importar el servicio, el repositorio o Prisma desde la ruta " +
        "salta el borde que resuelve el actor, interseca el filtro con el alcance y audita el " +
        "denegado. Archivos: " +
        malos.join(", "),
    ).toEqual([]);
  });

  it("y la ruta no define ningun handler de `app/api` para analitica", () => {
    // `docs/architecture.md`: las lecturas internas van por Server Action; los route
    // handlers son para webhooks y API publica. Una ruta de analitica seria una segunda
    // superficie con su propio gating y su propia forma de olvidarse de auditar.
    const handlers = archivos("app/api").filter((rel) => /analitica/i.test(rel));
    expect(handlers).toEqual([]);
  });

  it("el censo mira archivos de verdad (si no, seria verde por vacio)", () => {
    expect(archivos(DIR_ANALITICA).length).toBeGreaterThan(5);
    expect(archivos(DIR_OPERATIVO).length).toBeGreaterThan(4);
  });
});

describe("Feature 131 (R10) — el tablero no reimplementa alcance ni identidad", () => {
  it("el tablero no reimplementa alcance ni identidad", () => {
    const malos = infractores(DIR_ANALITICA, ALCANCE_E_IDENTIDAD);
    expect(
      malos,
      "el alcance por rol lo aplica `prepararConsultaAnalitica` ANTES de tocar la base, y la " +
        "seudonimizacion ocurre en el servicio: el uuid real del mensajero no cruza la " +
        "frontera. Recortar otra vez en el cliente solo puede: (a) esconder datos que el " +
        "servidor SI concedio, o (b) intentar deshacer una seudonimizacion. Archivos: " +
        malos.join(", "),
    ).toEqual([]);
  });
});

describe("Feature 131 (R25) — el tablero operativo no toca nada financiero", () => {
  it("el tablero operativo no toca nada financiero y `lib/actions/analitica.ts` no existe", () => {
    const malos = infractores(DIR_OPERATIVO, FINANCIERO_Y_CATALOGO);
    expect(
      malos,
      "el subarbol de la 131 es OPERATIVO. Lo financiero es de la 132 y vive en su propio " +
        "subarbol; `lib/analytics/metrics` es dato de SERVIDOR (23 metricas con su alcance por " +
        "rol, su fuente y sus nombres de tabla) y arrastrarlo a un modulo de cliente publicaria " +
        "ese censo al navegador. Archivos: " +
        malos.join(", "),
    ).toEqual([]);

    // El nombre generico es de las dos features y por tanto de ninguna: la 131 es la
    // primera consumidora frontend que podria sentir la tentacion de crearlo.
    expect(fs.existsSync(path.join(REPO_ROOT, "lib", "actions", "analitica.ts"))).toBe(false);
  });
});

describe("Feature 131 — el censo DISCRIMINA", () => {
  it("detecta un archivo infractor sintetico y NO marca una mencion en prosa", () => {
    // Sin este caso el guardia podria ser verde por vacio: unas expresiones regulares que
    // no casan con nada dan exactamente el mismo verde que un arbol limpio.
    const infractor = `
      import { AnaliticaOperativaService } from "@/lib/services/AnaliticaOperativaService";
      import { resolverAlcance } from "@/lib/analytics/alcance";
      import type { X } from "@/lib/types/analitica-financiera";
      export function Panel() { return null; }
    `;
    expect(PUERTA_TRASERA.some((p) => p.test(soloCodigo(infractor)))).toBe(true);
    expect(ALCANCE_E_IDENTIDAD.some((p) => p.test(soloCodigo(infractor)))).toBe(true);
    expect(FINANCIERO_Y_CATALOGO.some((p) => p.test(soloCodigo(infractor)))).toBe(true);

    const prosa = [
      "// el alcance lo aplica resolverAlcance en el servidor, no aqui",
      "/* nada de AnaliticaOperativaService ni de analitica-financiera */",
      "export function Panel() { return null; }",
    ].join("\n");
    expect(PUERTA_TRASERA.some((p) => p.test(soloCodigo(prosa)))).toBe(false);
    expect(ALCANCE_E_IDENTIDAD.some((p) => p.test(soloCodigo(prosa)))).toBe(false);
    expect(FINANCIERO_Y_CATALOGO.some((p) => p.test(soloCodigo(prosa)))).toBe(false);
  });

  it("un `import type` de Prisma no se marca, pero uno de valor si", () => {
    const soloTipo = `import type { RolValue } from "@prisma/client";`;
    const valor = `import { Prisma } from "@prisma/client";`;
    expect(PUERTA_TRASERA.some((p) => p.test(soloTipo))).toBe(false);
    expect(PUERTA_TRASERA.some((p) => p.test(valor))).toBe(true);
  });
});
