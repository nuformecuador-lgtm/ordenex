import type { RolValue } from "@prisma/client";

import type { DocumentoAyuda } from "@/lib/ayuda/documento";
import { documentosQuePuedeLeer } from "@/lib/ayuda/documento";
import type { DocumentoContexto } from "@/lib/interfaces/external/IAsistenteProvider";

/**
 * ⭑ FICHA 436 — EL ACOTAMIENTO POR ROL. **Es la razón de ser de la ficha**, y cabe en una línea.
 *
 * ⚠️ POR QUÉ IMPORTA MÁS QUE EL COSTE. Sin esto, un mensajero le pregunta al asistente «¿cómo
 * funciona la caja?» y el asistente se lo explica con la ayuda de Wallet delante — y entonces el
 * acotamiento de la 433, que se tomó el trabajo de poner un `notFound()` en el servidor, queda
 * decorativo: puerta cerrada en `/ayuda`, ventana abierta en el chat. No es una optimización de
 * tokens; es la misma regla de acceso, aplicada en la segunda puerta.
 *
 * ⚠️ EL PREDICADO SE IMPORTA, NO SE REIMPLEMENTA. Es el hallazgo m3 de la revisión de la 433:
 * una guardia que reimplementaba la regla «no se enteraría» de un cambio del predicado. Aquí el
 * mismo error sería peor —el módulo de ayuda cerraría la puerta y el asistente la dejaría
 * abierta— así que la única fuente es `documentosQuePuedeLeer`, la misma que decide si
 * `/ayuda/<slug>` se abre o da 404.
 *
 * ⚠️ Y ES EL DE **LECTURA**, NO EL ESTRICTO (Q1, decidido el 2026-09-17). Si la oficina puede
 * LEER un documento, tiene que poder preguntar sobre él: lo contrario sería una pantalla que
 * enseña algo y un asistente que finge no conocerlo. El empate de `/ordenes` que obliga al «?»
 * a usar el estricto AQUÍ NO EXISTE: el asistente recibe un CONJUNTO y nunca tiene que elegir
 * uno. Para los tres roles que no son de oficina, los dos predicados devuelven lo mismo.
 */
export function contextoPara(
  docs: readonly DocumentoAyuda[],
  rol: RolValue | null,
): DocumentoContexto[] {
  return (
    documentosQuePuedeLeer(docs, rol)
      // R1 — el contexto se construye con los CUERPOS del catálogo y con ninguna otra fuente de
      // texto. R2 — el cuerpo ya viene sin frontmatter porque el catálogo lo partió al leer el
      // archivo: aquí no hay que quitar nada, y por eso mismo la guardia mide el resultado en vez
      // de confiar en que alguien se acuerde.
      .map((doc) => ({ slug: doc.slug, titulo: doc.titulo, cuerpo: doc.cuerpo }))
      // ORDEN ESTABLE POR SLUG, y no es estético: el prefijo de documentación es lo que se cachea
      // (D9/R6). Un orden que dependa del sistema de archivos produce un prefijo distinto en cada
      // arranque, la caché deja de acertar y se paga el corpus entero en cada consulta — sin que
      // nada se ponga rojo. El catálogo ya ordena; esto lo hace explícito y propio.
      .sort((a, b) => a.slug.localeCompare(b.slug, "es"))
  );
}

/**
 * El documento de PARTIDA (R27): cuál de los que esta persona YA PUEDE LEER explica la pantalla
 * desde la que abrió el asistente.
 *
 * ⚠️ `rutaActual` la manda el cliente, así que NO PUEDE ABRIR NINGUNA PUERTA. Se cruza contra el
 * contexto ya acotado: si la ruta no casa con ninguno de SUS documentos, devuelve `null` y no
 * pasa nada. Un `rutaActual` mentiroso no añade ni un documento al conjunto — el conjunto ya
 * estaba decidido antes de mirarla.
 */
export function documentoDePartida(
  docs: readonly DocumentoAyuda[],
  contexto: readonly DocumentoContexto[],
  rutaActual: string | undefined,
): string | null {
  if (rutaActual === undefined || rutaActual === "") return null;
  const entregados = new Set(contexto.map((doc) => doc.slug));
  const candidatos = docs
    .filter((doc) => entregados.has(doc.slug) && doc.rutas.includes(rutaActual))
    .map((doc) => doc.slug)
    .sort((a, b) => a.localeCompare(b, "es"));
  return candidatos[0] ?? null;
}
