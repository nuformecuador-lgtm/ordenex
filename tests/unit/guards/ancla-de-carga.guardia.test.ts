// Chore del flake de jsdom — GUARDIA del TERCER mecanismo: «un ancla que el estado
// transitorio tambien cumple no es un ancla».
//
// QUE MIDE ESTE ARCHIVO Y POR QUE NO LO MIDE NINGUN OTRO
// ------------------------------------------------------
// `progress/chore_flake_jsdom.md` documenta tres mecanismos distintos del mismo flake. El
// (1) y el (2) estan tratados; el (3) es este:
//
//   una foto del DOM tomada ANTES de que la carga asiente, comparada despues -> diff con
//   «Cargando» en un lado, intermitente y lejos de su causa.
//
// El caso real (§6 de ese documento): la preparacion de la Familia B esperaba con
//
//     await waitFor(() => expect(within(tabla).getAllByRole("row")).toHaveLength(2));
//
// y el estado de CARGA del `DataTable` pinta un `<tr>` con `role="status"` («Cargando»,
// sr-only) mas filas skeleton `aria-hidden`. Como las skeleton NO cuentan como `row`,
// durante la carga `getAllByRole("row")` devuelve header + status = 2… EXACTAMENTE el
// mismo numero que el estado ya asentado. El `waitFor` se satisfacia a media carga.
//
// POR QUE EL DETECTOR VIVE EN EL ANCLA Y NO EN LA FOTO
// ---------------------------------------------------
// El chore ya intento un detector sobre las CAPTURAS del DOM y lo midio con SENSIBILIDAD
// CERO (0 antes del arreglo y 0 despues): la espera insuficiente estaba dentro de un helper,
// a un nivel de indireccion de la foto, y «¿deja este helper la UI asentada?» es una
// propiedad semantica. Pero el defecto no vive en la foto: vive en el ANCLA, y la forma del
// ancla SI es sintactica. Un `waitFor` cuya unica afirmacion es un CONTEO de elementos no
// dice QUE hay en la pantalla, solo CUANTAS cosas hay — y el estado de carga tambien tiene
// un numero. Por eso este censo mira las esperas, no las capturas.
//
// LA REGLA, en una linea: un `await waitFor(...)` anclado SOLO a un conteo de elementos del
// DOM tiene que decir ademas QUE espera (una asercion de contenido) o excluir explicitamente
// el estado de carga (`queryByRole("status")` ausente). Con una de las dos basta.
//
// LO QUE ESTE CENSO NO CUBRE, declarado y no tapado:
//
//  - las esperas ancladas a un MOCK (`toHaveBeenCalledTimes`) — 276 en el arbol al escribir
//    esto. Que la consulta SALGA no es que la pantalla LLEGUE, y es la misma familia; pero
//    ahi el arreglo no es mecanico (hay esperas cuyo sujeto legitimo ES la llamada, no la
//    pantalla) y meterlas aqui convertiria el guardia en ruido. Queda como deuda medida.
//  - `await screen.findAllBy*(...)` seguido de un conteo, que es la misma ambiguedad escrita
//    de otra forma. No aparece hoy en el arbol; si aparece, este censo no la vera.
//  - el guardia no previene la carrera: prueba que ninguna espera esta anclada solo a un
//    numero. Contra la carrera ya materializada estan las guardias en ejecucion de
//    `ControlDescargaTransversal.test.tsx` (`esperarTablaAsentada`, `fotoDeLaPantalla`).

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const DIR_TESTS = path.join(RAIZ, "tests");

/**
 * Este archivo queda FUERA del censo: un guardia contiene por fuerza los patrones que
 * persigue, porque su autocomprobacion los escribe.
 */
const ESTE_GUARDIA = "tests/unit/guards/ancla-de-carga.guardia.test.ts";

function recorrer(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) return recorrer(completo);
    return [".ts", ".tsx"].includes(path.extname(completo)) ? [completo] : [];
  });
}

function relativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/* -------------------------------------------------------------------------- */
/* Extraccion: los cuerpos de `await waitFor(...)`                             */
/* -------------------------------------------------------------------------- */

