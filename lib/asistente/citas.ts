import type { DocumentoContexto } from "@/lib/interfaces/external/IAsistenteProvider";
import { MARCADOR_CITA_ABRE, MARCADOR_CITA_CIERRA } from "@/lib/asistente/instrucciones";

/**
 * ⭑ FICHA 436 — LAS CITAS. Módulo PURO: marcador -> enlace, **validando contra el conjunto
 * ENTREGADO en esa consulta** (R23, R24, R25).
 *
 * ⚠️ POR QUÉ SE VALIDA Y NO SE PINTA LO QUE DIGA EL MODELO. Un modelo puede nombrar un documento
 * que no tiene delante: porque lo recuerda de otra conversación, porque lo dedujo del nombre de
 * una pantalla, o porque se lo inventó entero. Pintar ese enlace sería la peor forma de mentir
 * que tiene esta pieza: un enlace con aspecto de prueba que lleva a un 404 —o, si el slug existe
 * pero no es de esa persona, a la puerta que la 433 dejó cerrada—. Una cita que no está en el
 * conjunto entregado SE DESCARTA; no se «arregla», no se avisa, no se pinta.
 */

/** Una cita ya validada, lista para pintar. */
export interface CitaAsistente {
  slug: string;
  titulo: string;
  /** R23 — el enlace al documento completo. */
  href: string;
}

/**
 * La URL del documento. Es `/ayuda/<slug>` porque el slug ES la ruta desde la 433: no hay tabla
 * de slugs que pueda divergir del árbol de archivos.
 */
export function hrefDeDocumento(slug: string): string {
  return `/ayuda/${slug}`;
}

/** Todos los marcadores del texto, en orden de aparición y con repeticiones. */
function slugsSenalados(respuesta: string): string[] {
  const encontrados: string[] = [];
  let desde = 0;
  for (;;) {
    const abre = respuesta.indexOf(MARCADOR_CITA_ABRE, desde);
    if (abre === -1) return encontrados;
    const cierra = respuesta.indexOf(MARCADOR_CITA_CIERRA, abre + MARCADOR_CITA_ABRE.length);
    if (cierra === -1) return encontrados;
    encontrados.push(respuesta.slice(abre + MARCADOR_CITA_ABRE.length, cierra).trim());
    desde = cierra + MARCADOR_CITA_CIERRA.length;
  }
}

/**
 * ⭑ Las citas de una respuesta, **acotadas al conjunto que esa persona recibió**.
 *
 * - R23: un documento señalado que SÍ estaba -> enlace a `/ayuda/<slug>`.
 * - R24: uno que NO estaba —de otro portal, o inexistente— -> se descarta, sin enlace y sin ruido.
 * - R25: ninguna señal -> lista vacía, y el panel no pinta ninguna sección de fuentes.
 *
 * Se deduplica conservando el orden de la primera aparición: un modelo que cite tres veces el
 * mismo documento no debe producir tres enlaces iguales.
 */
export function citasDe(
  respuesta: string,
  entregados: readonly DocumentoContexto[],
): CitaAsistente[] {
  const porSlug = new Map(entregados.map((doc) => [doc.slug, doc]));
  const vistos = new Set<string>();
  const citas: CitaAsistente[] = [];

  for (const slug of slugsSenalados(respuesta)) {
    if (vistos.has(slug)) continue;
    const doc = porSlug.get(slug);
    // ⚠️ AQUÍ ESTÁ R24, Y ES UNA LÍNEA. Si esto se convirtiera en `?? { slug, titulo: slug }`,
    // el asistente pintaría enlaces a documentos que esa persona no puede abrir.
    if (doc === undefined) continue;
    vistos.add(slug);
    citas.push({ slug: doc.slug, titulo: doc.titulo, href: hrefDeDocumento(doc.slug) });
  }

  return citas;
}

/**
 * Los signos que en español NO llevan espacio delante. Si una cita se quita y detrás viene uno de
 * éstos, el hueco se cierra entero.
 */
const PUNTUACION_PEGADA = new Set([".", ",", ";", ":", "!", "?", ")", "]", "»", "…"]);

/** El remate común: ningún espacio colgando al final de una línea ni del texto. */
function rematar(texto: string): string {
  return texto.replace(/[ \t]+\n/g, "\n").trimEnd();
}

/**
 * El texto sin los marcadores, que es lo que se le enseña a la persona.
 *
 * Los marcadores son un protocolo entre el modelo y nosotros, no prosa. Se quitan TODOS —también
 * los que no se pudieron validar—: dejar visible un `[[doc:oficina/wallet-caja]]` descartado le
 * estaría diciendo a un mensajero el nombre exacto del documento que no puede leer.
 *
 * ⚠️ **LA CITA SE VA CON SU HUECO** (revisión de la ficha, `m1`). Quitar sólo los caracteres del
 * marcador deja la puntuación rota, y no de una forma sino de dos, medidas:
 *
 *     "…del lado de la oficina [[doc:x]]."   ->  "…del lado de la oficina ."
 *     "Mirá [[doc:x]], y después confirmá."  ->  "Mirá , y después confirmá."
 *
 * La segunda es peor que un espacio sobrante: la frase pierde su referente y queda agramatical. Y
 * se lee en CADA respuesta citada, que son casi todas. Por eso, en la costura de cada marcador se
 * comen los espacios de sus dos lados y se devuelve UN espacio sólo si la frase sigue y lo que
 * sigue no es un signo pegado.
 *
 * ⚠️ Se toca SÓLO la costura, y no el texto entero: un «colapsar dobles espacios» global se
 * comería la sangría de una lista o de un bloque de código que el modelo haya escrito.
 */
export function textoSinMarcadores(respuesta: string): string {
  let salida = "";
  let desde = 0;
  for (;;) {
    const abre = respuesta.indexOf(MARCADOR_CITA_ABRE, desde);
    if (abre === -1) return rematar(salida + respuesta.slice(desde));
    const cierra = respuesta.indexOf(MARCADOR_CITA_CIERRA, abre + MARCADOR_CITA_ABRE.length);
    if (cierra === -1) return rematar(salida + respuesta.slice(desde));

    const izquierda = salida + respuesta.slice(desde, abre);
    const sinCola = izquierda.replace(/[ \t]+$/, "");

    const trasElCierre = cierra + MARCADOR_CITA_CIERRA.length;
    let siguiente = trasElCierre;
    while (respuesta[siguiente] === " " || respuesta[siguiente] === "\t") siguiente += 1;

    const habiaHueco = sinCola.length < izquierda.length || siguiente > trasElCierre;
    const loQueSigue = respuesta[siguiente];
    const separa =
      habiaHueco &&
      sinCola !== "" &&
      loQueSigue !== undefined &&
      loQueSigue !== "\n" &&
      !PUNTUACION_PEGADA.has(loQueSigue);

    salida = separa ? `${sinCola} ` : sinCola;
    desde = siguiente;
  }
}
