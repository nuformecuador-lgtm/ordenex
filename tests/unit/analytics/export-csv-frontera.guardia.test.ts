import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
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
//                     (2026-08-23, feature 267: su via POR RUTA se estrecho a una allowlist
//                     nominal de UN camino —la API publica por API key—; la via POR CODIGO
//                     quedo INTACTA sobre `app/api` entero. Motivo y descartes, en el caso.)
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
  return quitarComentarios(fuente);
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

/* -------------------------------------------------------------------------- */
/* ALLOWLIST NOMINAL — 2026-08-23, feature 267 (decision P6 de su puerta)      */
/* -------------------------------------------------------------------------- */

/**
 * EL UNICO handler de `app/api` que este bloque admite que se LLAME `analitica`.
 *
 * Es una lista de UN camino escrito entero, no un patron: un patron
 * (`app/api/ordenes/api-key/**`) autorizaria de golpe a los que todavia no existen. Es la
 * misma constante, con el mismo nombre y el mismo valor, que ya usan los otros dos guardias
 * estrechados por la 267 (`tablero-operativo-frontera.guardia.test.ts` y
 * `operativa-frontera.guardia.test.ts`): TRES guardias, una sola excepcion nominal.
 */
const HANDLER_ANALITICA_AUTORIZADO = "app/api/ordenes/api-key/analitica/route.ts";

/**
 * El filtro POR NOMBRE DE ARCHIVO, aislado para que el caso REAL (sobre el arbol) y la
 * AUTOCOMPROBACION SINTETICA (sobre rutas inventadas) usen exactamente la misma logica. Si se
 * afloja aqui, se afloja tambien el caso negativo y este deja de pasar: es lo que impide que
 * «estrechar» se convierta en «relajar» de tapadillo.
 *
 * OJO CON LO QUE ESTE PREDICADO **NO** HACE: no exime a nadie del censo POR CODIGO
 * (`EXPORT_DE_ANALITICA`), que sigue barriendo `app/api` ENTERO, camino autorizado incluido.
 */
function rutasDeAnaliticaNoAutorizadas(rutas: readonly string[]): string[] {
  return rutas.filter(
    (rel) => /analitica|analytics/i.test(rel) && rel !== HANDLER_ANALITICA_AUTORIZADO,
  );
}

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
  it("ninguna ruta de app/api sirve el export de analitica, salvo el UNICO camino autorizado", () => {
    // 2026-08-23 · FEATURE 267 · decision P6 de la puerta, extendida a ESTE guardia y firmada
    // por el humano ese mismo dia. La 267 la habia aplicado a los otros dos guardias de
    // frontera; este tercero no se habia detectado en su spec. Con este, son TRES los guardias
    // estrechados por la feature —ni uno mas—, y los tres comparten la misma unica excepcion
    // nominal.
    //
    // SE ESTRECHA, NO SE DEROGA, y solo la via POR RUTA: pasa de «ningun archivo de `app/api`
    // puede llamarse analitica» a «exactamente UNO, con su nombre completo escrito». Cabe
    // dentro del motivo del guardia, no a pesar de el: el parrafo de arriba —el de la 134, que
    // se conserva palabra por palabra— reserva los route handlers para «webhooks, API PUBLICA
    // y crons», y `GET /api/ordenes/api-key/analitica` ES la API publica: el canal por API key,
    // autenticado con `Authorization: Bearer ordx_...` y con contrato publicado en
    // `docs/api/api-key-openapi.yaml`. Lo que la 134 escribio este bloque para impedir es una
    // SEGUNDA superficie INTERNA de export que duplicara el gating; eso sigue prohibido igual.
    //
    // Y EL HANDLER CAIA SOLO POR EL NOMBRE DEL ARCHIVO: se midio antes de tocar nada. De los
    // diez patrones de `EXPORT_DE_ANALITICA` no dispara NINGUNO —no genera CSV, no nombra los
    // modulos del export, no importa nada de `lib/analytics/`; delega en
    // `lib/api/analitica-integrador.ts`—. Era un falso positivo de nomenclatura, no una
    // infraccion del motivo de este bloque.
    //
    // LO QUE QUEDO EXPRESAMENTE DESCARTADO, para que no se reabra: renombrar la ruta para
    // esquivar el regex. Habria pasado el guardia sin pasar su motivo, y el proximo lector no
    // habria encontrado ni la analitica ni la decision.
    //
    // QUE SIGUE PROHIBIDO, SIN UN CARACTER DE DIFERENCIA: el censo POR CODIGO se aplica a
    // `app/api` ENTERO, camino autorizado INCLUIDO. Si alguien hace que ese handler exporte un
    // CSV o importe de `lib/analytics/`, este caso se pone rojo igual que el primer dia — lo
    // comprueba el caso negativo (b) de mas abajo. La excepcion es para el NOMBRE, no para la
    // conducta.
    const porRuta = rutasDeAnaliticaNoAutorizadas(archivos(DIR_API));
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

  it("la allowlist es NOMINAL: el camino autorizado existe de verdad en el arbol", () => {
    // Sin este caso, un `HANDLER_ANALITICA_AUTORIZADO` que apuntara a un archivo borrado
    // dejaria una excepcion viva para un nombre que nadie ocupa: el sitio perfecto para que
    // manana aparezca otra cosa con ese nombre y entre gratis.
    expect(fs.existsSync(path.join(REPO_ROOT, HANDLER_ANALITICA_AUTORIZADO))).toBe(true);
    expect(archivos(DIR_API)).toContain(HANDLER_ANALITICA_AUTORIZADO);
  });

  it("y NO es una relajacion (a): un SEGUNDO handler de analitica en `app/api` seguiria cayendo", () => {
    // AUTOCOMPROBACION SINTETICA. Nada se escribe en el arbol: se pasa por el MISMO predicado
    // del caso real una lista de rutas inventadas. Sin este caso, «estrechar» y «relajar»
    // serian indistinguibles desde fuera.
    const inventados = [
      "app/api/reportes/analitica/route.ts",
      "app/api/analitica/export/route.ts",
      "app/api/ordenes/api-key/analitica/v2/route.ts",
      "app/api/interno/analytics/csv/route.ts",
      // Y tampoco vale disfrazar el nombre: el regex mira la RUTA entera, sin caso.
      "app/api/interno/Analitica-Operativa/route.ts",
    ];
    expect(rutasDeAnaliticaNoAutorizadas([...archivos(DIR_API), ...inventados])).toEqual(inventados);
  });

  it("y NO es una relajacion (b): el censo POR CODIGO sigue vivo SOBRE EL PROPIO camino autorizado", () => {
    // La otra mitad de la decision, afirmada en vez de contada. La excepcion es para el NOMBRE
    // del archivo; la conducta se sigue juzgando igual que en cualquier otra ruta de `app/api`.
    for (const infractor of [
      'import { COLUMNAS_DESCARGA_ANALITICA_OPERATIVA } from "@/lib/analytics/descarga";',
      'import { filasDeSerie } from "@/lib/analytics/serie";',
      "const filas = await consultarAnaliticaOperativa(filtro);",
      "export { filaDescargaAnaliticaOperativa };",
    ]) {
      expect(EXPORT_DE_ANALITICA.some((p) => p.test(soloCodigo(infractor))), infractor).toBe(true);
    }
    // Y el handler REAL, leido del disco, no cae por codigo: pasa por conducta, no por permiso.
    expect(
      EXPORT_DE_ANALITICA.filter((p) => p.test(codigoDe(HANDLER_ANALITICA_AUTORIZADO))),
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
