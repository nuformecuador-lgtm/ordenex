import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 134 (T1.1–T1.5) — el guardia de frontera del EXPORT de analitica operativa.
//
// ============================== PERMANENTE ==================================
// ESTE GUARDIA NO CADUCA, Y NO LLEVA CABECERA DE CADUCIDAD. Los cuatro bloques
// CENSAN EL ARBOL, no el diff contra ninguna rama: ninguno afirma nada sobre «lo que
// esta rama cambio», que es justo la clase de afirmacion que se vuelve falsa —o peor,
// verde por vacio— en cuanto la rama se mergea. Es la leccion de
// `frontera.guardia.test.ts` (retirado en el PR #232) y del bloque branch-scoped que la
// 131 retiro en su propio PR (`tablero-operativo-frontera.guardia.test.ts:13-25`).
//
// LOS CUATRO BLOQUES SON INDEPENDIENTES ENTRE SI: ninguno lee el resultado de otro,
// ninguno comparte estado y ninguno cuelga de una lista que otro construya. Si un dia se
// retirase uno, los otros tres seguirian diciendo exactamente lo mismo que dicen hoy.
// (Leccion de la 128, donde un guardia que debia sobrevivir colgaba de uno que caducaba y
// hubo que mudarlo de archivo.)
//
// POR QUE EXISTE, en una frase: un CSV no es una pantalla. Una pantalla se cierra; un
// archivo se guarda, se reenvia y se abre seis meses despues, cuando el filtro que lo
// genero ya no existe. Un fallo de alcance aqui no es un bug visual: es un archivo
// circulando, y no hay parche que lo retire.
//
// Bloque 1 (R1/R19) — el subarbol de export no importa servicio, repositorio, Prisma ni
//                     el catalogo de servidor: el dataset entra por la Server Action.
// Bloque 2 (R3)     — ninguna ruta de `app/api` sirve el export de analitica.
// Bloque 3 (R4)     — ningun modulo `"use server"` invoca el generador de descargas.
// Bloque 4 (R19)    — no hay generador CSV/XLSX propio dentro de `app/(app)/analitica/**`.
//
// Cada bloque trae su AUTOCOMPROBACION con fixture sintetico (patron de
// `modulo-puro.guardia.test.ts` y de los guardias de 122/126/131): unas expresiones
// regulares que no casan con nada dan el mismo verde que un arbol limpio.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const EXT = new Set([".ts", ".tsx"]);

const DIR_ANALITICA = "app/(app)/analitica";
const DIR_OPERATIVO = "app/(app)/analitica/_components/operativo";
const DIR_API = "app/api";
const DIRS_SERVIDOR = ["app", "lib", "components", "hooks", "providers", "scripts"];

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

/** Quita comentarios: una MENCION EN PROSA no es una importacion ni una llamada. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function fuenteDe(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

function codigoDe(rel: string): string {
  return soloCodigo(fuenteDe(rel));
}

function infractores(dir: string, patrones: readonly RegExp[]): string[] {
  return archivos(dir).filter((rel) => patrones.some((p) => p.test(codigoDe(rel))));
}

/* ========================================================================== */
/* BLOQUE 1 (R1/R19) — la puerta unica del dataset                            */
/* ========================================================================== */

/**
 * El export obtiene sus filas de `consultarAnaliticaOperativa` y de ninguna otra fuente.
 * Un modulo del subarbol que importase el servicio, un repositorio o Prisma armaria el
 * dataset por su cuenta: sin resolver actor, sin intersecar el filtro con el alcance, sin
 * auditar el denegado y —lo peor de todo— SIN PASAR POR LA CAPA QUE SEUDONIMIZA, que vive
 * en el servicio (`AnaliticaOperativaService`) precisamente para que ningun borde futuro
 * pueda olvidarla.
 *
 * `@prisma/client` se busca como import de VALOR: `import type` se borra al compilar.
 * `lib/analytics/metrics` es dato de SERVIDOR (23 metricas con su alcance por rol, su
 * fuente y sus nombres de tabla): arrastrarlo al cliente publicaria ese censo al navegador.
 */
