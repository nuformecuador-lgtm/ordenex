/**
 * Ficha 314 — preferencia de columnas de una descarga, GENERALIZADA por ÁMBITO (design §4).
 *
 * Es la maquinaria que la feature 194 escribió para el manifiesto, con un parámetro más: la
 * CLAVE de almacenamiento llega de fuera en vez de derivarse de un `ManifiestoFlujo`. Aquí no
 * hay React, ni DOM más allá de `window.localStorage`, ni dominio: se opera sobre la clave de
 * columna (`string`), que es el mínimo común denominador de `XlsxColumn.key` y
 * `DescargaColumna.clave` (design §0/D5). NUNCA lanza (R31).
 *
 * La preferencia vive en el DISPOSITIVO (design §0/D1): no hay tabla de preferencias de
 * usuario en el repo y `specs/146` la declara fuera de alcance. Precedente vivo:
 * `lib/audio/preferencia-sonido.ts`. El precio —la preferencia no viaja entre dispositivos—
 * queda declarado, no escondido.
 *
 * POR QUÉ SE GUARDAN LAS COLUMNAS OCULTAS Y NO LAS VISIBLES
 * ---------------------------------------------------------
 * (Texto heredado de `lib/manifiesto/preferencia-columnas.ts`, feature 194 design §0/D3 y
 * §9/A1, que sigue rigiendo íntegro.) La lectura literal de "guardar la selección" sería una
 * lista de VISIBLES (allowlist). Se descartó: una columna publicada mañana no estaría en
 * ninguna allowlist ya guardada, así que quedaría OCULTA en silencio y para siempre justo en
 * los navegadores de quien más usa la función. Eso contradice la regla 160/R28 ("el conjunto
 * de columnas CRECE").
 *
 * Con la lista de EXCLUSIÓN el default es "aparece": una columna nueva no está en la lista de
 * ocultas de nadie, luego sale visible sin migrar nada. R26 se cumple POR CONSTRUCCIÓN, no por
 * un paso de migración que alguien deba acordarse de escribir. Coste aceptado: el JSON guardado
 * no se lee como "lo que quiero" sino como "lo que no quiero".
 *
 * POR QUÉ EL ORDEN GUARDADO ES PARCIAL Y SE ENMIENDA CON EL CATÁLOGO (design §3)
 * ------------------------------------------------------------------------------
 * La ficha 314 añade un orden explícito, y eso reabre la pregunta de DÓNDE cae una columna
 * publicada después de que el usuario fijara el suyo. La respuesta es que **el orden guardado
 * no sustituye al catálogo: lo enmienda**. Se guarda una lista parcial y toda clave publicada
 * que no figure en ella se INTERCALA en el sitio que el catálogo le da, relativa a lo que el
 * usuario sí ordenó (`ordenEfectivo`, R27/R28).
 *
 * De ahí salen cuatro propiedades, y ninguna es un caso especial del código:
 *
 *  1. `orden` vacío ⇒ el catálogo tal cual. Todas las claves son "nuevas", cada una se inserta
 *     tras su predecesora y sale el catálogo íntegro. Por eso R16 y R30 no tienen rama propia:
 *     son el caso general con la lista vacía. Un `if (sinPreferencia) return publicadas` sería
 *     código que se puede romper sin que se note; aquí no existe como camino aparte.
 *  2. Una columna nueva aparece MARCADA: la visibilidad la decide **solo** `ocultas` (R26).
 *  3. Una columna nueva cae junto a su vecina de catálogo, esté donde esté esa vecina en el
 *     orden del usuario (R27).
 *  4. Dos columnas nuevas consecutivas conservan su orden relativo, porque el ancla se busca
 *     también entre lo ya intercalado en la misma pasada. Sin eso, insertar dos veces en la
 *     posición 0 las dejaría invertidas.
 *
 * NINGUNA función de este módulo conoce el número de columnas vigente (R35): todo se compara
 * clave a clave contra el parámetro `publicadas`.
 */

/** Preferencia ya saneada. Las dos listas son PARCIALES a propósito (design §0/D2). */
export interface PreferenciaColumnas {
  /** Claves que NO salen en el archivo. Ausencia = sale. */
  readonly ocultas: readonly string[];
  /** Orden explícito del usuario. `[]` = "sin orden guardado" ⇒ manda el catálogo. */
  readonly orden: readonly string[];
}

