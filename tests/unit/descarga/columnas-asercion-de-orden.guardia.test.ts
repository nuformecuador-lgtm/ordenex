// GUARDIA hermana de `cobertura-tablas.guardia`: allí se vigila que ninguna TABLA nazca sin
// decidir si se descarga; aquí, que ninguna LISTA DE COLUMNAS descargables nazca sin una
// aserción de orden que la nombre.
//
// El riesgo que cierra. El 2026-08-07 se cerró la deuda de la 189: de 35 constantes
// `COLUMNAS_DESCARGA_*` del árbol, 14 no tenían aserción de orden y una (`_CUENTAS_POR_PAGAR`)
// no aparecía ni una vez en `tests/`. Se saldó a mano, 35 de 35. Nada impedía que la nº 36
// naciera igual de desnuda, y el listado que un usuario descarga —qué columnas salen y en qué
// orden— es contrato: una permuta silenciosa rompe la hoja de quien la reenvía sin que nada
// se ponga rojo.
//
// `censo-tablas.ts` NO sirve para esto y no se reutiliza: censa instancias de `<DataTable>`,
// una decisión por TABLA. Una tabla puede tener varias listas de columnas (el cierre del día
// declara seis) y una lista puede alimentar dos tablas (los dos ledgers del pago por
// mensajero). Son dos ejes distintos.
//
// ── EL CONTRATO QUE SE EXIGE ──────────────────────────────────────────────────────────────
// Para cada `export const COLUMNAS_DESCARGA_<X>` del árbol de UI tiene que existir, en algún
// archivo de `tests/`, un `expect(COLUMNAS_DESCARGA_<X>.map(...)).toEqual(...)`. Tres
// exigencias, y cada una está por un motivo medido:
//
//  1. La aserción NOMBRA la constante. No vale afirmar sobre un parámetro de `describe.each`
//     (`expect(columnas.map(...))`), aunque la permuta ponga rojo el caso: nadie que busque
//     «¿quién cubre esta constante?» lo encuentra, y el siguiente escribe un caso duplicado.
//     Es exactamente lo que pasó con `_MIS_PAGOS` y `_DESGLOSE_MENSAJERO`, cuyas aserciones
//     se sacaron del `describe.each` por eso mismo (ver la cabecera de
//     `wallet-mensajero-descarga-columnas.test.ts`).
//  2. Se afirma sobre `.map(...)`, es decir sobre la PROYECCIÓN de la lista, que es donde vive
//     el orden. `expect(X).toBeDefined()` no dice nada del contrato.
//  3. El lado ESPERADO no se mira. Puede ser un literal o una constante del propio test
//     (`toEqual([...CLAVES_CONTRATO])`, como hace la analítica): un detector que exigiera
//     literal daría por descubiertas constantes bien cubiertas —`_ANALITICA_OPERATIVA` es el
//     caso— y empujaría a duplicar el listado para contentarlo.
//
// ── POR QUÉ LA GUARDIA SE AUTOCOMPRUEBA ───────────────────────────────────────────────────
// Un detector roto pasa VERDE: encuentra cero constantes, no encuentra cero incumplimientos y
// se queda de adorno para siempre. Este repo ya se lo comió una vez. Por eso el primer caso de
// este archivo no comprueba el árbol, comprueba el DETECTOR, con dos canarios que fallan con
// mensaje explícito:
//
//  - uno en `app/` y otro en `components/`: el recorrido tiene que abarcar los DOS árboles. Un
//    detector que solo mire `app/` cuenta 34 y se deja `_PAGOS_REGISTRADOS`, que vive en
//    `components/shared/liquidacion/`;
//  - un negativo sintético: la forma `describe.each` NO cuenta como cobertura. Sin esto, un
//    detector que aceptara cualquier `.map(` seguiría verde mientras deja de exigir lo que
//    dice exigir.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Feature 207 — el lector de `expect(…)` vive ahora en su propio módulo, con su propio test.
// Lo que cambió al mudarse: quita los comentarios ANTES de leer, para que un `expect(...)`
// COMENTADO deje de contar como aserción. La cobertura de las 38 constantes del árbol NO se
// movió por ello (medida archivo a archivo, antes y después).
import { tieneAsercionDeOrden } from "./aserciones-de-orden";

const RAIZ = path.resolve(__dirname, "../../..");

/** Los dos árboles de UI. Mirar solo `app/` deja fuera `components/shared/liquidacion/`. */
const ARBOLES_UI = ["app", "components"] as const;

