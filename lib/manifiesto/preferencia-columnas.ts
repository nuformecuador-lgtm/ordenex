/**
 * Feature 194 — preferencia de columnas del manifiesto, por FLUJO (design §3).
 *
 * Vive en el DISPOSITIVO (design §0/D2): no hay tabla de preferencias de usuario en el repo y
 * `specs/146` la declara fuera de alcance. Precedente vivo: `lib/audio/preferencia-sonido.ts`.
 * El precio -- la preferencia no viaja entre dispositivos -- queda declarado, no escondido.
 *
 * POR QUE SE GUARDAN LAS COLUMNAS OCULTAS Y NO LAS VISIBLES (design §0/D3 y §9/A1)
 * --------------------------------------------------------------------------------
 * La lectura literal de "guardar la seleccion" seria una lista de VISIBLES (allowlist). Se
 * descarto: una columna publicada manana no estaria en ninguna allowlist ya guardada, asi que
 * quedaria OCULTA en silencio y para siempre justo en los navegadores de quien mas usa la
 * funcion. Eso contradice la regla 160/R28 ("el manifiesto refleja los datos de la orden y ese
 * conjunto CRECE").
 *
 * Con la lista de EXCLUSION el default es "aparece": una columna nueva no esta en la lista de
 * ocultas de nadie, luego sale visible sin migrar nada. R22 se cumple POR CONSTRUCCION, no por
 * un paso de migracion que alguien deba acordarse de escribir. Coste aceptado: el JSON guardado
 * no se lee como "lo que quiero" sino como "lo que no quiero".
 *
 * El modulo NO importa `COLUMNAS_MANIFIESTO`: recibe las publicadas por parametro. Asi no se
 * acopla al numero de columnas vigente y el conjunto sigue siendo ABIERTO (R23).
 */
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";
import type { XlsxColumn } from "@/lib/utils/xlsx-template";

/** Prefijo de la clave de almacenamiento. `ordenex:` sigue el precedente de `CLAVE_SONIDO`. */
const PREFIJO_CLAVE = "ordenex:manifiesto-columnas:";

/** Clave propia de cada flujo (R14). Un flujo NUNCA lee ni escribe la clave de otro (R16). */
export function claveColumnas(flujo: ManifiestoFlujo): string {
  return `${PREFIJO_CLAVE}${flujo}`;
}

/**
 * Lectura BRUTA del almacenamiento: devuelve el string tal cual quedo guardado.
 *
 * Es el "snapshot" estable del hook (design §4): `useSyncExternalStore` compara por identidad,
 * asi que lo que se devuelve debe ser un string (o `null`), nunca un array recien construido.
 *
 * Devuelve `null` si no hay `window` (servidor), si no hay valor, o si el almacenamiento lanza
 * (modo privado, cookies bloqueadas). NUNCA lanza: R21 exige que ningun camino degradado
 * impida la descarga.
 */
export function leerCrudoColumnas(flujo: ManifiestoFlujo): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(claveColumnas(flujo));
  } catch {
    // Sin almacenamiento se procede como si no hubiera preferencia guardada (R21). No se
    // propaga: el usuario perderia la descarga por un dato de presentacion corrupto.
    return null;
  }
}

/** `true` si `valor` tiene forma de objeto plano (no null, no array). */
function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Sanea el contenido guardado hasta una lista de claves ocultas utilizable (R19, R20, R21).
 *
 * - `crudo` null, JSON invalido, no objeto, `ocultas` ausente o no array -> `[]`.
 * - Elementos que no sean string -> descartados.
 * - Claves que ya no correspondan a una columna publicada -> descartadas (R19).
 * - Si el resultado ocultaria TODAS las publicadas -> `[]` (R20, R13).
 *
 * No compara cardinalidades contra ningun numero fijo: compara pertenencia clave a clave contra
 * `publicadas`, que es un parametro. Por eso funciona igual con 9 o con 13 columnas (R23).
 * Nunca lanza.
 */
export function sanearOcultas(
  crudo: string | null,
  publicadas: readonly XlsxColumn[],
): string[] {
  if (crudo === null) return [];

  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    // Contenido ilegible: se procede como si no hubiera preferencia (R21).
    return [];
  }

  if (!esObjeto(parseado)) return [];
  const { ocultas } = parseado;
  if (!Array.isArray(ocultas)) return [];

  const clavesPublicadas = new Set(publicadas.map((columna) => columna.key));
  // Se deduplica: un duplicado guardado no debe contar dos veces al medir si queda algo visible.
  const saneadas = [
    ...new Set(
      ocultas.filter(
        (clave): clave is string =>
          typeof clave === "string" && clavesPublicadas.has(clave),
      ),
    ),
  ];

  // R20: una preferencia que no dejaria ninguna columna equivale a no tener preferencia.
  if (saneadas.length >= clavesPublicadas.size) return [];

  return saneadas;
}

/**
 * Columnas que deben salir en el archivo, en el ORDEN de `publicadas` (R8): el filtro va sobre
 * la lista publicada, nunca sobre la lista guardada, asi que el orden no depende de en que
 * secuencia el usuario marco las casillas.
 *
 * Con `crudo` null devuelve `publicadas` entero (R17, R22).
 */
export function columnasVisibles(
  crudo: string | null,
  publicadas: readonly XlsxColumn[],
): XlsxColumn[] {
  const ocultas = sanearOcultas(crudo, publicadas);
  if (ocultas.length === 0) return [...publicadas];
  return publicadas.filter((columna) => !ocultas.includes(columna.key));
}

/**
 * Persiste la eleccion del flujo (R14). Escribe SOLO la clave de ese flujo, de modo que cambiar
 * un flujo no puede alterar la preferencia de otro (R16).
 *
 * `ocultas` vacio = todas visibles: es lo que escribe "Restablecer" (R6).
 */
export function guardarOcultas(
  flujo: ManifiestoFlujo,
  ocultas: readonly string[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      claveColumnas(flujo),
      JSON.stringify({ ocultas: [...ocultas] }),
    );
  } catch {
    // Sin almacenamiento (modo privado, cuota llena) la preferencia dura lo que la pagina.
    // No es motivo para romper el click del usuario ni para impedir la descarga (R21).
  }
}
