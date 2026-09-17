import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { leerDocumentoAyuda, leerResumenesAyuda } from "@/lib/ayuda/catalogo";
import {
  agruparDocumentos,
  documentosQuePuedeLeer,
  puedeLeerDocumento,
} from "@/lib/ayuda/documento";
import type { ResumenDocumento } from "@/lib/ayuda/documento";
import { renderizarMarkdown } from "@/lib/ayuda/markdown";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

/**
 * ⭑ FICHA 433 — `/ayuda/<slug>`: un documento, renderizado desde su `.md`.
 *
 * ⚠️ EL ACOTAMIENTO POR ROL SE DECIDE AQUÍ, EN EL SERVIDOR, Y ES UN `notFound()`. Que el
 * índice no pinte el enlace es presentación; la defensa real es ésta. Sin ella, un mensajero
 * que escriba `/ayuda/oficina/wallet-caja` leería cómo funciona la caja de la empresa —el
 * índice no se lo ofrece, pero la URL es adivinable—. Es el mismo patrón que el `notFound()`
 * por rol de cualquier ruta del portal (`/mi-bodega`, `/mi-wallet`, `/historico/acciones`).
 *
 * ⭑ FICHA 435 — LA PREGUNTA ES `puedeLeerDocumento`, EL PREDICADO DE LECTURA, no el estricto
 * de «de quién es esta pantalla». La oficina (maestro y admin) lee el catálogo entero porque
 * es quien atiende las dudas de los mensajeros y las tiendas; los otros tres roles no se
 * mueven ni un documento. El «?» del encabezado sigue con el estricto: ver `documento.ts`.
 *
 * ⚠️ EL FRONTMATTER `fuentes` NO SE MUESTRA. Es el campo que hace auditable cada afirmación
 * del documento (regla del README de la carpeta), y su público somos nosotros: a quien está
 * atascado en la calle no le sirve una lista de archivos `.tsx`. Se lee, se usa para revisar,
 * no se pinta. Lo vigila `ayuda-render-sin-filtracion.guardia.test.ts`.
 */
export default async function AyudaDocumentoPage({
  params,
}: Readonly<{ params: Promise<{ slug: string[] }> }>) {
  const actor = await resolveActorFromSession();
  const { slug } = await params;
  const doc = await leerDocumentoAyuda(slug.join("/"));

  // Un documento inexistente y uno que esta persona no puede leer dan la MISMA respuesta, a
  // propósito: si el 404 y el 403 se distinguieran, la diferencia diría qué documentos
  // existen a quien no debería saberlo.
  if (doc === null || !puedeLeerDocumento(doc, actor?.rol ?? null)) {
    notFound();
  }

  const legibles = documentosQuePuedeLeer(await leerResumenesAyuda(), actor?.rol ?? null);
  const siguiente = documentoSiguiente(legibles, doc.slug);

  return (
    <article className="min-w-0">
      {/* PROSA 65–75ch (`DESIGN.md`). Es un módulo de LECTURA: sin el tope, en un monitor
          ancho la línea llega a 140 caracteres y el ojo pierde el renglón al saltar. El tope
          va aquí y no en cada bloque para que tablas y bloques de código, que sí pueden ser
          más anchos, lo hereden como máximo y scrolleen dentro. */}
      <div className="max-w-[72ch]">{renderizarMarkdown(doc.cuerpo)}</div>

      <footer className="mt-10 flex flex-col gap-4 border-t border-border pt-4">
        {doc.actualizado === "" ? null : (
          <p className="text-sm text-muted-foreground">
            Actualizado el{" "}
            {/* `<time>` con el valor ISO: la fecha legible es para la persona y el atributo
                para quien la lea con una herramienta. */}
            <time dateTime={doc.actualizado}>{fechaLegible(doc.actualizado)}</time>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* La vuelta al índice sólo hace falta en el teléfono: a partir de `lg` el índice
              está a la izquierda y nunca se fue. */}
          <Link
            href="/ayuda"
            className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring lg:hidden"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Volver al índice
          </Link>

          {siguiente === null ? null : (
            <Link
              href={`/ayuda/${siguiente.slug}`}
              className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
            >
              Siguiente: {siguiente.titulo}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          )}
        </div>
      </footer>
    </article>
  );
}

/**
 * El «siguiente» es el que viene DESPUÉS EN EL ÍNDICE de esta persona — mismo orden que la
 * columna de la izquierda, así que el enlace lleva a donde el ojo ya esperaba. Se calcula
 * sobre los documentos que esa persona PUEDE LEER: nunca ofrece uno que le daría 404.
 * `null` en el último, que no tiene siguiente.
 */
function documentoSiguiente(
  legibles: readonly ResumenDocumento[],
  slug: string,
): ResumenDocumento | null {
  const enOrden = agruparDocumentos(legibles).flatMap((grupo) => grupo.documentos);
  const i = enOrden.findIndex((doc) => doc.slug === slug);
  if (i === -1) return null;
  return enOrden[i + 1] ?? null;
}

/**
 * `2026-09-15` -> `15/09/2026`.
 *
 * Se parte la cadena a mano en vez de usar `new Date(iso)`: ese constructor interpreta una
 * fecha sin hora como UTC y luego la imprime en la zona local, así que en Costa Rica (-06:00)
 * un `2026-09-15` se pinta como el 14. Un documento «actualizado» un día antes de lo que dice
 * el archivo es justo el tipo de mentira silenciosa que este módulo no puede permitirse.
 * Un valor con otra forma se devuelve tal cual: se dice lo que hay, no se inventa.
 */
function fechaLegible(iso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) return iso;
  const [, anio, mes, dia] = partes;
  return `${dia}/${mes}/${anio}`;
}