/** Dónde viven las aserciones. */
const ARBOL_TESTS = "tests";

/**
 * Suelo del censo, no total exacto.
 *
 * 35 son las constantes vivas el 2026-08-07, todas con aserción. Se afirma como MÍNIMO y no
 * como igualdad para que añadir la nº 36 —con su test, que es lo que esta guardia exige— no
 * obligue además a tocar este número: la friccion no compra nada, porque el caso de cobertura
 * ya falla si nace sin test. Lo que sí compra el suelo es detectar que el DETECTOR se rompió:
 * si mañana alguien mueve las constantes fuera de `app/`+`components/` o cambia el prefijo, el
 * censo se desploma y esto lo dice, en vez de pasar verde con cero constantes.
 */
const CONSTANTES_CONOCIDAS = 35;

/** Canario en `app/`: el listado principal de órdenes, cubierto desde la feature 170. */
const CANARIO_APP = "COLUMNAS_DESCARGA_ORDENES";

/** Canario en `components/`: el único fuera de `app/`. Es el que delata un recorrido corto. */
const CANARIO_COMPONENTS = "COLUMNAS_DESCARGA_PAGOS_REGISTRADOS";

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

function archivosDe(...arboles: string[]): string[] {
  return arboles.flatMap((arbol) => listarFuentes(path.join(RAIZ, arbol))).sort();
}

export interface ConstanteDeColumnas {
  nombre: string;
  ruta: string;
}

/**
 * Toda `export const COLUMNAS_DESCARGA_*` del árbol de UI.
 *
 * Se censa por el PREFIJO del nombre y no por el tipo `DescargaColumna[]`: la anotación de
 * tipo es opcional en TypeScript, así que quitarla bastaría para desaparecer del censo. El
 * precio de censar por nombre es que ese prefijo queda reservado a listas de columnas — y eso
 * es exactamente lo que se quiere que sea.
 */
