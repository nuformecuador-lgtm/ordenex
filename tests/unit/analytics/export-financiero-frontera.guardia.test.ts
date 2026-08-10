import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Import de VALOR, no de tipo: los censos (6) y (7) necesitan los nombres EN RUNTIME, y
// escribirlos aqui cometeria el mismo pecado que persiguen.
import { RolValue } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { RANGO_PRESETS } from "@/lib/analytics/types";
import { IDS_FINANCIERAS_SERVIDAS } from "@/lib/types/analitica-financiera";

// Feature 184 — analitica financiera: export de la serie (T6.1, design §6). GUARDIA DE FRONTERA.
// Cubre R1, R2, R3, R4, R5, R14, R18, R23, R26 y R27.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con NOMBRE, no solo con numero.
//
// POR QUE ESTE GUARDIA NO CADUCA. Censa el ARBOL, no el diff. No lleva cabecera de caducidad
// porque no afirma nada sobre «lo que esta rama cambio» —que es justo lo que se vuelve verde
// vacio en cuanto la rama se mergea, la leccion de `frontera.guardia.test.ts` (retirado en el
// PR #232) y del bloque branch-scoped que la 131 retiro en el suyo—. El subarbol se RECORRE: un
// archivo nuevo entra en el censo solo, sin que nadie lo apunte en ninguna lista.
//
// Y CADA BLOQUE TRAE SU AUTOCOMPROBACION (design §1.2, criterio de «NO hecho» de T6.1): un
// fragmento infractor escrito a mano debe dar POSITIVO y una mencion en prosa debe dar NEGATIVO.
// Sin eso, un censo roto —una ruta mal calculada, un regex que dejo de casar— seguiria en verde
// por vacio para siempre, que es la forma mas cara de tener un guardia.
//
// Los nueve bloques de design §6:
//   (1) el subarbol no importa servicio, repositorio, Prisma, next/headers ni el resolutor de
//       actor, y de `lib/actions` solo el BORDE                                            (R1)
//   (2) ninguna ruta de `app/api` sirve el export de analitica financiera                  (R3)
//   (3) ningun modulo `"use server"` invoca `construirDescarga`                            (R4)
//   (4) produccion invoca el borde con DOS argumentos                                      (R5)
//   (5) el subarbol no escribe ningun preset de rango ni ninguna fecha                     (R2)
//   (6) el subarbol no decide por el id de ninguna metrica financiera                      (R14)
//   (7) el subarbol no escribe listas de roles ni condiciones de permiso                   (R27)
//   (8) ni generador de archivo propio en la analitica, ni dinero convertido a `number`,
//       y el export vive en SU subarbol                                              (R18, R23)
//   (9) el modulo de columnas sigue la convencion que la guardia de la 170 descubre        (R26)

const RAIZ = process.cwd();
const DIR_ANALITICA = path.join(RAIZ, "app", "(app)", "analitica");
const DIR_EXPORT = path.join(DIR_ANALITICA, "_components", "export-financiero");
const DIR_API = path.join(RAIZ, "app", "api");

/** El borde de la 127: el UNICO modulo de `lib/actions` que el subarbol puede importar. */
const BORDE = "@/lib/actions/analitica-financiera";

/** El nombre del borde, tal como se importa. Los alias de test se DERIVAN de el. */
const NOMBRE_DEL_BORDE = "consultarMetricaFinanciera";

/** La guardia perenne de la 170, que descubre los modulos de columnas por convencion. */
const GUARDIA_170 = path.join(RAIZ, "tests", "unit", "descarga", "columnas-sensibles.guardia.test.ts");

/**
 * Este mismo archivo queda FUERA de todo censo: un guardia contiene por fuerza los patrones que
 * persigue, porque su trabajo es buscarlos. Hoy la exclusion es redundante (el guardia vive en
 * `tests/` y los censos miran `app/`, `lib/`, `components/` y `scripts/`), y se deja escrita para
 * que siga siendo cierta si alguien mueve algo.
 */
const ESTE_GUARDIA = "tests/unit/analytics/export-financiero-frontera.guardia.test.ts";

/* -------------------------------------------------------------------------- */
/* Utilidades de censo                                                         */
/* -------------------------------------------------------------------------- */

const DIRS_IGNORADOS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);

function recorrer(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entrada) => {
    if (DIRS_IGNORADOS.has(entrada)) return [];
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) return recorrer(completo);
    return [".ts", ".tsx"].includes(path.extname(completo)) ? [completo] : [];
  });
}

function relativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/**
 * Quita comentarios de bloque y de linea antes de censar. Misma decision (y mismas dos
 * sustituciones) que `modulo-puro.guardia.test.ts` y que `tablero-financiero.guardia.test.ts`:
 * la documentacion de estos archivos esta OBLIGADA a nombrar lo que no debe usarse —las cabeceras
 * del subarbol declaran por escrito que no importan el servicio, que no convierten el dinero a
 * `number` y que no escriben presets— y censar el texto crudo convertiria el contrato escrito en
 * una violacion. Nombrar la trampa es obligatorio; usarla es lo prohibido.
 *
 * Los STRINGS NO se ignoran: un preset, un id de metrica o un rol escritos a mano viven
 * precisamente dentro de comillas.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

interface ArchivoCensado {
  readonly ruta: string;
  readonly codigo: string;
}

function censar(archivos: readonly string[]): ArchivoCensado[] {
  return archivos
    .filter((archivo) => relativa(archivo) !== ESTE_GUARDIA)
    .map((archivo) => ({ ruta: relativa(archivo), codigo: soloCodigo(readFileSync(archivo, "utf8")) }));
}

/** El subarbol del export, RECORRIDO: un archivo nuevo entra en el censo solo. */
const EXPORT: readonly ArchivoCensado[] = censar(recorrer(DIR_EXPORT));

/** La region de analitica entera (bloque 8b). */
const ANALITICA: readonly ArchivoCensado[] = censar(recorrer(DIR_ANALITICA));

/** Las cuatro carpetas de produccion del repo (bloques 3 y 8c). */
const PRODUCCION: readonly ArchivoCensado[] = censar(
  ["app", "lib", "components", "scripts"].flatMap((carpeta) => recorrer(path.join(RAIZ, carpeta))),
);

/* -------------------------------------------------------------------------- */
/* Lector de referencias a modulos                                             */
/* -------------------------------------------------------------------------- */

interface ReferenciaModulo {
  readonly especificador: string;
  /** `true` si es `import type` / `export type`, que desaparece en compilacion. */
  readonly soloTipo: boolean;
}

