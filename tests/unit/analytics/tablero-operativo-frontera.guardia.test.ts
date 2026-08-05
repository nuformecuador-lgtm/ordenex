import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { recorteDePresentacion } from "@/lib/analytics/presentacion";
import type { ActorAnalitica } from "@/lib/analytics/alcance";

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
//
// ===========================================================================
// FEATURE 133 (T6.1 / D5) — LA AMPLIACION: `lib/analytics/presentacion`
// ===========================================================================
//
// NADA DE LO DE ARRIBA SE RELAJA (R29). Todo lo que este archivo prohibia sigue
// prohibido, con las mismas expresiones y sobre los mismos arboles: la ruta sigue sin
// poder importar `lib/analytics/alcance*` ni `lib/analytics/identidad`, ni invocar
// `resolverAlcance` o `seudonimizar`. Aqui SOLO se AÑADE.
//
// QUE ARISTA SE AUTORIZA Y POR QUE. La 133 hace que `app/(app)/analitica/page.tsx`
// importe `recorteDePresentacion` de `lib/analytics/presentacion`. Es legitima, y no por
// conveniencia, sino porque es OTRA COSA que lo que R10 persigue:
//
//   - Lo que R10 prohibe es recortar DATOS en el cliente: esconder filas que el servidor
//     SI concedio, o intentar deshacer una seudonimizacion.
//   - `presentacion.ts` no recorta ni una fila. Decide, EN EL SERVIDOR (la pagina es un
//     Server Component), QUE CONTROL SE DIBUJA. Lo que cruza a los componentes es un enum
//     y una lista de hasta tres strings; ni un id, ni un nombre, ni un uuid, ni una cifra.
//   - Y no sustituye a nada: el recorte de DATOS lo sigue aplicando el borde de la 122
//     antes de tocar la base, exactamente igual aunque estas props dijeran otra cosa. Un
//     panel que no se pinta no es un dato que no se filtra (aviso literal de la 122,
//     `specs/122-.../design.md:466-468`; R20/R21/R27 de la 133).
//
// POR QUE HAY QUE ESCRIBIRLO, SI HOY YA PASABA. Se midio: el import de
// `@/lib/analytics/presentacion` NO ponia rojo este guardia, porque el patron vigente es
// `/from\s+["']@\/lib\/analytics\/alcance/` y `presentacion` no casa. Es decir: la arista
// estaba pasando por SILENCIO, no por permiso. Eso es justo el rodeo tacito que D5 avisa
// de no dejar («la excepcion escrita y vigilada es honesta; la excepcion no escrita es un
// agujero»). Asi que la excepcion pasa a ser NOMINAL, UNICA y JUSTIFICADA, con el mismo
// patron que la allowlist de una sola arista de `modulo-puro.guardia.test.ts` (R36 de la
// 122): se juzga el par (modulo, NOMBRES importados), no el archivo ni el paquete.
//
// LAS DOS ASERCIONES NUEVAS, Y QUE MUTACION MATA CADA UNA:
//
//   (a) CENSO DE ARISTAS (R20). Toda arista de `app/(app)/analitica/**` hacia
//       `lib/analytics/**` tiene que estar en `ARISTAS_ANALYTICS_AUTORIZADAS`, con su
//       modulo Y sus nombres. Mata: añadir a cualquier archivo de la ruta un import de
//       otro modulo del arbol (`alcance-columnas`, `identidad`, `metrics`, `consulta`,
//       `auditoria`…), o un nombre nuevo de un modulo ya permitido, o la misma arista en
//       forma `default` / `* as`. Y mata tambien el crecimiento silencioso de la propia
//       lista: se afirma que los modulos autorizados son exactamente dos y que el UNICO
//       que la 133 añade es `presentacion`.
//
//   (b) EL RETORNO NO LLEVA DATOS (R20/R21). `RecortePresentacion` solo puede tener los
//       campos `alcance` y `facetas`, y sus tipos solo pueden ser uniones de literales de
//       cadena (o arrays de ellas). Mata: añadir a la interfaz cualquier campo de datos
//       —`readonly tiendaId: string`, `readonly filas: readonly Fila[]`,
//       `readonly mensajeroId: string | null`—, que cae por el conjunto de campos Y por
//       la forma del tipo. Se comprueba ademas EN EJECUCION, sobre el objeto devuelto
//       para los cinco roles: sus claves son esas dos y no viaja ningun uuid.
//
// Si algun dia `presentacion.ts` pasara a devolver filas, (b) cae aqui — no en produccion
// — y esta autorizacion se retira.

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
  /\bresolverAlcance\b/,
  /\bseudonimizar\w*/,
];

