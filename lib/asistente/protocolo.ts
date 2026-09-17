import type { AppErrorCode } from "@/lib/errors/codes";

/**
 * ⭑ FICHA 436 (design §2.3) — EL PROTOCOLO DEL STREAM. Módulo PURO: tipos y serialización.
 *
 * ⚠️ POR QUÉ NDJSON Y NO `text/event-stream`. SSE está pensado para `EventSource`, que **sólo
 * hace GET** y no admite cuerpo — es decir, ni la conversación ni las imágenes. Habría que usar
 * `fetch` igualmente y quedarse con el encuadre de SSE sin ninguna de sus ventajas. NDJSON se lee
 * con `response.body.getReader()` y se parte por `\n`, y un test lo reconstruye sin ninguna
 * dependencia — que es justo lo que hace falta para medir R19 de verdad.
 *
 * ⚠️ LOS RECHAZOS PREVIOS NO VIAJAN POR AQUÍ. Sin sesión, rol no admitido, cuerpo inválido, tope
 * alcanzado o falta de credencial se responden como respuesta normal con el `AppErrorShape` de la
 * feature 10, con su código HTTP. Esta unión es para lo que pasa DESPUÉS de haber empezado a
 * emitir, cuando el status HTTP ya está enviado y no se puede cambiar.
 */

/** Un documento del contexto, tal y como se le anuncia al cliente. SIN el cuerpo. */
export interface DocumentoAnunciado {
  slug: string;
  titulo: string;
  /** `/ayuda/<slug>`, ya resuelto: el cliente no tiene que saber cómo se arma una URL de ayuda. */
  href: string;
}

export type EventoAsistente =
  /**
   * ⭑ El PRIMER evento, siempre. Lleva los documentos del contexto porque el cliente los
   * necesita para validar las citas (R24) y para pintar «Leer la ayuda de esta pantalla» (R27).
   *
   * NO FILTRA NADA: es exactamente lo que esa persona ya puede leer en `/ayuda`, el mismo
   * criterio con el que la 433 baja el mapa del «?» al cliente.
   */
  | { tipo: "inicio"; documentos: DocumentoAnunciado[]; partida: string | null }
  | { tipo: "texto"; texto: string }
  | { tipo: "fin" }
  /** Un fallo con el stream ya empezado. `message` es propio; jamás el error del proveedor (R21). */
  | { tipo: "error"; code: AppErrorCode; message: string };

/** El `content-type` del cuerpo. Una línea JSON por evento, terminada en `\n`. */
export const CONTENT_TYPE_NDJSON = "application/x-ndjson";

/** Un evento, serializado como su línea. Incluye el `\n`: sin él, dos eventos serían uno. */
export function serializarEvento(evento: EventoAsistente): string {
  return `${JSON.stringify(evento)}\n`;
}

/**
 * Parte un cuerpo NDJSON —completo o A MEDIAS— en los eventos que ya están enteros, y devuelve
 * también lo que sobró.
 *
 * El `resto` no es un detalle de implementación: un trozo de red puede cortar una línea por la
 * mitad, y un lector que asuma líneas completas pierde ese evento en silencio. Devolverlo obliga
 * a quien lee a decidir qué hace con él.
 */
export function partirNdjson(texto: string): { eventos: EventoAsistente[]; resto: string } {
  const lineas = texto.split("\n");
  const resto = lineas.pop() ?? "";
  const eventos: EventoAsistente[] = [];
  for (const linea of lineas) {
    if (linea.trim() === "") continue;
    eventos.push(JSON.parse(linea) as EventoAsistente);
  }
  return { eventos, resto };
}