export function constantesDeColumnas(archivos: string[]): ConstanteDeColumnas[] {
  const declaracion = /\bexport\s+const\s+(COLUMNAS_DESCARGA_[A-Z0-9_]+)\b/g;
  return archivos
    .flatMap((archivo) => {
      const fuente = readFileSync(archivo, "utf8");
      return [...fuente.matchAll(declaracion)].map((m) => ({
        nombre: m[1],
        ruta: rutaRelativa(archivo),
      }));
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Archivos de `tests/` que cubren cada constante, por nombre. */
function coberturaPorConstante(
  constantes: ConstanteDeColumnas[],
  archivosDeTest: string[],
): Map<string, string[]> {
  const cobertura = new Map<string, string[]>();
  for (const archivo of archivosDeTest) {
    // La propia guardia queda fuera del barrido: si se cubriera a sí misma, sus canarios
    // dejarían de demostrar nada.
    if (rutaRelativa(archivo) === rutaRelativa(__filename)) continue;
    const fuente = readFileSync(archivo, "utf8");
    for (const { nombre } of constantes) {
      if (!fuente.includes(nombre)) continue; // atajo barato antes de parsear
      if (!tieneAsercionDeOrden(fuente, nombre)) continue;
      cobertura.set(nombre, [...(cobertura.get(nombre) ?? []), rutaRelativa(archivo)]);
    }
  }
  return cobertura;
}

describe("guardia: toda lista de columnas descargables tiene aserción de orden", () => {
  it("AUTOCOMPROBACIÓN: el detector encuentra los casos conocidos y rechaza el que no cuenta", () => {
    const constantes = constantesDeColumnas(archivosDe(...ARBOLES_UI));
    const porNombre = new Map(constantes.map((c) => [c.nombre, c]));

    // (a) Censo: los dos canarios existen y están donde se dice. El de `components/` es el que
    // se pierde un recorrido que se pare en `app/`.
    expect(
      porNombre.get(CANARIO_APP)?.ruta,
      `DETECTOR ROTO: no se censó ${CANARIO_APP}, que existe en app/. El censo de constantes no está leyendo el árbol.`,
    ).toBe("app/(app)/ordenes/_components/ordenes-descarga-columnas.ts");
    expect(
      porNombre.get(CANARIO_COMPONENTS)?.ruta,
      `DETECTOR ROTO: no se censó ${CANARIO_COMPONENTS}. Vive en components/, no en app/: el recorrido se está parando en app/ y deja fuera esa constante.`,
    ).toBe("components/shared/liquidacion/pagos-registrados-descarga-columnas.ts");

    // (b) Cobertura: los dos canarios tienen aserción de orden HOY. Si el parseo de
    // `expect(...)` se rompe, esto cae en vez de dar todo por cubierto.
    const cobertura = coberturaPorConstante(constantes, archivosDe(ARBOL_TESTS));
    for (const canario of [CANARIO_APP, CANARIO_COMPONENTS]) {
      expect(
        cobertura.get(canario) ?? [],
        `DETECTOR ROTO: no se encuentra la aserción de orden de ${canario}, que SÍ existe en tests/unit/descarga/. Si el detector no ve ésta, no ve ninguna y esta guardia no vigila nada.`,
      ).not.toEqual([]);
    }

    // (c) Negativo: afirmar sobre un parámetro (la forma `describe.each`) NO cuenta. Sin esto,
    // un detector que aceptara cualquier `.map(` pasaría verde habiendo dejado de exigir que la
    // aserción nombre la constante.
    //
    // La mención en comentario del final es la SEGUNDA cara del mismo negativo, y desde la
    // feature 207 la sostiene sobre todo `aserciones-de-orden.test.ts`: el lector quita los
    // comentarios antes de leer, así que un `expect(...)` comentado ya no cuenta como
    // aserción. Se deja aquí porque es la forma en que se ve en un archivo real.
    const comoDescribeEach = `
      describe.each(LEDGERS)("$nombre", ({ columnas }) => {
        it("orden", () => {
          expect(columnas.map((c) => c.clave)).toEqual(["fecha", "tipo"]);
        });
      });
      // ${CANARIO_APP} se menciona aquí solo de pasada, en un comentario.
    `;
    expect(
      tieneAsercionDeOrden(comoDescribeEach, CANARIO_APP),
      `DETECTOR DEMASIADO LAXO: dio por cubierta a ${CANARIO_APP} con una aserción sobre un parámetro y una mención en un comentario.`,
    ).toBe(false);

    // Y el positivo equivalente, para que (c) no pase por no encontrar nunca nada.
    const nombrandola = `
      expect(${CANARIO_APP}.map((c) => c.clave)).toEqual([...CLAVES_CONTRATO]);
    `;
    expect(
      tieneAsercionDeOrden(nombrandola, CANARIO_APP),
      "DETECTOR ROTO: no reconoce la forma canónica de la aserción de orden.",
    ).toBe(true);
  });

  it("ninguna constante COLUMNAS_DESCARGA_* del árbol se queda sin aserción de orden", () => {
    const constantes = constantesDeColumnas(archivosDe(...ARBOLES_UI));

    expect(
      constantes.length,
      `el censo bajó de ${CONSTANTES_CONOCIDAS} constantes a ${constantes.length}: o se borraron descargas, o el detector dejó de verlas. Si fue un borrado deliberado, baja CONSTANTES_CONOCIDAS y di por qué.`,
    ).toBeGreaterThanOrEqual(CONSTANTES_CONOCIDAS);

    const cobertura = coberturaPorConstante(constantes, archivosDe(ARBOL_TESTS));
    const desnudas = constantes
      .filter(({ nombre }) => (cobertura.get(nombre) ?? []).length === 0)
      .map(({ nombre, ruta }) => `${nombre} (${ruta})`);

    expect(
      desnudas,
      "estas listas de columnas descargables no tienen ninguna aserción de orden que las NOMBRE. " +
        "El orden de las columnas de un archivo es contrato: escribe " +
        "`expect(LA_CONSTANTE.map((c) => c.clave)).toEqual([...])` en tests/unit/descarga/.",
    ).toEqual([]);
  });

  it("una constante no se da por cubierta por otra que empiece igual", () => {
    // `_GESTIONES_ENTREGADAS` y `_GESTIONES_ENTREGADAS_V2` conviviendo: sin el `\b` final del
    // nombre, la aserción de la primera taparía a la segunda para siempre.
    const fuente = `expect(COLUMNAS_DESCARGA_DIA_ENTREGADAS_V2.map((c) => c.clave)).toEqual([]);`;
    expect(tieneAsercionDeOrden(fuente, "COLUMNAS_DESCARGA_DIA_ENTREGADAS_V2")).toBe(true);
    expect(tieneAsercionDeOrden(fuente, "COLUMNAS_DESCARGA_DIA_ENTREGADAS")).toBe(false);
  });
});