/**
 * R10, segundo tramo — ACOTADO al subarbol de la 131, y no a toda la ruta. Decidido al
 * mergear la 132 (tablero financiero), que se puso roja aqui.
 *
 * Lo que R10 teme, y sigue prohibido en TODA la ruta, esta en la lista de arriba: importar
 * los modulos de alcance o identidad, `resolverAlcance`, `seudonimizar`. Son recortes de
 * DATOS en el cliente, y solo pueden esconder lo que el servidor concedio o intentar
 * deshacer una seudonimizacion.
 *
 * `esAccesoTotal` es otra cosa y por eso baja de tramo. En `app/(app)/analitica/page.tsx`
 * —archivo de la 129, compartido por la 131 y la 132— la 132 lo usa para decidir si
 * PIDE los datos del dinero: un gate de servidor ESTRICTAMENTE MAS FUERTE que no pedir
 * nada, aplicado antes de consultar, no un recorte posterior de filas concedidas. Barrer
 * la ruta entera con este patron acusaba a la 132 de un pecado que no comete.
 *
 * Dentro del subarbol operativo sigue prohibido: ahi no hay ninguna region que gatear por
 * rol, y usarlo solo podria significar re-recortar lo que el servidor ya recorto.
 */
const ACCESO_TOTAL: readonly RegExp[] = [/\besAccesoTotal\b/];

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

  it("y en el SUBARBOL operativo tampoco se gatea por rol con `esAccesoTotal`", () => {
    // Segundo tramo, acotado (ver el comentario de ACCESO_TOTAL). Dentro del subarbol de
    // la 131 no hay ninguna region que gatear por rol, asi que usarlo aqui solo podria
    // significar re-recortar lo que el servidor ya recorto.
    const malos = infractores(DIR_OPERATIVO, ACCESO_TOTAL);
    expect(
      malos,
      "el subarbol operativo no decide por rol: eso ya ocurrio en el borde. Archivos: " +
        malos.join(", "),
    ).toEqual([]);
  });

  it("el acotamiento NO abre un hueco: el tramo ancho sigue vivo en la ruta entera", () => {
    // Sin este caso, acotar `esAccesoTotal` podria confundirse con haber aflojado R10
    // entero. Se comprueba sobre codigo SINTETICO —nada se escribe en el arbol— que un
    // recorte de datos en cualquier archivo de la ruta seguiria siendo infractor.
    for (const codigo of [
      'import { whereOrden } from "@/lib/analytics/alcance-columnas";',
      'import { seudonimizarMensajero } from "@/lib/analytics/identidad";',
      "const filas = resolverAlcance(actor, crudas);",
      "const visibles = filas.map(seudonimizarMensajero);",
    ]) {
      expect(
        ALCANCE_E_IDENTIDAD.some((p) => p.test(codigo)),
        codigo,
      ).toBe(true);
    }
    // Y el patron acotado sigue detectando de verdad, no es una lista muerta.
    expect(ACCESO_TOTAL.some((p) => p.test("if (!esAccesoTotal(actor.rol)) return null;"))).toBe(
      true,
    );
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

/* ========================================================================== */
/* FEATURE 133 (T6.1 / D5) — (a) censo NOMINAL de aristas hacia lib/analytics  */
/* ========================================================================== */

const PREFIJO_ANALYTICS = "@/lib/analytics/";

/** Una arista de la ruta hacia el arbol `lib/analytics/`, con los nombres que trae. */
interface AristaAnalytics {
  readonly desde: string;
  readonly modulo: string;
  readonly forma: "nombrada" | "default" | "namespace" | "efecto";
  readonly nombres: readonly string[];
}

/**
 * ALLOWLIST NOMINAL. Cada entrada autoriza un MODULO y unos NOMBRES concretos; nada mas.
 * `feature` dice quien la trajo, y sostiene la asercion de que la 133 añade exactamente
 * UNA. Crecer esta lista es un diff visible en un archivo llamado "guardia de frontera".
 */
const ARISTAS_ANALYTICS_AUTORIZADAS = [
  {
    feature: 131,
    modulo: "@/lib/analytics/types",
    nombres: ["MetricaUnidad", "DimensionAnalitica", "RANGO_PRESETS", "RangoPreset"],
    motivo:
      "vocabulario compartido del contrato (unidades, dimensiones y los presets de rango). " +
      "Son literales y tipos, no datos ni catalogo: `metrics` —el censo de 23 metricas con " +
      "su alcance por rol y sus tablas— sigue FUERA de la lista y por tanto prohibido.",
  },
  {
    feature: 133,
    modulo: "@/lib/analytics/presentacion",
    nombres: ["recorteDePresentacion", "RecortePresentacion", "Faceta"],
    motivo:
      "recorte de PRESENTACION resuelto en el servidor: decide que control se dibuja y " +
      "devuelve un enum mas una lista de strings (lo comprueba el bloque (b) de abajo). No " +
      "recorta ni una fila: el recorte de DATOS es del borde de la 122 y sigue intacto. Se " +
      "autoriza por escrito porque ninguna prohibicion vigente la cubria, y una arista que " +
      "pasa por silencio es un rodeo tacito (D5).",
  },
] as const;

/** Extrae del codigo las aristas hacia `@/lib/analytics/*`, con forma y nombres. */
function aristasAnalyticsDe(rel: string): AristaAnalytics[] {
  const codigo = codigoDe(rel);
  const aristas: AristaAnalytics[] = [];

  const estatico = /\b(?:import|export)\s+(?:type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of codigo.matchAll(estatico)) {
    if (!m[2].startsWith(PREFIJO_ANALYTICS)) continue;
    aristas.push({ desde: rel, modulo: m[2], ...analizarClausula(m[1] ?? "") });
  }

  // Import de solo efecto e import() dinamico: tambien traen el modulo al proceso.
  const otros = /\bimport\s*\(?\s*["']([^"']+)["']\s*\)?/g;
  for (const m of codigo.matchAll(otros)) {
    if (!m[1].startsWith(PREFIJO_ANALYTICS)) continue;
    if (aristas.some((a) => a.modulo === m[1])) continue;
    aristas.push({ desde: rel, modulo: m[1], forma: "namespace", nombres: ["*"] });
  }

  return aristas;
}

/** Que nombres trae una clausula de import, y de que forma. */
function analizarClausula(clausula: string): {
  forma: AristaAnalytics["forma"];
  nombres: string[];
} {
  const limpia = clausula.trim().replace(/^type\s+/, "");
  if (limpia === "") return { forma: "efecto", nombres: [] };
  if (limpia.startsWith("*")) return { forma: "namespace", nombres: ["*"] };
  if (!limpia.startsWith("{")) return { forma: "default", nombres: [limpia.split(",")[0].trim()] };
  const nombres = limpia
    .replace(/[{}]/g, "")
    .split(",")
    .map((n) => n.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter((n) => n !== "");
  return { forma: "nombrada", nombres };
}

/** Vacio si la arista esta autorizada; si no, el motivo del rechazo. */
function violacionesDeAristaAnalytics(arista: AristaAnalytics): string[] {
  const permitida = ARISTAS_ANALYTICS_AUTORIZADAS.find((p) => p.modulo === arista.modulo);
  if (!permitida) {
    return [`${arista.desde}: importa "${arista.modulo}", que NO esta en la allowlist nominal`];
  }
  if (arista.forma !== "nombrada" || arista.nombres.length === 0) {
    return [
      `${arista.desde}: importa "${arista.modulo}" en forma "${arista.forma}" (solo se ` +
        `admite el import NOMBRADO: un default o un namespace trae el modulo entero)`,
    ];
  }
  const ajenos = arista.nombres.filter(
    (n) => !(permitida.nombres as readonly string[]).includes(n),
  );
  if (ajenos.length > 0) {
    return [`${arista.desde}: importa de "${arista.modulo}" nombres no autorizados: ${ajenos.join(", ")}`];
  }
  return [];
}

function aristasAnalyticsDeLaRuta(): AristaAnalytics[] {
  return archivos(DIR_ANALITICA).flatMap(aristasAnalyticsDe);
}

describe("Feature 133 (R20, R29) — `lib/analytics/presentacion` es arista NOMINAL, unica y justificada", () => {
  it("toda arista de la ruta hacia lib/analytics esta escrita en la allowlist, con sus nombres", () => {
    const violaciones = aristasAnalyticsDeLaRuta().flatMap(violacionesDeAristaAnalytics);
    expect(
      violaciones,
      "la ruta solo puede tocar `lib/analytics/` por las aristas ESCRITAS aqui. Una arista " +
        "nueva no se autoriza sola: si de verdad hace falta, se añade con su motivo y este " +
        "guardia queda diciendo la verdad. Violaciones: " +
        violaciones.join(" | "),
    ).toEqual([]);
  });

  it("la 133 añade EXACTAMENTE una arista, y es `presentacion`", () => {
    const modulos = ARISTAS_ANALYTICS_AUTORIZADAS.map((a) => a.modulo);
    expect(modulos).toEqual(["@/lib/analytics/types", "@/lib/analytics/presentacion"]);

    const de133 = ARISTAS_ANALYTICS_AUTORIZADAS.filter((a) => a.feature === 133);
    expect(de133.map((a) => a.modulo)).toEqual(["@/lib/analytics/presentacion"]);
    for (const entrada of ARISTAS_ANALYTICS_AUTORIZADAS) {
      expect(entrada.motivo.length, entrada.modulo).toBeGreaterThan(80);
    }
  });

  it("la arista autorizada existe de verdad hoy: si desapareciera, la entrada sobraria", () => {
    const usadas = aristasAnalyticsDeLaRuta();
    expect(
      usadas.some((a) => a.modulo === "@/lib/analytics/presentacion"),
      "la ruta ya no importa `presentacion`: retirar la entrada en vez de dejarla de adorno",
    ).toBe(true);
    expect(
      usadas.some(
        (a) => a.desde === "app/(app)/analitica/page.tsx" && a.nombres.includes("recorteDePresentacion"),
      ),
    ).toBe(true);
  });

  it("la excepcion tenia que ESCRIBIRSE: ninguna prohibicion vigente cubria esta arista", () => {
    // El hecho que motiva T6.1, afirmado en vez de contado: el import de `presentacion` no
    // casa con los patrones de R10 (por eso pasaba en SILENCIO), mientras que el de
    // `alcance` si. Si algun dia el patron de R10 se ensanchara hasta cubrir `presentacion`,
    // este caso cae y habra que decidir a proposito cual de los dos manda.
    const conPresentacion = 'import { recorteDePresentacion } from "@/lib/analytics/presentacion";';
    const conAlcance = 'import { resolverAlcance } from "@/lib/analytics/alcance";';
    expect(ALCANCE_E_IDENTIDAD.some((p) => p.test(conPresentacion))).toBe(false);
    expect(ALCANCE_E_IDENTIDAD.some((p) => p.test(conAlcance))).toBe(true);
    // Y el censo nominal SI la juzga: pasa por permiso escrito, no por silencio.
    expect(violacionesDeAristaAnalytics(unaArista(conPresentacion))).toEqual([]);
  });

  it("autocomprobacion: una arista sintetica no autorizada sale ROJA", () => {
    const infractoras = [
      'import { whereOrden } from "@/lib/analytics/alcance-columnas";',
      'import { seudonimizarMensajero } from "@/lib/analytics/identidad";',
      'import { listarMetricas } from "@/lib/analytics/metrics";',
      'import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";',
      'import type { Algo } from "@/lib/analytics/auditoria";',
      // Modulo permitido, nombre NO permitido: la allowlist es nominal.
      'import { METRICAS } from "@/lib/analytics/types";',
      'import { facetaSeOfrece } from "@/lib/analytics/presentacion";',
      // Modulo y nombre permitidos, forma que trae el modulo entero.
      'import * as presentacion from "@/lib/analytics/presentacion";',
      'import presentacion from "@/lib/analytics/presentacion";',
      'const m = await import("@/lib/analytics/presentacion");',
    ];
    for (const codigo of infractoras) {
      expect(violacionesDeAristaAnalytics(unaArista(codigo)), codigo).not.toEqual([]);
    }
  });

  it("autocomprobacion: las aristas legitimas de hoy NO salen rojas, y la prosa no cuenta", () => {
    const legitimas = [
      'import { recorteDePresentacion } from "@/lib/analytics/presentacion";',
      'import type { Faceta } from "@/lib/analytics/presentacion";',
      'import type { RecortePresentacion } from "@/lib/analytics/presentacion";',
      'import { RANGO_PRESETS, type RangoPreset } from "@/lib/analytics/types";',
      'import type { MetricaUnidad } from "@/lib/analytics/types";',
    ];
    for (const codigo of legitimas) {
      expect(violacionesDeAristaAnalytics(unaArista(codigo)), codigo).toEqual([]);
    }
    // Una mencion en un comentario no es una arista (mismo criterio que el resto del archivo).
    expect(aristasSinteticas("// ojo: no importes @/lib/analytics/identidad aqui")).toEqual([]);
  });

  it("el censo mira aristas de verdad (si no, seria verde por vacio)", () => {
    const usadas = aristasAnalyticsDeLaRuta();
    expect(usadas.length).toBeGreaterThan(4);
    // Las dos entradas de la lista se USAN: ninguna esta ahi de adorno, y el censo no
    // esta pasando porque el extractor de aristas haya dejado de encontrar nada.
    for (const entrada of ARISTAS_ANALYTICS_AUTORIZADAS) {
      expect(usadas.some((a) => a.modulo === entrada.modulo), entrada.modulo).toBe(true);
    }
  });
});

/** Aristas de un fragmento de codigo sintetico: nada se escribe en el arbol. */
function aristasSinteticas(codigoFuente: string): AristaAnalytics[] {
  const codigo = soloCodigo(codigoFuente);
  const aristas: AristaAnalytics[] = [];
  const estatico = /\b(?:import|export)\s+(?:type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of codigo.matchAll(estatico)) {
    if (!m[2].startsWith(PREFIJO_ANALYTICS)) continue;
    aristas.push({ desde: "sintetico.ts", modulo: m[2], ...analizarClausula(m[1] ?? "") });
  }
  const dinamico = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of codigo.matchAll(dinamico)) {
    if (!m[1].startsWith(PREFIJO_ANALYTICS)) continue;
    aristas.push({ desde: "sintetico.ts", modulo: m[1], forma: "namespace", nombres: ["*"] });
  }
  return aristas;
}

function unaArista(codigoFuente: string): AristaAnalytics {
  const aristas = aristasSinteticas(codigoFuente);
  expect(aristas.length, `el fragmento no produjo arista: ${codigoFuente}`).toBe(1);
  return aristas[0];
}

/* ========================================================================== */
/* FEATURE 133 (T6.1 / D5) — (b) el retorno de `recorteDePresentacion` no      */
/* contiene NINGUN campo de datos                                             */
/* ========================================================================== */

const PRESENTACION_REL = "lib/analytics/presentacion.ts";

/** Los dos unicos campos que el contrato de D5 admite. */
const CAMPOS_DE_PRESENTACION = ["alcance", "facetas"];

/** `export type X = ...;` de un archivo, para resolver alias locales (p. ej. `Faceta`). */
function aliasDeTipo(codigo: string): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const m of codigo.matchAll(/\btype\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g)) {
    alias[m[1]] = m[2].trim();
  }
  return alias;
}

