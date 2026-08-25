// Feature 276 — Parser puro de la columna `canton_distrito` de la plantilla de
// carga masiva de ordenes (R12-R21).
//
// Traduce `nombreCanton (Distrito)` al par canton/distrito, para que `resolveGeo`
// (lib/services/geo-resolucion.ts) siga recibiendo exactamente los mismos nombres
// que antes salian de la columna unica `direccion_destinatario` (plantilla v2,
// feature 142) y, antes de ella, de las columnas separadas.
//
// PROCEDENCIA (design.md §3): el cuerpo NO es nuevo. Es `separarCantonDistrito`,
// que vivia como privado de `lib/utils/direccion-destinatario.ts` (feature 142),
// promovido a API publica con sus cinco ramas de error INTACTAS —mismo orden de
// comprobacion, mismos textos— mas la guarda de campo vacio que en la v2 estaba
// un nivel mas arriba, en `parseDireccionDestinatario`. El modulo v2 se elimino:
// con las tres columnas separadas ya no habia nada que desempaquetar.
//
// Restriccion de diseno (design.md §3): modulo importable desde el navegador.
// Sin Prisma, sin `next/*`, sin Supabase, sin `process.env`, sin I/O.

/**
 * Formato canonico que se cita en todos los mensajes de error accionables (R15-R19).
 * El distrito entre parentesis es OPCIONAL: omitirlo equivale a repetir el canton (R14).
 */
export const FORMATO_CANTON_DISTRITO = "Cantón (Distrito)";

/** Partes derivadas del valor, tal cual aparecen en el archivo (solo trim, R13). */
export interface CantonDistritoPartes {
  canton: string;
  distrito: string;
}

/** R20: todo caso invalido se expresa como resultado, nunca como excepcion. */
export type ParseCantonDistritoResult =
  | { ok: true; partes: CantonDistritoPartes }
  | { ok: false; mensaje: string };

function conFormato(causa: string): { ok: false; mensaje: string } {
  return { ok: false, mensaje: `${causa}. Formato esperado: ${FORMATO_CANTON_DISTRITO}` };
}

/**
 * R12-R21: separa `canton_distrito` en el canton (antes del primer `(`) y el
 * distrito (entre ese `(` y el primer `)` posterior). Puro y determinista; nunca
 * lanza para una entrada `string`.
 *
 * R13: solo se recortan los extremos. NO se normalizan acentos ni mayusculas:
 * esa normalizacion vive en `resolveGeo`, que compara contra el catalogo con
 * `lib/utils/normalize`. Duplicarla aqui daria dos dueños a la misma regla.
 */
export function parseCantonDistrito(valor: string): ParseCantonDistritoResult {
  // R19: ausente / vacio / solo espacios.
  const segmento = valor.trim();
  if (segmento === "") {
    return conFormato("canton_distrito es obligatorio");
  }

  // R14 (decision del humano, 2026-08-24): un valor SIN parentesis no es un error.
  // Es la forma corta de los cantones cuyo distrito se llama igual que el canton
  // (`Cartago` == `Cartago (Cartago)`), y en Costa Rica son la mayoria de las
  // cabeceras. Se asume distrito = canton.
  //
  // El atajo es seguro porque NO inventa una resolucion: `resolveGeo` busca despues
  // ese distrito DENTRO de ese canton y, si no existe, la fila muere con el mensaje
  // de siempre ("distrito no encontrado en el canton"). Lo unico que se ahorra es
  // rechazar por formato algo que el catalogo sabe responder.
  const abre = segmento.indexOf("(");
  if (abre < 0) return { ok: true, partes: { canton: segmento, distrito: segmento } };

  const cierra = segmento.indexOf(")", abre);
  if (cierra < 0) return conFormato("el parentesis del distrito no esta cerrado"); // R15

  const canton = segmento.slice(0, abre).trim();
  const distritoCrudo = segmento.slice(abre + 1, cierra).trim();
  // R16: parentesis presentes pero vacios (`Cartago ()`) dicen lo MISMO que no
  // ponerlos, asi que reciben el mismo trato en vez de un error de formato.
  const distrito = distritoCrudo === "" ? canton : distritoCrudo;

  const sobrante = segmento.slice(cierra + 1).trim();
  if (sobrante !== "") return conFormato("hay texto inesperado despues del distrito"); // R17

  if (canton === "") return conFormato("el canton esta vacio"); // R18

  return { ok: true, partes: { canton, distrito } };
}