const PUERTA_TRASERA: readonly RegExp[] = [
  /AnaliticaOperativa\w*Service/,
  /AnaliticaOperativa\w*Repository/,
  /AnaliticaFinanciera\w*(Service|Repository)/,
  /from\s+["']@\/lib\/services\//,
  /from\s+["']@\/lib\/repositories\//,
  /from\s+["']@\/lib\/db/,
  /from\s+["']@\/lib\/analytics\/metrics["']/,
  /import\s+(?!type\b)[^;]*from\s+["']@prisma\/client["']/,
  /getPrismaClient/,
];

describe("Feature 134 (R1/R19) — el subarbol de export no tiene puerta trasera", () => {
  it("el subarbol de export no importa servicio, repositorio, Prisma ni el catalogo de servidor", () => {
    const malos = infractores(DIR_OPERATIVO, PUERTA_TRASERA);
    expect(
      malos,
      "las filas del archivo salen de `consultarAnaliticaOperativa` y de ninguna otra " +
        "fuente. Armar el dataset desde el servicio o el repositorio salta el borde que " +
        "resuelve el actor, interseca el filtro con el alcance, audita el denegado y " +
        "aplica la politica de identidad. Archivos: " +
        malos.join(", "),
    ).toEqual([]);
  });

  it("y el censo mira archivos de verdad (si no, seria verde por vacio)", () => {
    expect(archivos(DIR_OPERATIVO).length).toBeGreaterThan(4);
  });

  it("el censo DISCRIMINA: fixture infractor positivo, prosa negativa", () => {
    const infractor = `
      import { AnaliticaOperativaService } from "@/lib/services/AnaliticaOperativaService";
      import { getPrismaClient } from "@/lib/db/prisma-client";
      export async function filas() { return new AnaliticaOperativaService(); }
    `;
    expect(PUERTA_TRASERA.some((p) => p.test(soloCodigo(infractor)))).toBe(true);

    const prosa = [
      "// el dataset NO sale de AnaliticaOperativaService ni de getPrismaClient",
      "/* nada de @/lib/repositories/ aqui: eso lo hace el borde */",
      "export const COLUMNAS = [];",
    ].join("\n");
    expect(PUERTA_TRASERA.some((p) => p.test(soloCodigo(prosa)))).toBe(false);

    // Y un `import type` de Prisma no se marca, pero uno de valor si.
    expect(
      PUERTA_TRASERA.some((p) => p.test(`import type { RolValue } from "@prisma/client";`)),
    ).toBe(false);
    expect(PUERTA_TRASERA.some((p) => p.test(`import { Prisma } from "@prisma/client";`))).toBe(
      true,
    );
  });
});

/* ========================================================================== */
/* BLOQUE 2 (R3) — ninguna ruta de `app/api` sirve el export                  */
/* ========================================================================== */

/**
 * `docs/architecture.md` reserva los route handlers para webhooks, API publica y crons;
 * las lecturas internas del mismo proyecto van por Server Action. Una ruta de export seria
 * una SEGUNDA superficie de gating, con su propio parseo y su propia forma de olvidarse de
 * auditar el denegado.
 *
 * Se mira el PATH y el CODIGO: una ruta llamada `app/api/reportes/route.ts` que consultara
 * analitica seria igual de infractora que una llamada `analitica`.
 */
const EXPORT_DE_ANALITICA: readonly RegExp[] = [
  /consultarAnaliticaOperativa/,
  /consultarAgregadoOperativo/,
  /export-operativo/,
  // Los DOS modulos del export, por su nombre de archivo y por su simbolo publico. El
  // segundo se llama asi por la convencion de la 170 (`*-descarga-columnas.ts`), no por
  // gusto: ver la cabecera de `analitica-operativa-descarga-columnas.ts`. Si un dia se
  // renombran, ESTAS DOS LINEAS SON LO QUE HAY QUE RENOMBRAR CON ELLOS — un patron que ya
  // no casa con nada da el mismo verde que un arbol limpio.
  /analitica-operativa-descarga-columnas/,
  /COLUMNAS_DESCARGA_ANALITICA_OPERATIVA/,
  /filasDeSerie/,
  /filaDescargaAnaliticaOperativa/,
  /from\s+["']@\/lib\/analytics\//,
];

describe("Feature 134 (R3) — el export no se sirve desde `app/api`", () => {
  it("ninguna ruta de app/api sirve el export de analitica", () => {
    const porRuta = archivos(DIR_API).filter((rel) => /analitica|analytics/i.test(rel));
    const porCodigo = infractores(DIR_API, EXPORT_DE_ANALITICA);
    const malos = [...new Set([...porRuta, ...porCodigo])].sort();
    expect(
      malos,
      "el archivo se arma en el NAVEGADOR con datos que llegan por Server Action. Un route " +
        "handler seria una segunda puerta a la analitica, con su propio gating y su propia " +
        "forma de olvidarse de auditar. Archivos: " +
        malos.join(", "),
    ).toEqual([]);
  });

  it("y el censo mira archivos de verdad (si no, seria verde por vacio)", () => {
    expect(archivos(DIR_API).length).toBeGreaterThan(5);
  });

  it("el censo DISCRIMINA: fixture infractor positivo, prosa negativa", () => {
    const infractor = `
      import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
      export async function GET() { return new Response(await consultarAnaliticaOperativa()); }
    `;
    expect(EXPORT_DE_ANALITICA.some((p) => p.test(soloCodigo(infractor)))).toBe(true);
    expect(/analitica|analytics/i.test("app/api/analitica/export/route.ts")).toBe(true);

    const prosa = [
      "// esta ruta NO consulta analitica: consultarAnaliticaOperativa es del borde 126",
      "export async function GET() { return new Response('ok'); }",
    ].join("\n");
    expect(EXPORT_DE_ANALITICA.some((p) => p.test(soloCodigo(prosa)))).toBe(false);
    expect(/analitica|analytics/i.test("app/api/webhooks/pagos/route.ts")).toBe(false);
  });

  it("y los patrones que nombran el export siguen casando con el export que EXISTE", () => {
    // La leccion que este bloque estuvo a punto de aprender por las malas: tras el refactor
    // que extrajo las columnas a su propio modulo, este censo seguia buscando
    // `COLUMNAS_EXPORT_OPERATIVO`, un simbolo que ya no existia en ninguna parte. Un patron
    // que no casa con nada NO PROTEGE NADA, y da exactamente el mismo verde que un arbol
    // limpio. Aqui se comprueba que cada nombre que el censo persigue sigue siendo el nombre
    // de verdad: si alguien renombra un modulo del export y no toca la lista, esto cae.
    // El corpus es el sitio donde estos nombres VIVEN: el subarbol del export y el borde de
    // la analitica. No solo los tres archivos del export, porque algunos patrones nombran a
    // proposito cosas del BORDE (`consultarAgregadoOperativo`, de la 176) que una ruta
    // infractora usaria y que nunca apareceran en el subarbol del export.
    const texto = [...archivos(DIR_OPERATIVO), ...archivos("lib/actions"), ...archivos("lib/analytics")]
      .map((rel) => `${rel}\n${fuenteDe(rel)}`)
      .join("\n");
    for (const patron of EXPORT_DE_ANALITICA) {
      expect(patron.test(texto), `el censo persigue un nombre muerto: ${patron}`).toBe(true);
    }
  });
});

/* ========================================================================== */
/* BLOQUE 3 (R4) — el archivo se arma en el NAVEGADOR                         */
/* ========================================================================== */

/**
 * El binario nace y muere en el equipo del usuario: ni se sube, ni se almacena, ni pasa
 * por el servidor. Un modulo `"use server"` que invocase `construirDescarga` moveria la
 * generacion al servidor y con ella el archivo entero a la respuesta de una Server Action,
 * que es exactamente lo contrario de la garantia de la 151.
 */
const GENERADOR_DE_ARCHIVO: readonly RegExp[] = [/construirDescarga/, /descargarBlob/];

/** `"use server"` como DIRECTIVA (primera sentencia del modulo), no como mencion. */
function esModuloUseServer(fuente: string): boolean {
  const primera = fuente
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "" && !l.startsWith("//"));
  return primera !== undefined && /^["']use server["'];?$/.test(primera);
}

describe("Feature 134 (R4) — el archivo se arma en el navegador", () => {
  it('ningun modulo "use server" invoca construirDescarga', () => {
    const malos = DIRS_SERVIDOR.flatMap((dir) => archivos(dir)).filter((rel) => {
      if (!esModuloUseServer(fuenteDe(rel))) return false;
      const codigo = codigoDe(rel);
      return GENERADOR_DE_ARCHIVO.some((p) => p.test(codigo));
    });
    expect(
      malos,
      "el archivo nace y muere en el navegador (feature 151, R32): sin subida y sin " +
        "almacenamiento. Generarlo en una Server Action lo hace viajar por el servidor. " +
        "Archivos: " + malos.join(", "),
    ).toEqual([]);
  });

  it("y el censo encuentra modulos `use server` de verdad (si no, seria verde por vacio)", () => {
    const servidores = DIRS_SERVIDOR.flatMap((dir) => archivos(dir)).filter((rel) =>
      esModuloUseServer(fuenteDe(rel)),
    );
    expect(servidores.length).toBeGreaterThan(5);
  });

  it("el censo DISCRIMINA: fixture infractor positivo, prosa y cliente negativos", () => {
    const infractor = ['"use server";', 'import { construirDescarga } from "x";'].join("\n");
    expect(esModuloUseServer(infractor)).toBe(true);
    expect(GENERADOR_DE_ARCHIVO.some((p) => p.test(soloCodigo(infractor)))).toBe(true);

    // Un modulo de CLIENTE que llama al generador es lo correcto, no un infractor.
    const cliente = ['"use client";', "const a = await construirDescarga(cfg);"].join("\n");
    expect(esModuloUseServer(cliente)).toBe(false);

    // Y una mencion en prosa dentro de un modulo de servidor no es una llamada.
    const prosa = ['"use server";', "// aqui NO se llama a construirDescarga"].join("\n");
    expect(esModuloUseServer(prosa)).toBe(true);
    expect(GENERADOR_DE_ARCHIVO.some((p) => p.test(soloCodigo(prosa)))).toBe(false);
  });
});

/* ========================================================================== */
/* BLOQUE 4 (R19) — cero generadores propios en la ruta de analitica          */
/* ========================================================================== */

/**
 * D5: el dialecto CSV de la app (coma, decimales con punto, UTF-8 sin BOM) NO se toca —25
 * tablas dependen de el— y tampoco se duplica. Un segundo generador dentro de la ruta de
 * analitica crearia DOS CSV distintos en la misma app; y un nombre de archivo compuesto a
 * mano se saltaria `nombreArchivoDescarga` (R20).
 *
 * Se buscan DEFINICIONES, no importaciones: reusar `buildCsvRows` es justo lo que se pide.
 */
const GENERADOR_PROPIO: readonly RegExp[] = [
  /(function|const)\s+build(Csv|Xlsx)\w*/,
  /\.(csv|xlsx)["'`]/,
  /Content-Disposition/i,
  /new\s+Blob\s*\(/,
  /charset=utf-8/i,
  /\\ufeff/i,
];

describe("Feature 134 (R19) — el export reusa el patron 151 sin reimplementarlo", () => {
  it("el export vive en su subarbol y reusa el patron 151 sin reimplementarlo", () => {
    const malos = infractores(DIR_ANALITICA, GENERADOR_PROPIO);
    expect(
      malos,
      "el generador comun (`lib/utils/csv-template.ts`, `lib/utils/descarga-dataset.ts`) y " +
        "el nombre de archivo (`nombreArchivoDescarga`) se REUSAN. Un dialecto o un nombre " +
        "propios aqui crearian dos formas distintas de descargar en la misma app. " +
        "Archivos: " + malos.join(", "),
    ).toEqual([]);
  });

  it("y no existe un modulo de export de analitica fuera de su subarbol", () => {
    // R19: el export vive en `app/(app)/analitica/_components/operativo/`. Un
    // `lib/utils/export-analitica.ts` seria el mismo codigo en un sitio donde el censo de
    // este bloque no lo mira.
    const fuera = ["lib", "components", "hooks", "providers"]
      .flatMap((dir) => archivos(dir))
      .filter((rel) => /export-(operativo|analitica)|analitica-export/i.test(rel));
    expect(fuera).toEqual([]);
  });

  it("el censo DISCRIMINA: fixture infractor positivo, prosa e import negativos", () => {
    for (const infractor of [
      "export function buildCsvRowsAnalitica(cols, filas) { return ''; }",
      'const nombre = `analitica-${hoy}.csv`;',
      'return new Blob([texto], { type: "text/csv" });',
      'const BOM = "\\ufeff";',
    ]) {
      expect(GENERADOR_PROPIO.some((p) => p.test(soloCodigo(infractor))), infractor).toBe(true);
    }

    const legitimo = [
      "// el CSV lo genera buildCsvRows; aqui solo se proyectan filas",
      'import { construirDescarga } from "@/lib/utils/descarga-dataset";',
      'export const FORMATOS = ["csv", "xlsx"];',
    ].join("\n");
    expect(GENERADOR_PROPIO.some((p) => p.test(soloCodigo(legitimo)))).toBe(false);
  });

  it("y el censo mira archivos de verdad (si no, seria verde por vacio)", () => {
    expect(archivos(DIR_ANALITICA).length).toBeGreaterThan(5);
  });
});