/**
 * Los cuerpos de `await waitFor(...)` de un fuente, con su linea.
 *
 * Se equilibran los parentesis en vez de casarlos con un regex: el cuerpo de un `waitFor`
 * es codigo con llamadas anidadas y un `\(([^)]*)\)` se corta en el primer `)`. Un parser
 * que se queda a medias del texto que juzga es un guardia que pasa por ciego.
 */
function esperasDe(fuente: string): { readonly linea: number; readonly cuerpo: string }[] {
  const salida: { linea: number; cuerpo: string }[] = [];
  const inicio = /await\s+waitFor\s*\(/g;
  let coincidencia: RegExpExecArray | null;
  while ((coincidencia = inicio.exec(fuente)) !== null) {
    let i = inicio.lastIndex;
    let profundidad = 1;
    while (i < fuente.length && profundidad > 0) {
      const c = fuente[i];
      if (c === "(") profundidad++;
      else if (c === ")") profundidad--;
      i++;
    }
    // Sin cierre: el fuente esta truncado o el parser se perdio. Se reporta como cuerpo
    // vacio para que la sanidad de abajo lo note en vez de tragarselo.
    salida.push({
      linea: fuente.slice(0, coincidencia.index).split("\n").length,
      cuerpo: profundidad === 0 ? fuente.slice(inicio.lastIndex, i - 1) : "",
    });
  }
  return salida;
}

/* -------------------------------------------------------------------------- */
/* Clasificacion del ancla                                                     */
/* -------------------------------------------------------------------------- */

/** Consulta que devuelve una LISTA del DOM: lo unico de lo que tiene sentido contar. */
const CONSULTA_DE_LISTA = /\b(?:getAllBy|queryAllBy|findAllBy)\w*\s*\(|\bquerySelectorAll\s*\(/;

/** El conteo en si: `toHaveLength(n)` o una comparacion sobre `.length`. */
const CONTEO = /\btoHaveLength\s*\(|\.length\s*\)\s*\.\s*(?:not\.)?to\w+/;

/**
 * Que la espera diga QUE espera: una consulta SINGULAR (que ya nombra el elemento), o una
 * asercion sobre el contenido o el valor. `getAllByRole("row")` NO cuenta: nombra un rol
 * generico y su resultado solo se mide contando.
 */
const CONTENIDO =
  /\b(?:getBy|queryBy|findBy)\w*\s*\(|\btoHaveTextContent\b|\btextContent\b|\btoHaveValue\b|\btoHaveAttribute\b|\btoBeInTheDocument\b|\btoContain\b|\btoEqual\b|\btoMatch\b/;

/** Una espera cuyo sujeto es la LLAMADA y no la pantalla: otra familia, ver la cabecera. */
const MOCK = /\btoHaveBeenCalled\w*\s*\(|\.mock\./;

/**
 * La exclusion explicita del estado de carga. `role="status"` es como el `DataTable` anuncia
 * «Cargando» (`components/shared/DataTable.tsx`), asi que negar su presencia distingue la
 * pantalla asentada de la que todavia esta cargando.
 */
const EXCLUYE_CARGA = /["'`]status["'`]|aria-busy|Cargando/;

/**
 * Los helpers LOCALES del archivo que devuelven una lista del DOM (`filasVisibles()`,
 * `remisionesVisibles()`...).
 *
 * Se resuelven a proposito, y es la diferencia con el detector que el chore midio con
 * sensibilidad cero: alli la indireccion mataba al detector porque habia que saber si un
 * helper DEJA la UI asentada —una propiedad semantica—; aqui solo hay que saber si el
 * helper CONSULTA el DOM, que es textual y esta en el mismo fichero.
 */
function helpersDeLista(fuente: string): string[] {
  const nombres = new Set<string>();
  const declaraciones = [
    /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{]*\{([\s\S]{0,1500}?)\n\}/g,
    /const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*([\s\S]{0,600}?);\n/g,
  ];
  for (const patron of declaraciones) {
    for (const m of fuente.matchAll(patron)) {
      if (CONSULTA_DE_LISTA.test(m[2])) nombres.add(m[1]);
    }
  }
  return [...nombres];
}

/**
 * `true` si la espera esta anclada SOLO a un conteo de elementos del DOM: cuenta, no dice
 * que espera, no habla de un mock y no excluye la carga.
 *
 * `helpers` son los nombres locales que devuelven una lista del DOM; sin ellos, una espera
 * escrita como `expect(filasVisibles()).toHaveLength(2)` no se puede clasificar y el censo
 * la deja pasar (limite declarado y autocomprobado abajo).
 */
function ancladaSoloAUnConteo(cuerpo: string, helpers: readonly string[] = []): boolean {
  if (!CONTEO.test(cuerpo)) return false;
  const porHelper =
    helpers.length > 0 && new RegExp(`\\b(?:${helpers.join("|")})\\s*\\(`).test(cuerpo);
  if (!CONSULTA_DE_LISTA.test(cuerpo) && !porHelper) return false;
  if (MOCK.test(cuerpo)) return false;
  if (CONTENIDO.test(cuerpo)) return false;
  return !EXCLUYE_CARGA.test(cuerpo);
}

/* -------------------------------------------------------------------------- */
/* El censo                                                                    */
/* -------------------------------------------------------------------------- */

interface ArchivoJsdom {
  readonly ruta: string;
  readonly fuente: string;
}

const JSDOM: readonly ArchivoJsdom[] = recorrer(DIR_TESTS)
  .map((archivo) => ({ ruta: relativa(archivo), fuente: readFileSync(archivo, "utf8") }))
  .filter(({ ruta, fuente }) => ruta !== ESTE_GUARDIA && /@vitest-environment\s+jsdom/.test(fuente));

const TODAS_LAS_ESPERAS = JSDOM.flatMap(({ ruta, fuente }) => {
  const helpers = helpersDeLista(fuente);
  return esperasDe(fuente).map((espera) => ({ ruta, helpers, ...espera }));
});

describe("cobertura del censo · mira esperas de verdad", () => {
  it("encuentra los archivos de jsdom y sus esperas", () => {
    // Si estas tres cifras se desplomaran, el censo pasaria por vacio y no por limpio.
    expect(JSDOM.length, "no se encontraron archivos con entorno jsdom").toBeGreaterThan(100);
    expect(TODAS_LAS_ESPERAS.length, "no se extrajo ninguna espera").toBeGreaterThan(300);
    expect(
      TODAS_LAS_ESPERAS.filter(({ cuerpo }) => cuerpo.length === 0),
      "hay esperas cuyo parentesis no se cerro: el parser se perdio",
    ).toEqual([]);
  });

  it("el archivo que tuvo el defecto sigue en el censo", () => {
    // Trazabilidad: si `ControlDescargaTransversal` saliera del censo (renombrado, movido,
    // sin `@vitest-environment jsdom`), este guardia dejaria de vigilar su propio origen.
    expect(JSDOM.map(({ ruta }) => ruta)).toContain(
      "tests/components/descarga/ControlDescargaTransversal.test.tsx",
    );
  });
});

describe("un ancla que el estado transitorio tambien cumple no es un ancla", () => {
  it("ninguna espera se ancla SOLO a un conteo de elementos del DOM", () => {
    const infractores = TODAS_LAS_ESPERAS.filter(({ cuerpo, helpers }) =>
      ancladaSoloAUnConteo(cuerpo, helpers),
    ).map(
      ({ ruta, linea, cuerpo }) =>
        `${ruta}:${linea} — ${cuerpo.replace(/\s+/g, " ").trim().slice(0, 90)}`,
    );
    expect(
      infractores,
      "esperan un NUMERO de elementos sin decir cuales: durante la carga la tabla tambien " +
        "tiene header + la fila `role=\"status\"`, asi que el conteo se cumple a media carga. " +
        "Anade en el MISMO waitFor una asercion de contenido o la ausencia de `role=\"status\"`",
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Autocomprobacion: el detector detecta lo que dice detectar                  */
/* -------------------------------------------------------------------------- */

describe("autocomprobacion · el detector distingue el ancla ambigua de la buena", () => {
  it("marca la espera que causo el flake de verdad", () => {
    // Literal, del historico de `ControlDescargaTransversal.test.tsx` (§6 del chore).
    expect(
      ancladaSoloAUnConteo('() => expect(within(tabla).getAllByRole("row")).toHaveLength(2)'),
    ).toBe(true);
    // Y sus variantes de escritura, que son el mismo defecto.
    expect(
      ancladaSoloAUnConteo('() => expect(within(tabla).getAllByRole("row")).toHaveLength(1 + 1)'),
    ).toBe(true);
    expect(
      ancladaSoloAUnConteo('() => expect(screen.getAllByRole("row").length).toBe(3)'),
    ).toBe(true);
    expect(
      ancladaSoloAUnConteo('() => expect(container.querySelectorAll("tr")).toHaveLength(2)'),
    ).toBe(true);
  });

  it("no marca la espera que SI dice que espera", () => {
    const buenas = [
      // El arreglo real: presencia primero, ausencia despues, sin carga en vuelo.
      '() => { expect(within(tabla).getByText("Beto Repartidor")).toBeInTheDocument(); ' +
        'expect(within(tabla).queryByText("Ana Mensajera")).not.toBeInTheDocument(); }',
      // Un conteo que ADEMAS excluye el estado de carga: deja de ser ambiguo.
      '() => { expect(within(tabla).getAllByRole("row")).toHaveLength(2); ' +
        'expect(within(tabla).queryByRole("status")).not.toBeInTheDocument(); }',
      // Un conteo que ademas nombra el contenido de las filas.
      '() => expect(filasVisibles().map((f) => f.textContent)).toEqual(["Beto"])',
      // Una espera sobre un elemento concreto: ya dice cual.
      '() => expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument()',
      // Otra familia (mock): fuera del alcance declarado de este censo.
      "() => expect(listarOrdenesMock).toHaveBeenCalledTimes(2)",
      "() => expect(accion.mock.calls.length).toBe(METRICAS.length)",
      // Sin conteo ninguno.
      '() => expect(screen.queryByText("Cargando")).not.toBeInTheDocument()',
    ];
    for (const caso of buenas) {
      expect(ancladaSoloAUnConteo(caso), caso).toBe(false);
    }
  });

  it("resuelve el helper local que devuelve una lista del DOM", () => {
    const fuente = [
      "function filasVisibles(): HTMLElement[] {",
      '  return within(tabla()).getAllByRole("row");',
      "}",
      "const nombresDe = () => screen.getAllByRole(\"cell\").map((c) => c.textContent);",
      "function llamadas() {",
      "  return accionMock.mock.calls;",
      "}",
    ].join("\n");
    const helpers = helpersDeLista(fuente);
    expect(helpers).toContain("filasVisibles");
    expect(helpers).toContain("nombresDe");
    // Un helper que no consulta el DOM no entra: contar sus resultados no es contar pantalla.
    expect(helpers).not.toContain("llamadas");

    expect(ancladaSoloAUnConteo("() => expect(filasVisibles()).toHaveLength(2)", helpers)).toBe(
      true,
    );
    expect(ancladaSoloAUnConteo("() => expect(llamadas()).toHaveLength(2)", helpers)).toBe(false);
    // Y el limite, escrito: sin resolver el helper, la misma espera pasa desapercibida.
    expect(ancladaSoloAUnConteo("() => expect(filasVisibles()).toHaveLength(2)")).toBe(false);
  });

  it("el extractor equilibra parentesis y no se corta en el primero", () => {
    const fuente = [
      "await waitFor(() => expect(within(tabla).getAllByRole(\"row\")).toHaveLength(2));",
      "await waitFor(() => {",
      '  expect(screen.getByText("Ana")).toBeInTheDocument();',
      "});",
    ].join("\n");
    const esperas = esperasDe(fuente);
    expect(esperas).toHaveLength(2);
    expect(esperas[0].cuerpo).toContain("toHaveLength(2)");
    expect(esperas[0].linea).toBe(1);
    expect(esperas[1].cuerpo).toContain("toBeInTheDocument");
    expect(esperas[1].linea).toBe(2);
    // Y la clasificacion sobre lo extraido, no sobre el fuente entero.
    expect(esperas.map(({ cuerpo }) => ancladaSoloAUnConteo(cuerpo))).toEqual([true, false]);
  });
});
