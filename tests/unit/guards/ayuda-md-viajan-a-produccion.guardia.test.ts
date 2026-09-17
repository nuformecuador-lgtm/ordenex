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

/**
 * ⭑ FICHA 436 · R31 — Y LA RUTA DEL ASISTENTE LEE **ESE** CATÁLOGO.
 *
 * ⚠️ POR QUÉ HACÍA FALTA OTRO CASO, Y DÓNDE VIVE EL RIESGO DE VERDAD. Lo de arriba mide la FORMA
 * del `next.config.ts`: que la declaración existe, que la clave es `/**` y que el patrón apunta a
 * la carpeta que lee `catalogo.ts`. Lo que **nadie medía** es la otra punta: que la ruta que manda
 * la documentación al proveedor la saque de ahí.
 *
 * Si mañana alguien le pone al asistente una fuente distinta —un módulo generado, una copia en
 * `public/`, una tabla— la guardia de arriba SIGUE VERDE, el typecheck pasa, la suite pasa, y el
 * asistente responde «no lo sé» a todo en producción mientras en local funciona. Es exactamente la
 * familia de fallo mudo que este archivo vino a cerrar, un año después y en otro sitio.
 *
 * ⚠️ AQUÍ NO SE TOCA `next.config.ts`, y es deliberado (hallazgo H1 del spec). El diseño aprobado
 * pedía «añadir la ruta del asistente a `outputFileTracingIncludes`»: **no hay nada que añadir**,
 * porque la clave declarada es `/**` —todas las páginas y rutas— y ACOTARLA pondría roja la
 * aserción de más arriba. Lo que faltaba era esto.
 */

const RUTA_ASISTENTE = "app/api/asistente/route.ts";

/** Las vías por las que un archivo podría leer documentación que NO sea el catálogo. */
export function fuentesDeDocumentacionEn(codigo: string): string[] {
  const sospechas: string[] = [];
  const sinComentarios = codigo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");

  if (/readFile|readFileSync|readdir|readdirSync/.test(sinComentarios)) sospechas.push("lee fs");
  if (/process\.cwd\s*\(/.test(sinComentarios)) sospechas.push("arma una ruta de disco");
  if (/docs\/ayuda/.test(sinComentarios)) sospechas.push("nombra docs/ayuda a mano");
  if (/\.md["'`]/.test(sinComentarios)) sospechas.push("nombra un .md");
  return sospechas;
}

describe("436/R31 — la ruta del asistente lee la documentación del catálogo, y de nada más", () => {
  it("CONTROL DE NO-VACUIDAD: la ruta del asistente existe y tiene código", () => {
    // Si el archivo se renombrara, todo lo de abajo quedaría verde por vacío.
    expect(existsSync(path.join(RAIZ, RUTA_ASISTENTE))).toBe(true);
    expect(readFileSync(path.join(RAIZ, RUTA_ASISTENTE), "utf8").length).toBeGreaterThan(500);
  });

  it("⭑ su ÚNICA vía de documentación es `lib/ayuda/catalogo.ts`", () => {
    const codigo = readFileSync(path.join(RAIZ, RUTA_ASISTENTE), "utf8");
    // La importa por su nombre...
    expect(codigo).toMatch(/import\s*\{\s*leerCatalogoAyuda\s*\}\s*from\s*["']@\/lib\/ayuda\/catalogo["']/);
    // ...y se la PASA al servicio: importarla y no usarla sería un composition root que no inyecta.
    expect(codigo).toMatch(/leerCatalogo:\s*leerCatalogoAyuda/);
    // Y no hay ninguna otra: ni `fs`, ni `process.cwd()`, ni un `.md` nombrado a mano.
    expect(fuentesDeDocumentacionEn(codigo)).toEqual([]);
  });

  it("⭑ y tampoco la hay en el resto del módulo del asistente", () => {
    const delModulo = [
      "lib/services/AsistenteService.ts",
      "lib/asistente/contexto.ts",
      "lib/asistente/instrucciones.ts",
      "lib/asistente/citas.ts",
      "lib/asistente/protocolo.ts",
      "lib/clients/anthropic-asistente.ts",
    ];
    const ofensas = delModulo.flatMap((archivo) =>
      fuentesDeDocumentacionEn(readFileSync(path.join(RAIZ, archivo), "utf8")).map(
        (s) => `${archivo}: ${s}`,
      ),
    );
    expect(ofensas).toEqual([]);
  });

  it("⭑ CANARIO: una fuente distinta metida a mano se detecta", () => {
    // Sin esto, «no hay sospechas» podría significar «el analizador no mira nada».
    expect(
      fuentesDeDocumentacionEn(`const t = readFileSync(path.join(process.cwd(), "docs/ayuda/x.md"));`),
    ).toEqual(["lee fs", "arma una ruta de disco", "nombra docs/ayuda a mano", "nombra un .md"]);
    expect(fuentesDeDocumentacionEn(`import { DOCS } from "@/lib/ayuda/generado";`)).toEqual([]);
  });

  it("⭑ la clave `/**` cubre la ruta del asistente sin nombrarla (y por eso no se toca el config)", () => {
    // `/**` son TODAS las páginas y rutas: `app/api/asistente` entra sin escribir nada. Este caso
    // deja constancia de la conclusión medida —no hay nada que añadir— para que la próxima ficha
    // no vuelva a proponer acotar la clave.
    const claves = Object.keys(INCLUDES ?? {});
    expect(claves).toContain("/**");
    expect(claves, "acotar la clave dejaría sin .md a la ruta del asistente").toEqual(["/**"]);
    expect((INCLUDES ?? {})["/**"]).toEqual([`./${RUTA_DOCS}/**/*.md`]);
  });
});
