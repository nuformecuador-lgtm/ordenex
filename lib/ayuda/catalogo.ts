import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { DocumentoAyuda, ResumenDocumento } from "@/lib/ayuda/documento";
import { rutasDeDocumento } from "@/lib/ayuda/documento";
import { partirFrontmatter } from "@/lib/ayuda/frontmatter";

/**
 * ⭑ FICHA 433 — CÓMO LLEGAN LOS `.md` A LA PANTALLA. Ésta es la decisión, y su porqué.
 *
 * **Se leen del disco con `fs`, en el servidor, desde los propios archivos del repositorio.**
 * No hay paso de copia, ni generación de un módulo `.ts` con el texto dentro, ni una tabla
 * intermedia: `docs/ayuda/**` es la única fuente y lo que se pinta sale de ESE archivo.
 *
 * POR QUÉ NO LAS OTRAS DOS VÍAS QUE SE CONSIDERARON:
 *
 * - **Generar un módulo en tiempo de build** (un script que vuelca los 31 documentos a
 *   `lib/ayuda/generado.ts`) es exactamente lo que la ficha prohíbe: el texto pasa a vivir en
 *   DOS sitios. Si el artefacto se commitea, se desincroniza en cuanto alguien edite el `.md`
 *   y no corra el script —y nada se pondría rojo—; si no se commitea, cada `pnpm test` y cada
 *   arranque en frío depende de un paso previo que hoy no existe en `package.json`.
 * - **`import.meta.glob`** es de Vite. Next no lo tiene, ni en Webpack ni en Turbopack, así
 *   que no es una opción de este repo. Los imports crudos (`archivo.md?raw`) sí existen en
 *   Turbopack pero no están garantizados en el camino de build de producción: sería atar el
 *   módulo de ayuda a un detalle del bundler.
 *
 * ⚠️ **Y POR QUÉ FUNCIONA EN VERCEL**, que es donde la vía de `fs` se rompe normalmente. En
 * producción el sistema de archivos NO es el del repositorio: sólo se sube lo que el trazado
 * de dependencias de `next build` ve. Y no ve `docs/ayuda/**`, porque esta ruta se construye
 * en tiempo de ejecución (`path.join`) y no hay ningún `import` que la delate. Por eso
 * `next.config.ts` declara `outputFileTracingIncludes` para las rutas del módulo: es el
 * mecanismo documentado para exactamente este caso. Sin esa línea, esto funciona en local y
 * devuelve 404 en producción — el fallo mudo clásico de leer archivos en serverless.
 */

/**
 * La carpeta, resuelta desde `process.cwd()`. En `next build`/`next start` y en Vercel el cwd
 * es la raíz del proyecto; en vitest también (el runner arranca donde está la config).
 */
const DIRECTORIO_AYUDA = path.join(process.cwd(), "docs", "ayuda");

/**
 * El README **NO es un documento de usuario**: son las reglas de la carpeta para quien la
 * escribe («Cómo se escribe acá», «Deuda conocida»). No declara `pantalla` y su público somos
 * nosotros, así que se queda fuera del módulo. Es la ÚNICA exclusión, y la guardia la nombra
 * para que nadie la lea como un documento huérfano.
 */
export const ARCHIVO_EXCLUIDO = "README.md";

/**
 * Lectura memorizada. Los `.md` son inmutables dentro de un despliegue, así que leer 31
 * archivos una vez por proceso y no una vez por página es gratis y correcto. En desarrollo el
 * servidor se reinicia al tocarlos, así que tampoco se queda con texto viejo a la vista.
 */
let enCurso: Promise<DocumentoAyuda[]> | null = null;

