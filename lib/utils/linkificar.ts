// Feature 308 (design §7.1, R33/R34) — trocea un texto en segmentos para pintarlo con enlaces.
//
// PURA a proposito: sin React, sin DOM. La regla de seguridad (que esquemas se enlazan) se
// prueba aqui, sobre datos, y no dentro de un render.
//
// INVARIANTE R34: este helper NUNCA devuelve HTML. Devuelve datos que `TextoConEnlaces` mapea a
// nodos React, que escapan por construccion. El texto lo escribe un TERCERO (el cliente de
// WhatsApp): interpolarlo como HTML seria XSS almacenado con el cliente como atacante.

/**
 * Un tramo del mensaje: texto plano, o el tramo exacto que es una URL enlazable. `valor` es el
 * texto VISIBLE (tal cual lo escribio el cliente) y `href` el destino, que puede llevar un
 * `https://` que el cliente no escribio (caso `www.`).
 */
export type SegmentoTexto =
  | { tipo: "texto"; valor: string }
  | { tipo: "enlace"; valor: string; href: string };

/**
 * Candidatos a URL. Dos formas, y SOLO dos (decision humana 2026-08-27):
 *
 * 1. Con esquema `http`/`https` explicito.
 * 2. Con prefijo `www.` y sin esquema, porque WhatsApp SI lo pinta como enlace y el cliente
 *    escribe `www.ordenex.co` esperando poder pincharlo. Se le antepone `https://` en el
 *    `href`; el texto VISIBLE sigue siendo el que escribio el cliente.
 *
 * Un dominio suelto SIN esquema ni `www.` (`ordenex.co/guia`) NO es candidato A PROPOSITO: la
 * regla que lo enlazaria tambien convierte "llego a las 5.30pm" en un enlace a `5.30pm`. El
 * humano rechazo esa opcion explicitamente; los falsos positivos pesan mas que el caso raro.
 *
 * Anclarse al esquema es ademas la PRIMERA barrera de R34: `javascript:`, `data:` y `file:` no
 * llegan siquiera a ser candidatos. La segunda es `hrefSeguro`, abajo.
 */
const CANDIDATO_URL = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/**
 * Puntuacion que casi siempre pertenece a la frase, no a la URL: "mira https://x.co/a." no debe
 * enlazar el punto final. Se recorta desde el final mientras haya de esta lista.
 */
const PUNTUACION_FINAL = new Set([".", ",", ";", ":", "!", "?", "'", '"', "»"]);

/** Cierres cuyo recorte depende de si tienen pareja DENTRO del propio candidato. */
const CIERRES_EMPAREJABLES: ReadonlyMap<string, string> = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);

/** `true` si ese cierre esta DESBALANCEADO en el candidato (mas cierres que aperturas). */
function cierreSobrante(candidato: string, cierre: string): boolean {
  const apertura = CIERRES_EMPAREJABLES.get(cierre) as string;
  const cierres = candidato.split(cierre).length - 1;
  const aperturas = candidato.split(apertura).length - 1;
  return cierres > aperturas;
}

/**
 * Recorta la puntuacion que pertenece a la frase.
 *
 * El parentesis de cierre NO se recorta a ciegas: la Wikipedia esta llena de URL como
 * `.../Costa_Rica_(desambiguacion)`, y comerse ese `)` deja el enlace ROTO. Solo se recorta
 * cuando queda desbalanceado dentro del candidato, que es justo el caso de "mira (https://x.co)".
 */
function recortarPuntuacionFinal(candidato: string): string {
  let fin = candidato.length;
  while (fin > 0) {
    const ultimo = candidato[fin - 1] as string;
    if (PUNTUACION_FINAL.has(ultimo)) {
      fin -= 1;
      continue;
    }
    if (CIERRES_EMPAREJABLES.has(ultimo) && cierreSobrante(candidato.slice(0, fin), ultimo)) {
      fin -= 1;
      continue;
    }
    return candidato.slice(0, fin);
  }
  return "";
}

/**
 * `href` del candidato, o `null` si no es un enlace seguro.
 *
 * Es la barrera de R34 y se aplica IGUAL a las dos formas de candidato: al `www.` se le
 * antepone `https://` y el resultado pasa por el MISMO chequeo de protocolo. Ampliar el
 * enlazado no relaja la seguridad.
 */
function hrefSeguro(candidato: string): string | null {
  const conEsquema = candidato.toLowerCase().startsWith("www.")
    ? `https://${candidato}`
    : candidato;
  try {
    const url = new URL(conEsquema);
    return url.protocol === "http:" || url.protocol === "https:" ? conEsquema : null;
  } catch {
    return null;
  }
}

/**
 * Devuelve los segmentos del texto: los tramos de URL como `enlace` y TODO lo demas como
 * `texto` (R33). Un texto sin URL devuelve un unico segmento; un texto vacio, ninguno.
 */
export function linkificar(texto: string): SegmentoTexto[] {
  const segmentos: SegmentoTexto[] = [];
  let cursor = 0;

  const empujarTexto = (valor: string): void => {
    if (valor !== "") segmentos.push({ tipo: "texto", valor });
  };

  for (const coincidencia of texto.matchAll(CANDIDATO_URL)) {
    const bruto = coincidencia[0];
    const inicio = coincidencia.index;
    const candidato = recortarPuntuacionFinal(bruto);
    const href = candidato === "" ? null : hrefSeguro(candidato);
    if (href === null) continue;

    empujarTexto(texto.slice(cursor, inicio));
    // `valor` es lo que ESCRIBIO el cliente (sin el esquema añadido); `href` es adonde va.
    segmentos.push({ tipo: "enlace", valor: candidato, href });
    cursor = inicio + candidato.length;
  }

  empujarTexto(texto.slice(cursor));
  return segmentos;
}
