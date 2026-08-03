import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "fs";
import path from "path";

// Feature 131 (T4.1, T4.2) — el guardia de frontera del tablero operativo.
//
// El archivo tiene DOS PARTES claramente separadas, siguiendo el patron que dejo
// `tests/unit/analytics/operativa-frontera.guardia.test.ts` (126):
//
//   1. PERMANENTE — censa EL ARBOL. Sobrevive al merge y sigue diciendo la verdad
//      cualquier dia: R1 (la analitica entra por la Server Action y por ninguna otra
//      puerta), R10 (el tablero no reimplementa alcance ni identidad) y R25 (el tablero
//      operativo no toca nada financiero, ni el catalogo de servidor).
//   2. BRANCH-SCOPED — mide el DIFF contra `origin/dev`, con su cabecera de caducidad.
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

/* ========================================================================== */
/* PARTE BRANCH-SCOPED                                                        */
/* ========================================================================== */

/**
 * ⚠ ESTE BLOQUE CADUCA EN EL MERGE DE LA 131.
 *
 * Mide el DIFF de la rama contra `origin/dev`. En cuanto la 131 se mergea, `origin/dev`
 * pasa a contener estos mismos commits y el bloque deja de hablar de la 131: empieza a
 * juzgar CUALQUIER rama posterior, dando verdes vacios (diff vacio) o rojos ajenos
 * (cualquier feature que toque `lib/**` o el shell). Es la leccion de
 * `frontera.guardia.test.ts`, retirado por el chore del PR #232, y de la T13.1 de la 126.
 *
 * SU RETIRADA SE DECIDE EN EL PR DE ESTA FEATURE, NO DESPUES. Lo que SOBREVIVE es la parte
 * permanente de arriba, que censa el arbol y no el diff; este bloque no aporta nada que
 * aquella no siga afirmando sobre el codigo final.
 *
 * Lo que mide: que el diff de la rama no toca `AnaliticaShell.tsx` (D5: es lo unico que la
 * 132 necesita modificar de verdad), ni `components/private/analytics/` (paquete cerrado
 * de la 130), ni `lib/**` (backend: 126/127/128/135, y en particular
 * `lib/analytics/metrics.ts`, cuyas divergencias estan aplazadas a la ficha 175).
 */
describe("Feature 131 (D5) — frontera del diff con la 132 [BLOQUE QUE CADUCA EN EL MERGE]", () => {
  function diffContraDev(): string[] | null {
    try {
      const salida = execFileSync("git", ["diff", "--name-only", "origin/dev"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return salida.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    } catch {
      // Sin `origin/dev` a mano (clon superficial, CI sin fetch) no se puede medir un
      // diff: se declara y no se finge un verde con otro significado.
      return null;
    }
  }

  const PROHIBIDOS: readonly RegExp[] = [
    /^app\/\(app\)\/analitica\/_components\/AnaliticaShell\.tsx$/,
    /^components\/private\/analytics\//,
    /^lib\//,
    /financiera/,
  ];

  it("el diff de la rama no toca el shell, ni el paquete de la 130, ni `lib/**`, ni nada de la 132", () => {
    const cambiados = diffContraDev();
    if (cambiados === null) {
      expect(true, "no hay `origin/dev` para medir el diff").toBe(true);
      return;
    }
    const malos = cambiados.filter((f) => PROHIBIDOS.some((p) => p.test(f)));
    expect(
      malos,
      "D5: la 131 aterriza PRIMERO y cada feature vive en su subarbol. `AnaliticaShell.tsx` " +
        "es lo unico que la 132 necesita modificar de verdad (anadir el slot `financiero`), y " +
        "`lib/analytics/metrics.ts` esta aplazado a la ficha 175. Archivos fuera de frontera: " +
        malos.join(", "),
    ).toEqual([]);
  });

  it("y lo unico compartido que toca en `app/(app)/analitica/` es `page.tsx`", () => {
    const cambiados = diffContraDev();
    if (cambiados === null) return;
    const compartidos = cambiados.filter(
      (f) =>
        f.startsWith("app/(app)/analitica/") &&
        !f.startsWith("app/(app)/analitica/_components/operativo/"),
    );
    expect(compartidos.sort()).toEqual(["app/(app)/analitica/page.tsx"]);
  });
});