/**
 * Todos los documentos de `docs/ayuda/**`, SIN acotar por rol. El acotamiento es de quien llama.
 *
 * ⚠️ SE MEMORIZA EL ÉXITO, NUNCA EL FALLO. Lo que se guarda es una PROMESA, y una promesa
 * rechazada guardada aquí sería permanente: el primer tropiezo de lectura —un descriptor que no
 * se pudo abrir, un archivo a medio subir— convertiría un fallo de un instante en uno que dura
 * lo que viva el proceso, y con él todas las páginas del portal (este catálogo lo lee el layout
 * de TODAS). Por eso el rechazo limpia la caché: el siguiente que pase lo reintenta.
 *
 * El rechazo se RELANZA, no se traga: quien llama decide qué hacer. El layout del portal lo
 * degrada a «sin ayuda» y sigue en pie; el módulo de ayuda sí tiene que enterarse.
 */
export function leerCatalogoAyuda(): Promise<DocumentoAyuda[]> {
  enCurso ??= leerTodos().catch((error: unknown) => {
    enCurso = null;
    throw error;
  });
  return enCurso;
}

/** Sólo los metadatos: es lo que baja al cliente (el índice y el mapa del botón «?»). */
export async function leerResumenesAyuda(): Promise<ResumenDocumento[]> {
  const docs = await leerCatalogoAyuda();
  // Se descarta el cuerpo EXPLÍCITAMENTE y no por olvido: son ~90 KB de Markdown que no
  // tienen ninguna razón para cruzar a un teléfono en la calle sólo para pintar una lista.
  // Los campos se copian uno a uno en vez de un `...resto`: así, si mañana el documento gana
  // un campo pesado, no se cuela aquí solo, hay que escribirlo.
  return docs.map((doc) => ({
    slug: doc.slug,
    grupo: doc.grupo,
    titulo: doc.titulo,
    modulo: doc.modulo,
    rutas: doc.rutas,
    roles: doc.roles,
    actualizado: doc.actualizado,
  }));
}

/** Un documento por su slug, o `null`. No decide acceso: eso lo hace la página, con el rol. */
export async function leerDocumentoAyuda(slug: string): Promise<DocumentoAyuda | null> {
  const docs = await leerCatalogoAyuda();
  return docs.find((doc) => doc.slug === slug) ?? null;
}

async function leerTodos(): Promise<DocumentoAyuda[]> {
  const relativos = await listarMarkdown(DIRECTORIO_AYUDA, "");
  const docs = await Promise.all(relativos.map(leerUno));
  return docs.sort((a, b) => a.slug.localeCompare(b.slug, "es"));
}

/** Las rutas relativas (con `/`, nunca `\`) de los `.md`, saltándose el README. */
async function listarMarkdown(base: string, prefijo: string): Promise<string[]> {
  const entradas = await readdir(path.join(base, prefijo), { withFileTypes: true });
  const encontrados: string[] = [];

  for (const entrada of entradas) {
    // El separador es SIEMPRE `/`, también en Windows: de esta cadena sale el slug, y el slug
    // es la URL. Un `\` aquí produciría `/ayuda/mensajero\reparto` en local y `/` en Vercel.
    const relativo = prefijo === "" ? entrada.name : `${prefijo}/${entrada.name}`;
    if (entrada.isDirectory()) {
      encontrados.push(...(await listarMarkdown(base, relativo)));
      continue;
    }
    if (!entrada.name.endsWith(".md")) continue;
    if (relativo === ARCHIVO_EXCLUIDO) continue;
    encontrados.push(relativo);
  }

  return encontrados;
}

async function leerUno(relativo: string): Promise<DocumentoAyuda> {
  const texto = await readFile(path.join(DIRECTORIO_AYUDA, relativo), "utf8");
  const { datos, cuerpo } = partirFrontmatter(texto);

  const slug = relativo.replace(/\.md$/, "");
  const grupo = slug.includes("/") ? slug.slice(0, slug.indexOf("/")) : "";

  return {
    slug,
    grupo,
    // Un documento sin `titulo` cae al slug en vez de pintar «undefined». No se inventa: el
    // slug es un dato real del archivo, y la guardia exige el `titulo` de todas formas.
    titulo: datos.titulo ?? slug,
    modulo: datos.modulo ?? "",
    rutas: rutasDeDocumento(datos),
    roles: datos.roles ?? [],
    actualizado: datos.actualizado ?? "",
    cuerpo,
  };
}