/** Campos declarados en una interfaz: nombre y texto del tipo. */
function camposDeInterfaz(codigo: string, nombre: string): { nombre: string; tipo: string }[] {
  const m = new RegExp(`\\binterface\\s+${nombre}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(codigo);
  if (!m) return [];
  return m[1]
    .split(";")
    .map((linea) => linea.trim())
    .filter((linea) => linea !== "")
    .map((linea) => {
      const campo = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]+)$/.exec(linea);
      return campo
        ? { nombre: campo[1], tipo: campo[2].replace(/\s+/g, " ").trim() }
        : { nombre: linea, tipo: "<ilegible>" };
    });
}

/**
 * `true` solo si el tipo es una union de literales de cadena, o un array (readonly o no)
 * de ellos, resolviendo alias locales. `string`, `number`, `Date`, un objeto o una
 * referencia a un tipo de fila NO lo son: eso es lo que hace que un campo de DATOS caiga.
 */
function esSoloEtiquetas(tipo: string, alias: Record<string, string>, prof = 0): boolean {
  if (prof > 3) return false;
  let t = tipo.trim();
  t = t.replace(/^readonly\s+/, "");
  if (t.endsWith("[]")) t = t.slice(0, -2).trim();
  if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim();
  const partes = t.split("|").map((p) => p.trim()).filter((p) => p !== "");
  if (partes.length === 0) return false;
  return partes.every((parte) => {
    if (/^["'][a-z_]+["']$/i.test(parte)) return true;
    const definicion = alias[parte.replace(/\[\]$/, "").replace(/^readonly\s+/, "")];
    return definicion !== undefined && esSoloEtiquetas(definicion, alias, prof + 1);
  });
}

/** Aplica (b) al codigo fuente de un modulo de presentacion — real o sintetico. */
function violacionesDelRetorno(codigoFuente: string): string[] {
  const codigo = soloCodigo(codigoFuente);
  const campos = camposDeInterfaz(codigo, "RecortePresentacion");
  const alias = aliasDeTipo(codigo);
  const violaciones: string[] = [];

  if (campos.length === 0) violaciones.push("no se encontro la interfaz RecortePresentacion");

  const nombres = campos.map((c) => c.nombre).sort();
  if (JSON.stringify(nombres) !== JSON.stringify([...CAMPOS_DE_PRESENTACION].sort())) {
    violaciones.push(`los campos son [${nombres.join(", ")}] y deben ser [alcance, facetas]`);
  }
  for (const campo of campos) {
    if (!esSoloEtiquetas(campo.tipo, alias)) {
      violaciones.push(`el campo "${campo.nombre}: ${campo.tipo}" no es una etiqueta ni una lista de etiquetas`);
    }
  }
  return violaciones;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("Feature 133 (R20, R21) — lo que cruza la frontera son ETIQUETAS, no datos", () => {
  it("RecortePresentacion declara `alcance` y `facetas`, y nada mas", () => {
    const violaciones = violacionesDelRetorno(fs.readFileSync(path.join(REPO_ROOT, PRESENTACION_REL), "utf8"));
    expect(
      violaciones,
      "el retorno del recorte de PRESENTACION no puede llevar datos: ni filas, ni ids, ni " +
        "uuids, ni nombres de tienda/zona/persona. El dia que los lleve, deja de ser " +
        "presentacion y esta arista pierde su justificacion. Violaciones: " +
        violaciones.join(" | "),
    ).toEqual([]);
  });

  it("y en EJECUCION devuelve exactamente esas dos claves, sin un solo uuid", () => {
    const ZONA = "11111111-1111-4111-8111-111111111111";
    const USUARIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const actores: readonly (ActorAnalitica | null)[] = [
      null,
      { usuarioId: USUARIO, rol: "maestro" },
      { usuarioId: USUARIO, rol: "admin" },
      { usuarioId: USUARIO, rol: "adminTienda" },
      { usuarioId: USUARIO, rol: "adminSatelite", zonaId: ZONA },
      { usuarioId: USUARIO, rol: "mensajero" },
    ];

    for (const actor of actores) {
      const recorte = recorteDePresentacion(actor);
      const etiqueta = actor?.rol ?? "sin sesion";

      expect(Object.keys(recorte).sort(), etiqueta).toEqual([...CAMPOS_DE_PRESENTACION].sort());
      expect(typeof recorte.alcance, etiqueta).toBe("string");
      expect(Array.isArray(recorte.facetas), etiqueta).toBe(true);
      for (const faceta of recorte.facetas) expect(typeof faceta, etiqueta).toBe("string");

      // Ni el id del actor, ni su zona, ni ningun otro identificador viajan de vuelta.
      const serializado = JSON.stringify(recorte);
      expect(UUID_RE.test(serializado), `${etiqueta}: ${serializado}`).toBe(false);
      expect(serializado.includes(USUARIO), etiqueta).toBe(false);
      expect(serializado.includes(ZONA), etiqueta).toBe(false);
    }
  });

  it("autocomprobacion: un campo de DATOS en la interfaz sale ROJO", () => {
    const cabecera = 'export type Faceta = "zona" | "tienda" | "mensajero";\n';
    const cuerpoLimpio = `  readonly alcance: "global" | "zona" | "tienda" | "mensajero" | "denegado";
  readonly facetas: readonly Faceta[];`;

    // El modulo tal y como esta hoy, reducido: verde.
    expect(violacionesDelRetorno(`${cabecera}export interface RecortePresentacion {\n${cuerpoLimpio}\n}\n`)).toEqual([]);

    const mutaciones = [
      "  readonly tiendaId: string;",
      "  readonly mensajeroId: string | null;",
      "  readonly filas: readonly Fila[];",
      "  readonly nombreTienda: string;",
      "  readonly total: number;",
      // Incluso sustituyendo un campo legitimo por su version "con dato".
      "  readonly alcanceId: string;",
    ];
    for (const mutacion of mutaciones) {
      const mutado = `${cabecera}export interface RecortePresentacion {\n${cuerpoLimpio}\n${mutacion}\n}\n`;
      expect(violacionesDelRetorno(mutado), mutacion).not.toEqual([]);
    }

    // Y un campo con el NOMBRE permitido pero el tipo abierto tambien cae: no basta con
    // llamarse `facetas` para poder traer strings arbitrarias.
    const tipoAbierto = `${cabecera}export interface RecortePresentacion {
  readonly alcance: string;
  readonly facetas: readonly Faceta[];
}\n`;
    expect(violacionesDelRetorno(tipoAbierto)).not.toEqual([]);
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