/**
 * Extrae toda referencia a otro modulo: imports estaticos (incluido el de solo efecto),
 * re-exports, `import()` dinamico y `require()`. Se juzga la RUTA, no la linea, para que un
 * `// no importes @/lib/db` sea inocuo y un rodeo relativo (`../../lib/db/prisma-client`) caiga
 * igual que el alias.
 */
function referenciasDeModulo(codigo: string): ReferenciaModulo[] {
  const referencias: ReferenciaModulo[] = [];

  const estatico = /\b(?:import|export)\s+(type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of codigo.matchAll(estatico)) {
    referencias.push({ especificador: m[2]!, soloTipo: m[1] !== undefined });
  }

  const dinamico = /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of codigo.matchAll(dinamico)) {
    referencias.push({ especificador: m[1]!, soloTipo: false });
  }

  return referencias;
}

function segmentos(especificador: string): string[] {
  return especificador.split("/").filter((s) => s !== "" && s !== "." && s !== ".." && s !== "@");
}

/* -------------------------------------------------------------------------- */
/* (1) R1 — la puerta es una: el subarbol no tiene camino propio a los datos    */
/* -------------------------------------------------------------------------- */

// POR QUE ESTAS DOS CONSTANTES NO SE LLAMAN COMO LAS DEL GUARDIA DE PUREZA DE `lib/analytics`, y
// no es capricho: R35 de la 122 exige que haya UN SOLO guardia de pureza, y `modulo-puro.guardia`
// lo hace cumplir censando ESTA MISMA CARPETA en busca de los identificadores con que el suyo esta
// escrito. Reusar aquellos nombres aqui pondria rojo un guardia vivo — con razon, porque el repo no
// puede distinguir a simple vista dos censos de imports. Este archivo NO es un segundo guardia de
// pureza: juzga la frontera del SUBARBOL DE EXPORT (que si puede importar el borde de la 127, cosa
// que ningun modulo de `lib/analytics` puede hacer), y por eso su vocabulario es propio.

/** Capas que el subarbol no puede tocar: tendrian su propio control de permisos. */
const CAPAS_SIN_PASO_DESDE_EL_EXPORT = ["db", "repositories", "services"] as const;

/** Modulos de runtime que leen la peticion: son otra autoridad sobre «quien eres». */
const MODULOS_QUE_LEEN_LA_PETICION = ["next/headers", "next/cache", "server-only"];

/**
 * Imports prohibidos EN EL SUBARBOL DE EXPORT (R1, R5).
 *
 * `lib/actions` NO esta prohibido entero, y esa es la precision que hace util al censo: el
 * subarbol TIENE que importar el borde de la 127 —es la puerta unica— y no puede importar
 * ninguna otra accion. Prohibirlo entero dejaria la feature sin su unica fuente legitima;
 * permitirlo entero dejaria entrar cualquier segunda puerta.
 */
function violacionesDeImport(codigo: string): string[] {
  const motivos: string[] = [];

  for (const { especificador, soloTipo } of referenciasDeModulo(codigo)) {
    const partes = segmentos(especificador);

    const capa = CAPAS_SIN_PASO_DESDE_EL_EXPORT.find((c) => partes.includes(c));
    if (capa) motivos.push(`importa la capa "${capa}" via "${especificador}"`);

    if (MODULOS_QUE_LEEN_LA_PETICION.includes(especificador)) {
      motivos.push(`importa "${especificador}", que solo existe en el servidor`);
    }

    // Ni siquiera como tipo: el subarbol es codigo de CLIENTE y no tiene nada que hacer con el
    // cliente generado, que ademas exige `DATABASE_URL` y un `prisma generate` previo.
    if (partes[0] === "@prisma" || especificador.startsWith("@prisma/")) {
      motivos.push(`importa "${especificador}"${soloTipo ? " (aunque sea como tipo)" : ""}`);
    }

    // El resolutor de actor y el criterio de acceso: quien eres lo resuelve el BORDE, siempre.
    if (partes.includes("auth") || /resolve-actor|resolveActorFromSession|acceso-total/.test(especificador)) {
      motivos.push(`importa el resolutor de actor via "${especificador}"`);
    }

    if (partes.includes("actions") && especificador !== BORDE) {
      motivos.push(`importa una accion que NO es el borde: "${especificador}"`);
    }
  }

  return motivos;
}

