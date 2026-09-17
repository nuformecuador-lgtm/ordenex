import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

/**
 * ⭑ FICHA 433 · R19 — GUARDIA DE LA LÍNEA QUE SEPARA «FUNCIONA» DE «404 EN PRODUCCIÓN».
 *
 * QUÉ VIGILA Y POR QUÉ NINGÚN OTRO TEST LO VERÍA
 * ---------------------------------------------
 * El módulo de ayuda lee `docs/ayuda/**` del disco con `fs`, en el servidor. En local eso
 * funciona siempre: el sistema de archivos ES el repositorio. En Vercel no: a la función sólo
 * sube lo que el trazado de dependencias de `next build` ve siguiendo los `import`, y aquí no
 * hay ningún `import` que seguir —la ruta se arma con `path.join(process.cwd(), …)` en tiempo
 * de ejecución—. Lo único que mete los `.md` en el paquete es el `outputFileTracingIncludes`
 * de `next.config.ts`.
 *
 * La revisión de la ficha midió el agujero: **borrar ese bloque entero dejaba las 230 guardias
 * en verde**. El typecheck pasa, el build pasa, la suite pasa, y el rojo aparece cuando un
 * usuario abre la ayuda en producción y le sale un 404. Es el fallo mudo clásico de leer
 * archivos en serverless, y la familia de fallos que más cara sale en este repo.
 *
 * ⚠️ ESTA GUARDIA NO COMPRUEBA QUE EL PATRÓN SEA VÁLIDO PARA `picomatch` —eso se verificó a
 * mano ejecutando el propio matcher del Next instalado (16.2.10)—. Comprueba las tres cosas que
 * PUEDEN CAMBIAR sin que nadie se entere:
 *   1. que la declaración siga existiendo;
 *   2. que siga cubriendo TODAS las páginas (`/**`) y no sólo las dos del módulo — el trazado
 *      es por página y un layout NO hereda el de sus hijos, así que acotarlo dejaría sin `.md`
 *      al layout del portal, que es quien calcula el mapa del «?» en las 29 pantallas;
 *   3. que el patrón apunte a LA MISMA carpeta que el código lee de verdad, con `**` para que
 *      entren los subdirectorios (los 31 documentos viven en subcarpetas: sin `**` viajarían
 *      cero archivos y el síntoma sería idéntico a no declarar nada).
 */

const RAIZ = path.resolve(__dirname, "../../..");
const FUENTE_CATALOGO = "lib/ayuda/catalogo.ts";

/** Los `.md` reales de un árbol, en rutas relativas con `/`. */
function markdownDe(dir: string, prefijo = ""): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(path.join(dir, prefijo), { withFileTypes: true })) {
    const relativo = prefijo === "" ? entrada.name : `${prefijo}/${entrada.name}`;
    if (entrada.isDirectory()) encontrados.push(...markdownDe(dir, relativo));
    else if (entrada.name.endsWith(".md")) encontrados.push(relativo);
  }
  return encontrados;
}

/**
 * La carpeta que el CÓDIGO lee, sacada del propio `catalogo.ts` y no escrita a mano aquí.
 * Es lo que ata las dos mitades: si alguien mueve los documentos y actualiza el módulo pero
 * no la configuración, esta guardia se pone roja en vez de dejar un 404 en producción.
 */
function carpetaQueLeeElCodigo(): string[] {
  const codigo = readFileSync(path.join(RAIZ, FUENTE_CATALOGO), "utf8");
  const join = /path\.join\(\s*process\.cwd\(\)\s*,([^)]*)\)/.exec(codigo);
  expect(join, `${FUENTE_CATALOGO} ya no arma la ruta con path.join(process.cwd(), …)`).not.toBeNull();
  return join![1]
    .split(",")
    .map((tramo) => tramo.trim().replace(/^["']|["']$/g, ""))
    .filter((tramo) => tramo !== "");
}

const INCLUDES = nextConfig.outputFileTracingIncludes;
const TRAMOS = carpetaQueLeeElCodigo();
const DIR_DOCS = path.join(RAIZ, ...TRAMOS);
/** `docs/ayuda`, con `/`: la forma en la que aparece en un patrón de `next.config.ts`. */
const RUTA_DOCS = TRAMOS.join("/");

describe("433/R19 — los .md de la ayuda viajan al servidor de producción", () => {
  it("`next.config.ts` declara `outputFileTracingIncludes`", () => {
    // Sin esto, el módulo de ayuda funciona en local y devuelve 404 en Vercel. Es el único
    // mecanismo que mete archivos no importados en el paquete de la función.
    expect(
      INCLUDES,
      "sin outputFileTracingIncludes los .md no llegan a la función de Vercel",
    ).toBeDefined();
    expect(Object.keys(INCLUDES ?? {}).length).toBeGreaterThan(0);
  });

  it("⭑ la entrada cubre TODAS las páginas, no sólo las dos rutas del módulo", () => {
    // El trazado es POR PÁGINA y un layout no hereda el de sus hijos: el layout del portal
    // lee el catálogo en las 29 pantallas para calcular el mapa del «?».
    expect(
      Object.keys(INCLUDES ?? {}),
      "acotar la clave deja sin .md al layout del portal: el «?» desaparecería en producción",
    ).toContain("/**");
  });

  it("⭑ y el patrón apunta a la carpeta que el código lee DE VERDAD, con sus subcarpetas", () => {
    const patrones = [...new Set(Object.values(INCLUDES ?? {}).flat())];
    const delaAyuda = patrones.filter((patron) => patron.includes(RUTA_DOCS));

    expect(
      delaAyuda,
      `ningún patrón cubre ${RUTA_DOCS}, que es lo que lee ${FUENTE_CATALOGO}`,
    ).not.toEqual([]);
    for (const patron of delaAyuda) {
      // `**` no es decoración: los 31 documentos viven en subcarpetas (`oficina/`,
      // `mensajero/`…). Un `docs/ayuda/*.md` subiría CERO archivos y el síntoma sería el
      // mismo que no declarar nada.
      expect(patron, `${patron} no entra en las subcarpetas`).toMatch(/\*\*/);
      expect(patron, `${patron} no selecciona los .md`).toMatch(/\.md$/);
    }
  });

  it("y hay documentos de verdad que subir (si no, todo lo anterior sería vacuo)", () => {
    // El ancla anti-vacuidad: si `docs/ayuda` desapareciera, las aserciones de arriba podrían
    // seguir en verde sobre una carpeta que ya no existe.
    expect(existsSync(DIR_DOCS), `${RUTA_DOCS} no existe`).toBe(true);
    const md = markdownDe(DIR_DOCS);
    expect(md.length).toBeGreaterThanOrEqual(30);
    // Y la mayoría están en subcarpetas, que es lo que hace obligatorio el `**`.
    expect(md.filter((relativo) => relativo.includes("/")).length).toBeGreaterThanOrEqual(30);
  });

  it("nada del despliegue excluye la carpeta de documentos", () => {
    // `.vercelignore` no existe hoy. Si alguien lo añade mañana con un `docs/` dentro, los
    // archivos no llegan ni con el trazado bien declarado — y el síntoma vuelve a ser un 404
    // que sólo se ve en producción.
    const ignore = path.join(RAIZ, ".vercelignore");
    if (!existsSync(ignore)) {
      expect(existsSync(ignore)).toBe(false);
      return;
    }
    const lineas = readFileSync(ignore, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    for (const linea of lineas) {
      expect(RUTA_DOCS.startsWith(linea.replace(/^\/+|\/+$/g, "")), linea).toBe(false);
    }
  });
});