/** Sentido de un movimiento del selector (R18). */
export type DireccionMovimiento = "arriba" | "abajo";

/**
 * Lectura BRUTA del almacenamiento: devuelve el string tal cual quedó guardado.
 *
 * Es el "snapshot" estable del hook (design §5): `useSyncExternalStore` compara por identidad,
 * así que lo que se devuelve debe ser un string (o `null`), nunca un array recién construido.
 *
 * Devuelve `null` si no hay clave de ámbito (R33), si no hay `window` (servidor), si no hay
 * valor, o si el almacenamiento lanza (modo privado, cookies bloqueadas). NUNCA lanza: R31
 * exige que ningún camino degradado impida la descarga.
 */
export function leerCrudo(clave: string | null): string | null {
  if (clave === null) return null;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(clave);
  } catch {
    // Sin almacenamiento se procede como si no hubiera preferencia guardada (R31). No se
    // propaga: el usuario perdería la descarga por un dato de presentación corrupto.
    return null;
  }
}

/** `true` si `valor` tiene forma de objeto plano (no null, no array). */
function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Strings del array, deduplicados y acotados a las claves aún publicadas (R29). */
function clavesUtiles(
  valor: unknown,
  publicadas: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(valor)) return [];
  return [
    ...new Set(
      valor.filter(
        (clave): clave is string =>
          typeof clave === "string" && publicadas.has(clave),
      ),
    ),
  ];
}

/**
 * Sanea el contenido guardado hasta una preferencia utilizable (R29, R30, R31).
 *
 * La degradación es CAMPO A CAMPO: un `orden` corrupto no tira las `ocultas` legibles, y al
 * revés. Lo que no se entiende se sustituye por la lista vacía, que es exactamente "sin
 * preferencia" para ese campo.
 *
 * - `crudo` null, JSON inválido o valor que no es objeto ⇒ las dos listas vacías.
 * - Elementos que no sean string ⇒ descartados; duplicados ⇒ colapsados.
 * - Claves que ya no correspondan a una columna publicada ⇒ descartadas (R29).
 * - Si `ocultas` taparía TODAS las publicadas ⇒ `[]` (R31: nunca un archivo sin columnas).
 *
 * Nunca lanza.
 */
export function sanearPreferencia(
  crudo: string | null,
  publicadas: readonly string[],
): PreferenciaColumnas {
  const vacia: PreferenciaColumnas = { ocultas: [], orden: [] };
  if (crudo === null) return vacia;

  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    // Contenido ilegible: se procede como si no hubiera preferencia (R31).
    return vacia;
  }
  if (!esObjeto(parseado)) return vacia;

  const clavesPublicadas = new Set(publicadas);
  const ocultas = clavesUtiles(parseado.ocultas, clavesPublicadas);
  const orden = clavesUtiles(parseado.orden, clavesPublicadas);

  return {
    // R31: una preferencia que no dejaría ninguna columna equivale a no tener preferencia.
    ocultas: ocultas.length >= clavesPublicadas.size ? [] : ocultas,
    orden,
  };
}

/**
 * TODAS las claves publicadas, en el ORDEN EFECTIVO (design §3): el orden guardado enmendado
 * con el catálogo. Es la base del selector, que muestra marcadas y desmarcadas por igual
 * (R18-R25), y del archivo (R20).
 *
 * Con `orden` guardado vacío devuelve el catálogo íntegro (R16, R30) sin que eso sea una rama
 * aparte: es el caso general con la lista vacía.
 */
export function ordenEfectivo(
  crudo: string | null,
  publicadas: readonly string[],
): string[] {
  const { orden } = sanearPreferencia(crudo, publicadas);
  const resultado = [...orden];

  for (const [indice, clave] of publicadas.entries()) {
    if (resultado.includes(clave)) continue;

    // Ancla: la ÚLTIMA clave del catálogo anterior a ésta que ya esté en el resultado. Se
    // buscan también las intercaladas en esta misma pasada, y eso es lo que conserva el orden
    // relativo entre dos columnas nuevas consecutivas (design §3, propiedad 4).
    let posicionAncla = -1;
    for (let previa = indice - 1; previa >= 0; previa -= 1) {
      const encontrada = resultado.indexOf(publicadas[previa]!);
      if (encontrada >= 0) {
        posicionAncla = encontrada;
        break;
      }
    }

    // Sin ninguna predecesora presente, la columna nueva abre la lista (R28).
    resultado.splice(posicionAncla + 1, 0, clave);
  }

  return resultado;
}