describe("R1/184 · el subarbol de export no tiene un camino propio a los datos", () => {
  it("el subarbol de export no importa servicio, repositorio, Prisma, next/headers ni el resolutor de actor", () => {
    const infractores = EXPORT.flatMap(({ ruta, codigo }) =>
      violacionesDeImport(codigo).map((motivo) => `${ruta}: ${motivo}`),
    );
    expect(
      infractores,
      "un camino propio a los datos traeria su propio control de permisos, su propio parseo y su propia forma de olvidarse de registrar el denegado",
    ).toEqual([]);
  });

  it("y SI importa el borde: el censo de acciones no esta pasando por vacio", () => {
    // Contrapeso. Si el subarbol dejara de importar el borde, la regla «solo el borde» seria
    // cierta por vacio y R1 se estaria comprobando sobre nada.
    const conElBorde = EXPORT.filter(({ codigo }) =>
      referenciasDeModulo(codigo).some((r) => r.especificador === BORDE),
    );
    expect(conElBorde.map(({ ruta }) => ruta).length).toBeGreaterThan(0);
  });

  it("autocomprobacion (1): detecta el camino propio y no marca los imports legitimos", () => {
    const prohibidos = [
      'import { AnaliticaFinancieraService } from "@/lib/services/AnaliticaFinancieraService";',
      'import { getPrismaClient } from "@/lib/db/prisma-client";',
      'import { OrdenRepository } from "@/lib/repositories/OrdenRepository";',
      'import { cookies } from "next/headers";',
      'import { resolveActorFromSession } from "@/lib/auth/resolve-actor";',
      'import { esAccesoTotal } from "@/lib/auth/acceso-total";',
      'import type { Prisma } from "@prisma/client";',
      'const { getPrismaClient } = require("../../../../lib/db/prisma-client");',
      'const m = await import("@/lib/services/AnaliticaFinancieraService");',
      // Otra accion cualquiera: seria una SEGUNDA puerta, con su propio gating.
      'import { listarOrdenes } from "@/lib/actions/ordenes";',
    ];
    for (const caso of prohibidos) {
      expect(violacionesDeImport(caso), caso).not.toEqual([]);
    }

    const legitimos = [
      `import { ${NOMBRE_DEL_BORDE} } from "${BORDE}";`,
      'import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";',
      'import { filasLocales } from "@/components/shared/descarga-resultado";',
      'import type { DescargaColumna, DescargaTipo } from "@/lib/types/descarga";',
      'import { esVistaTemporal } from "../financiero/adaptar";',
      'import { FILTRO_FINANCIERO_POR_DEFECTO } from "../financiero/rango";',
      'import { useRef } from "react";',
      // La mencion en prosa es OBLIGATORIA en las cabeceras y no es una violacion.
      '// este modulo NO importa @/lib/services/AnaliticaFinancieraService ni next/headers',
      '/* prohibido importar "@prisma/client" aqui */',
    ];
    for (const caso of legitimos) {
      expect(violacionesDeImport(soloCodigo(caso)), caso).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (2) R3 — cero rutas de app/api para el export de analitica                   */
/* -------------------------------------------------------------------------- */

/**
 * Una ruta de `app/api` que sirve el export de analitica, por su RUTA.
 *
 * `docs/architecture.md` reserva los route handlers para webhooks, API publica y crons; el patron
 * 151 no usa ninguno en sus ~25 tablas. Una ruta aqui seria una SEGUNDA superficie de gating, con
 * su propio parseo y su propia forma de olvidarse de auditar el denegado — el pecado exacto contra
 * el que advierte §7 de la 122.
 */
function rutaSirveElExport(rutaRelativa: string): boolean {
  const partes = rutaRelativa.split("/");
  if (!partes.includes("api")) return false;
  const nombra = (palabra: string) => partes.some((p) => p.toLowerCase().includes(palabra));
  return nombra("analitica") && ["export", "descarga", "financier", "csv", "xlsx"].some(nombra);
}

/** Y por su CODIGO: una ruta con nombre inocente que arma el archivo igual. */
function codigoSirveElExport(codigo: string): string[] {
  const motivos: string[] = [];
  const referencias = referenciasDeModulo(codigo).map((r) => r.especificador);

  if (referencias.some((e) => /export-financiero|-descarga-columnas/.test(e))) {
    motivos.push("importa el subarbol de export de la analitica financiera");
  }
  if (referencias.includes(BORDE) && /\bconstruirDescarga\s*\(/.test(codigo)) {
    motivos.push("consulta la analitica financiera y arma el archivo");
  }
  return motivos;
}

describe("R3/184 · ninguna ruta de app/api sirve el export de analitica financiera", () => {
  it("ninguna ruta de app/api sirve el export de analitica financiera", () => {
    const rutas = censar(recorrer(DIR_API));
    const infractores = rutas.flatMap(({ ruta, codigo }) => [
      ...(rutaSirveElExport(ruta) ? [`${ruta}: su ruta declara un export de analitica`] : []),
      ...codigoSirveElExport(codigo).map((motivo) => `${ruta}: ${motivo}`),
    ]);
    expect(
      infractores,
      "un route handler seria una segunda superficie de gating: el archivo se arma en el navegador (R4)",
    ).toEqual([]);
  });

  it("y app/api existe y tiene rutas: el censo no esta mirando un directorio vacio", () => {
    const rutas = censar(recorrer(DIR_API));
    expect(rutas.length, "el censo de R3 no encuentra ninguna ruta: mira donde no es").toBeGreaterThan(0);
  });

  it("autocomprobacion (2): detecta la ruta y el handler, y no la mencion en prosa", () => {
    expect(rutaSirveElExport("app/api/analitica/financiera/export/route.ts")).toBe(true);
    expect(rutaSirveElExport("app/api/analitica/descarga/route.ts")).toBe(true);
    expect(rutaSirveElExport("app/api/analitica-financiera-csv/route.ts")).toBe(true);
    // Rutas legitimas del arbol: ni son de analitica, ni son de export.
    expect(rutaSirveElExport("app/api/webhooks/whatsapp/route.ts")).toBe(false);
    // Un cron de analitica que NO sirve ningun archivo es legitimo: hacen falta las dos palabras.
    expect(rutaSirveElExport("app/api/cron/backfill-analitica/route.ts")).toBe(false);
    expect(rutaSirveElExport("app/(app)/analitica/_components/export-financiero/export-financiero.ts")).toBe(
      false,
    );

    expect(
      codigoSirveElExport('import { filasDeVistaFinanciera } from "@/app/(app)/analitica/_components/export-financiero/export-financiero";'),
    ).not.toEqual([]);
    expect(
      codigoSirveElExport(
        `import { ${NOMBRE_DEL_BORDE} } from "${BORDE}";\nconst archivo = await construirDescarga(config);`,
      ),
    ).not.toEqual([]);
    // Prosa: nombrar la trampa es obligatorio.
    expect(codigoSirveElExport(soloCodigo("// no existe app/api/analitica/financiera/export/route.ts"))).toEqual(
      [],
    );
    expect(codigoSirveElExport(soloCodigo("// aqui NO se llama a construirDescarga(config)"))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* (3) R4 — el archivo se arma en el NAVEGADOR                                  */
/* -------------------------------------------------------------------------- */

function declaraUseServer(codigo: string): boolean {
  return /(^|\s)["']use server["']\s*;?/.test(codigo);
}

function invocaElGenerador(codigo: string): boolean {
  return (
    /\bconstruirDescarga\s*\(/.test(codigo) ||
    referenciasDeModulo(codigo).some((r) => /descarga-dataset/.test(r.especificador))
  );
}

describe("R4/184 · el archivo se arma en el navegador", () => {
  it('ningun modulo "use server" invoca construirDescarga', () => {
    const infractores = PRODUCCION.filter(
      ({ codigo }) => declaraUseServer(codigo) && invocaElGenerador(codigo),
    ).map(({ ruta }) => ruta);
    expect(
      infractores,
      "armar el archivo en el servidor lo devolveria por la respuesta de una Server Action: otra superficie, otro gating",
    ).toEqual([]);
  });

  it("y el censo ve modulos use server Y modulos que arman archivos: no pasa por vacio", () => {
    // Sin este contrapeso, el caso anterior seguiria verde si el censo dejara de leer archivos o
    // si los dos detectores dejaran de casar.
    expect(PRODUCCION.filter(({ codigo }) => declaraUseServer(codigo)).length).toBeGreaterThan(0);
    expect(PRODUCCION.filter(({ codigo }) => invocaElGenerador(codigo)).length).toBeGreaterThan(0);
  });

  it("autocomprobacion (3): detecta la directiva y la invocacion, y no sus menciones en prosa", () => {
    expect(declaraUseServer('"use server";\nexport async function x() {}')).toBe(true);
    expect(declaraUseServer("'use server'\n")).toBe(true);
    expect(declaraUseServer(soloCodigo('// este archivo no lleva "use server"'))).toBe(false);
    expect(declaraUseServer(soloCodigo('/* prohibido declarar "use server" aqui */'))).toBe(false);

    expect(invocaElGenerador("const archivo = await construirDescarga(config);")).toBe(true);
    expect(invocaElGenerador('import { construirDescarga } from "@/lib/utils/descarga-dataset";')).toBe(true);
    expect(invocaElGenerador(soloCodigo("// el generador comun es construirDescarga(config)"))).toBe(false);

    // Y la combinacion, que es lo que el bloque prohibe.
    const infractor = '"use server";\nimport { construirDescarga } from "@/lib/utils/descarga-dataset";';
    expect(declaraUseServer(infractor) && invocaElGenerador(infractor)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* (4) R5 — produccion invoca el borde con DOS argumentos                       */
/* -------------------------------------------------------------------------- */

/**
 * Cuenta los argumentos de cada llamada a `nombre` en el codigo dado.
 *
 * Se escanea con profundidad de parentesis y estado de comillas en vez de con un regex: un
 * `consultar(id, { rango: preset(x) })` tiene comas que NO son separadores de argumento, y un
 * regex las contaria igual. Contar de menos aqui seria peor que no contar: el guardia diria que
 * produccion pasa dos argumentos justo cuando pasa tres.
 */
function argumentosDeLlamada(codigo: string, nombre: string): number[] {
  const conteos: number[] = [];
  const patron = new RegExp(`\\b${nombre}\\s*\\(`, "g");

  for (const m of codigo.matchAll(patron)) {
    let profundidad = 1;
    let comillas: string | null = null;
    let comas = 0;
    let vacio = true;

    for (let i = (m.index ?? 0) + m[0].length; i < codigo.length && profundidad > 0; i++) {
      const c = codigo[i]!;
      if (comillas !== null) {
        if (c === "\\") i++;
        else if (c === comillas) comillas = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        comillas = c;
        vacio = false;
        continue;
      }
      if (c === "(" || c === "[" || c === "{") {
        profundidad++;
        vacio = false;
        continue;
      }
      if (c === ")" || c === "]" || c === "}") {
        profundidad--;
        if (profundidad === 0) break;
        vacio = false;
        continue;
      }
      if (c === "," && profundidad === 1) {
        comas++;
        continue;
      }
      if (!/\s/.test(c)) vacio = false;
    }

    conteos.push(vacio && comas === 0 ? 0 : comas + 1);
  }

  return conteos;
}

/**
 * Los nombres bajo los que el borde se invoca en un archivo: el suyo y cualquier ALIAS que reciba
 * al declararse (`consultar: ConsultarFinanciera = consultarMetricaFinanciera`).
 *
 * Sin los alias, este censo estaria mirando un identificador que en el codigo de produccion no
 * aparece en ninguna llamada, y pasaria por vacio: el control llama al borde a traves del
 * parametro que lo tiene por defecto, que es el punto de inyeccion PARA TESTS.
 */
function nombresDelBorde(codigo: string): string[] {
  const nombres = new Set<string>([NOMBRE_DEL_BORDE]);
  const patron = new RegExp(
    `\\b([A-Za-z_$][\\w$]*)\\s*(?::\\s*[^=;,()]+)?=\\s*${NOMBRE_DEL_BORDE}\\b`,
    "g",
  );
  for (const m of codigo.matchAll(patron)) nombres.add(m[1]!);
  return [...nombres];
}

/** Todas las llamadas al borde (por cualquiera de sus nombres) de un archivo. */
function llamadasAlBorde(codigo: string): number[] {
  return nombresDelBorde(codigo).flatMap((nombre) => argumentosDeLlamada(codigo, nombre));
}

describe("R5/184 · produccion invoca el borde con dos argumentos", () => {
  it("produccion invoca el borde con dos argumentos: la inyeccion es solo de tests", () => {
    const infractores = EXPORT.flatMap(({ ruta, codigo }) =>
      llamadasAlBorde(codigo)
        .filter((argumentos) => argumentos > 2)
        .map((argumentos) => `${ruta}: llama al borde con ${argumentos} argumentos`),
    );
    expect(
      infractores,
      "el tercer argumento (deps) contiene getActor: usarlo desde produccion crearia una SEGUNDA autoridad sobre «quien eres»",
    ).toEqual([]);
  });

  it("y hay al menos una llamada al borde con exactamente dos: el censo no cuenta un conjunto vacio", () => {
    const conteos = EXPORT.flatMap(({ codigo }) => llamadasAlBorde(codigo));
    expect(conteos, "nadie llama al borde en el subarbol: R5 se estaria midiendo sobre nada").toContain(2);
  });

  it("autocomprobacion (4): cuenta bien los argumentos, incluidas las comas que no separan", () => {
    expect(argumentosDeLlamada("f()", "f")).toEqual([0]);
    expect(argumentosDeLlamada("f(a)", "f")).toEqual([1]);
    expect(argumentosDeLlamada("f(a, b)", "f")).toEqual([2]);
    expect(argumentosDeLlamada("f(a, b, c)", "f")).toEqual([3]);
    // Las comas de dentro de un objeto, de un array o de un string NO son separadores.
    expect(argumentosDeLlamada('f(id, { rango: "mes", tope: 3 })', "f")).toEqual([2]);
    expect(argumentosDeLlamada('f(id, ["a, b", "c"])', "f")).toEqual([2]);
    expect(argumentosDeLlamada("f(id, filtro, { getActor, logger })", "f")).toEqual([3]);
    // El nombre se casa entero: `fx(...)` no es `f(...)`.
    expect(argumentosDeLlamada("fx(a, b, c)", "f")).toEqual([]);
  });

  it("autocomprobacion (4): descubre el alias del borde y ve su tercer argumento", () => {
    const conAlias = [
      `import { ${NOMBRE_DEL_BORDE} } from "${BORDE}";`,
      `async function preparar(consultar: ConsultarFinanciera = ${NOMBRE_DEL_BORDE}) {`,
      "  return consultar(metricaId, FILTRO_FINANCIERO_POR_DEFECTO, { getActor });",
      "}",
    ].join("\n");
    expect(nombresDelBorde(conAlias)).toContain("consultar");
    expect(llamadasAlBorde(conAlias)).toContain(3);

    const limpio = conAlias.replace(", { getActor }", "");
    expect(llamadasAlBorde(limpio)).toEqual([2]);

    // Y la llamada directa con tres, sin alias de por medio.
    expect(llamadasAlBorde(`${NOMBRE_DEL_BORDE}(id, filtro, deps);`)).toEqual([3]);
    // La mencion en prosa no es una llamada.
    expect(llamadasAlBorde(soloCodigo(`// nunca ${NOMBRE_DEL_BORDE}(id, filtro, deps)`))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* (5) R2 — el filtro se IMPORTA: ni presets ni fechas escritos aqui            */
/* -------------------------------------------------------------------------- */

/**
 * Un preset de rango o una fecha escritos en el subarbol.
 *
 * Los presets NO se escriben aqui: salen de `RANGO_PRESETS` (`lib/analytics/types.ts`), el mismo
 * dominio cerrado que valida el esquema `.strict()` de la 135. Un preset nuevo entra en el censo
 * solo.
 *
 * SE EXIGE EL LITERAL COMPLETO ENTRE COMILLAS, igual que hace el censo (f) del guardia del
 * tablero: un texto de UI que contenga la palabra no es el valor del dominio.
 */
const PATRONES_DE_FECHA: readonly { readonly patron: RegExp; readonly motivo: string }[] = [
  { patron: /\bnew\s+Date\s*\(/, motivo: "construye un Date" },
  { patron: /\bDate\s*\.\s*now\s*\(/, motivo: "lee el reloj" },
  { patron: /["'`]\d{4}-\d{2}-\d{2}/, motivo: "escribe una fecha literal" },
  { patron: /\b(?:desdeFecha|hastaFecha)\s*:/, motivo: "compone un rango a mano" },
  { patron: /\btoISOString\s*\(/, motivo: "formatea una fecha" },
];

function escribeRangoOFecha(codigo: string): string[] {
  const motivos: string[] = [];

  for (const preset of RANGO_PRESETS) {
    if (new RegExp(`["'\`]${preset}["'\`]`).test(codigo)) {
      motivos.push(`escribe el preset de rango "${preset}"`);
    }
  }
  for (const { patron, motivo } of PATRONES_DE_FECHA) {
    if (patron.test(codigo)) motivos.push(motivo);
  }

  return motivos;
}

describe("R2/184 · el subarbol de export no escribe ningun preset de rango ni ninguna fecha", () => {
  it("el subarbol de export no escribe ningun preset de rango ni ninguna fecha", () => {
    const infractores = EXPORT.flatMap(({ ruta, codigo }) =>
      escribeRangoOFecha(codigo).map((motivo) => `${ruta}: ${motivo}`),
    );
    expect(
      infractores,
      "el filtro se IMPORTA de ../financiero/rango: un literal equivalente pasa hoy y diverge el dia que la region gane una barra de filtros",
    ).toEqual([]);
  });

  it("y el subarbol SI importa el filtro de la pantalla: R2 no se cumple por ausencia", () => {
    const conElFiltro = EXPORT.filter(({ codigo }) => /FILTRO_FINANCIERO_POR_DEFECTO/.test(codigo));
    expect(
      conElFiltro.map(({ ruta }) => ruta).length,
      "nadie importa el filtro de la pantalla: no escribir presets seria cierto por no consultar nada",
    ).toBeGreaterThan(0);
  });

  it("autocomprobacion (5): detecta preset y fecha, y no el campo ni la prosa", () => {
    const [primero] = RANGO_PRESETS;
    const prohibidos = [
      `const filtro = { rango: "${primero}" };`,
      `if (preset === '${primero}') return null;`,
      'const desde = new Date("2026-08-03");',
      "const hoy = Date.now();",
      'const rango = { desdeFecha: "2026-07-05", hastaFecha: "2026-08-03" };',
      "const iso = fecha.toISOString();",
    ];
    for (const caso of prohibidos) {
      expect(escribeRangoOFecha(caso), caso).not.toEqual([]);
    }

    const legitimos = [
      "const filtro = FILTRO_FINANCIERO_POR_DEFECTO;",
      "readonly rango: RangoFinanciero;",
      "const periodo = fila.cubo;",
      soloCodigo(`// NO se escribe { rango: "${primero}" } ni ninguna fecha 2026-08-03 aqui`),
      soloCodigo(`/* el preset "${primero}" vive en rango.ts */`),
    ];
    for (const caso of legitimos) {
      expect(escribeRangoOFecha(caso), caso).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (6) R14 — la forma la decide el DTO, nunca el nombre de la metrica           */
/* -------------------------------------------------------------------------- */

/**
 * Una DECISION tomada por el id de una metrica financiera. Mismo mecanismo y MISMOS IDS
 * IMPORTADOS que el censo (f) de `tests/unit/guards/tablero-financiero.guardia.test.ts`: se exige
 * el literal COMPLETO entre comillas (asi el id de VISTA `cod_recaudado__por_metodo`, que empieza
 * por el id de la metrica, no se marca) y se cubren las cuatro formas en que un id decide algo.
 *
 * Es R22 de la 183 trasladado al archivo: `if (metricaId === "ingreso_flete")` volveria a poner la
 * forma del importe en manos del nombre, justo despues de que la 183 la pusiera en el DTO.
 */
function decisionesPorIdDeMetrica(codigo: string): string[] {
  return IDS_FINANCIERAS_SERVIDAS.flatMap((id) => {
    const literal = `["'\`]${id}["'\`]`;
    const formas: readonly RegExp[] = [
      new RegExp(`[=!]==?\\s*${literal}`, "g"),
      new RegExp(`${literal}\\s*[=!]==?`, "g"),
      new RegExp(`\\bcase\\s+${literal}\\s*:`, "g"),
      new RegExp(`\\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf)\\s*\\(\\s*${literal}`, "g"),
      new RegExp(`\\[[^[\\]]*${literal}[^[\\]]*\\]`, "g"),
    ];
    return formas.flatMap((forma) =>
      (codigo.match(forma) ?? []).map((coincidencia) => `${id}: ${coincidencia.trim()}`),
    );
  });
}

describe("R14/184 · el subarbol de export no decide por el id de ninguna metrica financiera", () => {
  it("el subarbol de export no decide por el id de ninguna metrica financiera", () => {
    const infractores = EXPORT.flatMap(({ ruta, codigo }) =>
      decisionesPorIdDeMetrica(codigo).map((coincidencia) => `${ruta}: ${coincidencia}`),
    );
    expect(
      infractores,
      "la forma del importe la decide la `forma` del DTO (R13), y el saldo al corte lo decide `esAcumulado`",
    ).toEqual([]);
  });

  it("el dominio de ids no esta vacio: el censo no puede pasar por ciego", () => {
    expect(IDS_FINANCIERAS_SERVIDAS.length).toBeGreaterThanOrEqual(2);
    expect(IDS_FINANCIERAS_SERVIDAS.every((id) => id.length > 0)).toBe(true);
  });

  it("autocomprobacion (6): detecta las cuatro formas y no la decision por la FORMA del DTO", () => {
    const [primero] = IDS_FINANCIERAS_SERVIDAS;
    const prohibidos = [
      `if (metricaId === "${primero}") return COLUMNAS_SOLO_BRUTO;`,
      `if (datos.metricaId !== '${primero}') return null;`,
      `switch (metricaId) { case "${primero}": return dos; }`,
      `if (CON_NETO.includes("${primero}")) return dos;`,
      `const SOLO_ESTAS = ["${primero}"];`,
    ];
    for (const caso of prohibidos) {
      expect(decisionesPorIdDeMetrica(caso), caso).not.toEqual([]);
    }

    const legitimos = [
      'if (fila.importe.forma === "bruto_y_neto") return dos;',
      "if (esVistaConNeto(vista)) return dos;",
      "if (esVistaTemporal(vista)) return vista;",
      'if (datos.tipo !== "vistas") return sinArchivo(TEXTO);',
      "const vista = datos.vistas.find((c) => c.id === vistaId);",
      soloCodigo(`// el export NO hace metricaId === "${primero}" (R14)`),
    ];
    for (const caso of legitimos) {
      expect(decisionesPorIdDeMetrica(caso), caso).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (7) R27 — el control no redefine quien ve el dinero                          */
/* -------------------------------------------------------------------------- */

/** Los nombres de rol NO se escriben aqui: salen de `RolValue`, la fuente de `esAccesoTotal`. */
const ROLES_DEL_DOMINIO: readonly string[] = Object.values(RolValue);

function listasDeRolesAMano(codigo: string): string[] {
  const arrays = codigo.match(/\[[^[\]]*\]/g) ?? [];
  return arrays.filter(
    (bloque) =>
      ROLES_DEL_DOMINIO.filter((rol) => new RegExp(`["'\`]${rol}["'\`]`).test(bloque)).length >= 2,
  );
}

/**
 * Una condicion de permiso propia: un rol suelto comparado, el criterio de acceso invocado o el
 * ambito del actor leido. El control se renderiza DONDE la region financiera se renderiza —lo
 * decide la pagina con `esAccesoTotal`— y no vuelve a preguntarselo: una segunda condicion es una
 * segunda respuesta a «quien ve el dinero», y las dos se desincronizan en silencio.
 */
const CONDICIONES_DE_PERMISO: readonly { readonly patron: RegExp; readonly motivo: string }[] = [
  { patron: /\besAccesoTotal\s*\(/, motivo: "invoca el criterio de acceso" },
  { patron: /\bactor\s*\./, motivo: "lee el actor" },
  { patron: /\brol\s*[=!]==?/, motivo: "compara un rol" },
  { patron: /\.\s*rol\b/, motivo: "lee el rol de alguien" },
  { patron: /\bROLES_[A-Z_]+/, motivo: "nombra un conjunto de roles" },
];

function condicionesDePermiso(codigo: string): string[] {
  const motivos = CONDICIONES_DE_PERMISO.filter(({ patron }) => patron.test(codigo)).map(
    ({ motivo }) => motivo,
  );
  for (const rol of ROLES_DEL_DOMINIO) {
    if (new RegExp(`["'\`]${rol}["'\`]`).test(codigo)) motivos.push(`escribe el rol "${rol}"`);
  }
  return [...motivos, ...listasDeRolesAMano(codigo).map((b) => `lista de roles: ${b.slice(0, 60)}`)];
}

describe("R27/184 · el subarbol de export no escribe ninguna lista de roles ni ninguna condicion de permiso", () => {
  it("el subarbol de export no escribe ninguna lista de roles ni ninguna condicion de permiso", () => {
    const infractores = EXPORT.flatMap(({ ruta, codigo }) =>
      condicionesDePermiso(codigo).map((motivo) => `${ruta}: ${motivo}`),
    );
    expect(
      infractores,
      "quien ve la region financiera lo decide la pagina con esAccesoTotal; una segunda condicion se desincroniza en silencio",
    ).toEqual([]);
  });

  it("el dominio de roles se deriva de RolValue y cubre mas de un rol", () => {
    expect(ROLES_DEL_DOMINIO.length).toBeGreaterThanOrEqual(2);
    expect(ROLES_DEL_DOMINIO.every((rol) => rol.length > 0)).toBe(true);
  });

  it("autocomprobacion (7): detecta rol, lista y criterio, y no marca el codigo legitimo", () => {
    const [primero, segundo] = ROLES_DEL_DOMINIO;
    const prohibidos = [
      `if (rol === "${primero}") return <Boton />;`,
      `if (!["${primero}", "${segundo}"].includes(actor.rol)) return null;`,
      "if (!esAccesoTotal(actor.rol)) return null;",
      `const permitidos = ['${primero}','${segundo}'];`,
      "const zona = actor.zonaId;",
    ];
    for (const caso of prohibidos) {
      expect(condicionesDePermiso(caso), caso).not.toEqual([]);
    }

    const legitimos = [
      "return <DescargarDatasetButton titulo={titulo} columnas={columnas.current} />;",
      "const preparado = await prepararExportFinanciero(metricaId, vistaId);",
      "if (vista === null) return sinArchivo(TEXTO_EXPORT_VISTA_NO_TEMPORAL);",
      // «control» contiene las tres letras de un rol y no es un rol: el censo casa palabras.
      "const control = columnas.current;",
      soloCodigo(`// el control NO escribe if (rol === "${primero}") (R27)`),
    ];
    for (const caso of legitimos) {
      expect(condicionesDePermiso(caso), caso).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (8) R18 y R23 — ni dialecto propio, ni dinero en number, ni export disperso  */
/* -------------------------------------------------------------------------- */

/** (8a) R18 — la conversion del dinero a `number`, en cualquiera de sus formas. */
const CONVERSIONES_DE_DINERO: readonly { readonly patron: RegExp; readonly motivo: string }[] = [
  { patron: /\baNumero\s*\(/, motivo: "usa aNumero (la frontera de PINTAR, no la de escribir)" },
  { patron: /\bNumber\s*\(/, motivo: "convierte a number" },
  { patron: /\bparse(?:Float|Int)\s*\(/, motivo: "parsea el importe" },
  { patron: /\.\s*toFixed\s*\(/, motivo: "reformatea el importe" },
  { patron: /\btoLocaleString\s*\(/, motivo: "formatea con separador de miles" },
];

function convierteDineroANumber(codigo: string): string[] {
  const motivos = CONVERSIONES_DE_DINERO.filter(({ patron }) => patron.test(codigo)).map(
    ({ motivo }) => motivo,
  );
  // Importar `../financiero/adaptar` es legitimo y obligatorio (de ahi salen `esVistaTemporal` y
  // `esVistaConNeto`, R14); lo prohibido es traerse de ese mismo modulo la frontera del dinero.
  if (/\baNumero\b/.test(codigo)) motivos.push("nombra aNumero");
  return motivos;
}

/** (8b) R23 — un generador de archivo propio dentro de la analitica. */
const GENERADOR_PROPIO: readonly { readonly patron: RegExp; readonly motivo: string }[] = [
  { patron: /\bnew\s+Blob\s*\(/, motivo: "arma el binario a mano" },
  { patron: /text\/csv/, motivo: "declara el MIME del CSV" },
  { patron: /Content-Disposition/i, motivo: "compone una cabecera de descarga" },
  // El BOM se construye, no se escribe: un BOM literal en este fuente es invisible en cualquier
  // editor y se pierde en el primer copiar-pegar.
  { patron: new RegExp(String.fromCharCode(0xfeff)), motivo: "escribe un BOM" },
  { patron: /\.join\s*\(\s*["'`];["'`]\s*\)/, motivo: "usa punto y coma como separador" },
  { patron: /\bexceljs\b/, motivo: "habla directamente con el generador de xlsx" },
  { patron: /\bbuildCsvRows\s*\(|\bbuildXlsxRows\s*\(/, motivo: "invoca el generador de bajo nivel" },
];

function generadorPropioDeArchivo(codigo: string): string[] {
  return GENERADOR_PROPIO.filter(({ patron }) => patron.test(codigo)).map(({ motivo }) => motivo);
}

/** (8c) R23 — los tres archivos de produccion declarados en design §1, y ninguno mas. */
const ARCHIVOS_DECLARADOS = [
  "app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera.tsx",
  "app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas.ts",
  "app/(app)/analitica/_components/export-financiero/export-financiero.ts",
];

/** El UNICO archivo ajeno que la feature toca (D6, con su condicion integra). */
const UNICA_INSERCION = "app/(app)/analitica/_components/financiero/TableroFinanciero.tsx";

function importaElSubarbol(codigo: string): boolean {
  return referenciasDeModulo(codigo).some((r) => /export-financiero/.test(r.especificador));
}

describe("R18/R23/184 · el export vive en su subarbol y reusa el patron 151 sin reimplementarlo", () => {
  it("el subarbol de export no importa aNumero ni convierte dinero a number", () => {
    const infractores = EXPORT.flatMap(({ ruta, codigo }) =>
      convierteDineroANumber(codigo).map((motivo) => `${ruta}: ${motivo}`),
    );
    expect(
      infractores,
      "D2: el importe viaja como CADENA de escala 2; convertirlo abriria la segunda frontera del dinero, cuyo null se leeria como «no se sabe»",
    ).toEqual([]);
  });

  it("ningun archivo de la analitica declara un generador de archivo propio", () => {
    const infractores = ANALITICA.flatMap(({ ruta, codigo }) =>
      generadorPropioDeArchivo(codigo).map((motivo) => `${ruta}: ${motivo}`),
    );
    expect(
      infractores,
      "el dialecto es el de lib/utils/csv-template y ~25 tablas dependen de el: un segundo dialecto crea dos CSV distintos en la misma app",
    ).toEqual([]);
  });

  it("el subarbol de export contiene EXACTAMENTE los tres archivos declarados en design §1", () => {
    expect(EXPORT.map(({ ruta }) => ruta).sort()).toEqual([...ARCHIVOS_DECLARADOS].sort());
  });

  it("el export no se ha dispersado: fuera de la analitica nadie importa su subarbol", () => {
    const fuera = PRODUCCION.filter(({ ruta }) => !ruta.startsWith("app/(app)/analitica/"))
      .filter(({ codigo }) => importaElSubarbol(codigo))
      .map(({ ruta }) => ruta);
    expect(fuera, "un modulo de export en lib/ o components/shared/ seria otra frontera que mantener").toEqual(
      [],
    );
  });

  it("dentro de la analitica el unico que lo monta es TableroFinanciero.tsx, con UNA insercion", () => {
    const dentro = ANALITICA.filter(({ ruta }) => !ruta.startsWith(path.posix.dirname(ARCHIVOS_DECLARADOS[0]!)))
      .filter(({ codigo }) => importaElSubarbol(codigo))
      .map(({ ruta }) => ruta);
    expect(dentro, "D6 admite UN archivo ajeno tocado, no dos").toEqual([UNICA_INSERCION]);

    const tablero = ANALITICA.find(({ ruta }) => ruta === UNICA_INSERCION);
    expect(tablero, "el tablero no esta en el censo").toBeDefined();
    const montajes = (tablero?.codigo.match(/<ExportarVistaFinanciera\b/g) ?? []).length;
    expect(montajes, "una sola insercion de JSX (D6)").toBe(1);
  });

  it("autocomprobacion (8): detecta la conversion, el dialecto propio y la dispersion", () => {
    const conversiones = [
      "const bruto = aNumero(fila.importe.bruto);",
      "const bruto = Number(fila.importe.bruto);",
      "const bruto = parseFloat(fila.importe.bruto);",
      "const bruto = valor.toFixed(2);",
      "const bruto = valor.toLocaleString();",
    ];
    for (const caso of conversiones) {
      expect(convierteDineroANumber(caso), caso).not.toEqual([]);
    }
    const literales = [
      "periodo: fila.cubo,",
      "bruto: fila.importe.bruto,",
      soloCodigo("// NO se usa aNumero(...) ni Number(...) aqui (R18/D2)"),
    ];
    for (const caso of literales) {
      expect(convierteDineroANumber(caso), caso).toEqual([]);
    }

    const generadores = [
      'const blob = new Blob([texto], { type: "text/csv" });',
      'headers.set("Content-Disposition", "attachment");',
      'const linea = celdas.join(";");',
      "const libro = await buildXlsxRows(columnas, filas, hoja);",
    ];
    for (const caso of generadores) {
      expect(generadorPropioDeArchivo(caso), caso).not.toEqual([]);
    }
    const reusos = [
      'export const FORMATOS_EXPORT_FINANCIERO: DescargaTipo[] = ["csv", "xlsx"];',
      "<DescargarDatasetButton formatos={FORMATOS_EXPORT_FINANCIERO} />",
      soloCodigo("// buildCsvRows emite coma, decimales con punto y UTF-8 sin BOM"),
    ];
    for (const caso of reusos) {
      expect(generadorPropioDeArchivo(caso), caso).toEqual([]);
    }

    expect(
      importaElSubarbol('import { ExportarVistaFinanciera } from "../export-financiero/ExportarVistaFinanciera";'),
    ).toBe(true);
    expect(importaElSubarbol(soloCodigo("// vive en _components/export-financiero/"))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* (9) R26 — el modulo de columnas queda bajo la guardia perenne de la 170      */
/* -------------------------------------------------------------------------- */

/** La convencion que la 170 descubre (`columnas-sensibles.guardia.test.ts`). */
const SUFIJO_MODULO_DE_COLUMNAS = "-descarga-columnas.ts";

/** Los patrones con que la 170 carga los modulos. Se comparan contra SU fuente, mas abajo. */
const PATRONES_DE_LA_170 = [
  "../../../app/**/*-descarga-columnas.ts",
  "../../../components/**/*-descarga-columnas.ts",
];

/**
 * Traduce un glob sencillo (`**` y `*`) a expresion regular.
 *
 * Se tokeniza en vez de encadenar `replace`: sustituir `**` por `.*` y despues `*` por `[^/]*`
 * vuelve a tocar el `*` que la primera sustitucion acababa de escribir, y el patron resultante
 * deja de casar la ruta real. Ese error da un guardia que afirma que el modulo esta cubierto
 * cuando no lo esta — o al reves, que es como salio la primera version de este bloque.
 */
function globARegExp(patron: string): RegExp {
  const partes = patron.split(/(\*\*\/|\*\*|\*)/).map((token) => {
    if (token === "**/") return "(?:[^/]+/)*";
    if (token === "**") return ".*";
    if (token === "*") return "[^/]*";
    return token.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  });
  return new RegExp(`^${partes.join("")}$`);
}

/** Los modulos de columnas del arbol, descubiertos POR CONVENCION y no por lista. */
function modulosDeColumnasDelArbol(): string[] {
  return ["app", "components", "lib"]
    .flatMap((carpeta) => recorrer(path.join(RAIZ, carpeta)))
    .map(relativa)
    .filter((ruta) => ruta.endsWith(SUFIJO_MODULO_DE_COLUMNAS))
    .sort();
}

describe("R26/184 · el modulo de columnas sigue la convencion de nombre que la guardia de la 170 descubre", () => {
  it("el modulo de columnas sigue la convencion de nombre", () => {
    const modulo = ARCHIVOS_DECLARADOS.find((ruta) => ruta.endsWith(SUFIJO_MODULO_DE_COLUMNAS));
    expect(modulo, "el subarbol no declara ningun modulo con la convencion de nombre").toBeDefined();
    expect(modulosDeColumnasDelArbol()).toContain(modulo);
  });

  it("y la guardia de la 170 lo CARGA: su patron cubre la ruta del modulo nuevo", () => {
    const fuente = readFileSync(GUARDIA_170, "utf8");
    // Si la 170 cambiara sus patrones, este caso se pone rojo en vez de dejar el modulo fuera de
    // su censo sin que nada lo diga. No se compara contra una copia nuestra: se compara contra SU
    // fuente, que es la que manda.
    for (const patron of PATRONES_DE_LA_170) {
      expect(fuente, `la guardia de la 170 ya no usa el patron ${patron}`).toContain(patron);
    }
    expect(fuente).toContain(SUFIJO_MODULO_DE_COLUMNAS);

    const modulo = ARCHIVOS_DECLARADOS.find((ruta) => ruta.endsWith(SUFIJO_MODULO_DE_COLUMNAS))!;
    const cubierto = PATRONES_DE_LA_170.map((p) => p.replace(/^(\.\.\/)+/, "")).some((p) =>
      globARegExp(p).test(modulo),
    );
    expect(cubierto, `${modulo} no cae bajo ningun patron de la guardia de la 170`).toBe(true);
  });

  it("y ademas la sonda tiene algo que recorrer: el modulo exporta sus dos juegos y su proyeccion", async () => {
    // Contrapeso empirico: la convencion de nombre no sirve de nada si el modulo no publica lo que
    // la sonda de la 170 ejecuta.
    const modulo = await import(
      "@/app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas"
    );
    expect(modulo.COLUMNAS_DESCARGA_ANALITICA_FINANCIERA.length).toBeGreaterThan(0);
    expect(modulo.COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO.length).toBeGreaterThan(0);
    expect(typeof modulo.filaDescargaAnaliticaFinanciera).toBe("function");
  });

  it("autocomprobacion (9): el descubrimiento por convencion ve otros modulos y rechaza otro nombre", () => {
    const modulos = modulosDeColumnasDelArbol();
    // La 170 declaro ~25 modulos: si aqui saliera uno solo, el descubrimiento estaria roto.
    expect(modulos.length).toBeGreaterThan(5);
    expect(modulos.every((ruta) => ruta.endsWith(SUFIJO_MODULO_DE_COLUMNAS))).toBe(true);

    const bajoElPatron = (ruta: string) =>
      PATRONES_DE_LA_170.map((p) => p.replace(/^(\.\.\/)+/, "")).some((p) => globARegExp(p).test(ruta));

    expect(bajoElPatron("app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas.ts")).toBe(
      true,
    );
    expect(bajoElPatron("components/shared/usuarios-descarga-columnas.ts")).toBe(true);
    // El mismo contenido con OTRO nombre quedaria fuera del censo de la 170, que es la mutacion.
    expect(bajoElPatron("app/(app)/analitica/_components/export-financiero/columnas.ts")).toBe(false);
    expect(bajoElPatron("lib/utils/analitica-financiera-descarga-columnas.ts")).toBe(false);
  });
});