/**
 * Las claves que SALEN en el archivo, en el orden efectivo (R4, R5, R20).
 *
 * Nunca devuelve vacío si `publicadas` no lo está: `sanearPreferencia` ya degrada a `[]` unas
 * `ocultas` que taparían todo.
 */
export function clavesVisiblesEnOrden(
  crudo: string | null,
  publicadas: readonly string[],
): string[] {
  const { ocultas } = sanearPreferencia(crudo, publicadas);
  const efectivo = ordenEfectivo(crudo, publicadas);
  if (ocultas.length === 0) return efectivo;
  return efectivo.filter((clave) => !ocultas.includes(clave));
}

/**
 * Reordena una lista de columnas por sus claves, descartando las que no casen.
 *
 * Genérico sobre `T` y con el accesor por parámetro: aquí es donde se tocan los dos mundos
 * (`XlsxColumn.key` y `DescargaColumna.clave`) sin inventar un tipo común (design §0/D5).
 */
export function columnasEnOrden<T>(
  publicadas: readonly T[],
  claves: readonly string[],
  claveDe: (columna: T) => string,
): T[] {
  const porClave = new Map(
    publicadas.map((columna) => [claveDe(columna), columna]),
  );
  const ordenadas: T[] = [];
  for (const clave of claves) {
    const columna = porClave.get(clave);
    if (columna !== undefined) ordenadas.push(columna);
  }
  return ordenadas;
}

/**
 * Mueve una clave un puesto hacia arriba o hacia abajo dentro de `orden`.
 *
 * Devuelve `null` cuando el movimiento NO se puede hacer —la clave no está, o ya es la primera
 * y sube, o ya es la última y baja (R22, R23)—, de modo que quien llama sepa que no hay nada
 * que guardar. Función pura: no toca el almacenamiento ni la visibilidad de nadie (R24).
 */
export function moverClave(
  orden: readonly string[],
  clave: string,
  direccion: DireccionMovimiento,
): string[] | null {
  const desde = orden.indexOf(clave);
  if (desde < 0) return null;
  const hacia = direccion === "arriba" ? desde - 1 : desde + 1;
  if (hacia < 0 || hacia >= orden.length) return null;

  const movido = [...orden];
  movido[desde] = orden[hacia]!;
  movido[hacia] = clave;
  return movido;
}

/**
 * Persiste la preferencia bajo ESA clave y ninguna otra (R10): dos ámbitos jamás comparten
 * clave, así que cambiar uno no puede alterar el otro.
 *
 * FORMATO (design §2/D4, y es contrato): `orden` vacío se OMITE del JSON, de modo que la
 * escritura resultante es byte por byte la de la feature 194 —`{"ocultas":[…]}`— y una
 * preferencia nueva leída por código viejo sigue valiendo. `ocultas` va siempre primero.
 * `tests/components/ColumnasManifiestoPopover.test.tsx` afirma el literal `{"ocultas":[]}`
 * tras «Restablecer»: ese literal ES el contrato de almacenamiento, no un detalle cosmético.
 *
 * Con `clave` null (tabla sin ámbito, R33) no escribe. Nunca lanza.
 */
export function guardar(
  clave: string | null,
  preferencia: PreferenciaColumnas,
): void {
  if (clave === null) return;
  if (typeof window === "undefined") return;
  const ocultas = [...preferencia.ocultas];
  const orden = [...preferencia.orden];
  const valor =
    orden.length === 0
      ? JSON.stringify({ ocultas })
      : JSON.stringify({ ocultas, orden });
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento (modo privado, cuota llena) la preferencia dura lo que la página.
    // No es motivo para romper el click del usuario ni para impedir la descarga (R31).
  }
}
