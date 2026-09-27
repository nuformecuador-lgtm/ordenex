import { z } from "zod";

/**
 * ⭑ FICHA 429 (T1, R7/R9) — EL FORMATO DE UN SINPE MOVIL DE COSTA RICA, EN UN SOLO SITIO.
 *
 * Modulo PURO: no lee `process.env`, no importa Prisma, no importa React. Lo consumen el borde
 * (zod, en `lib/types/sinpe-bodega.ts` y en `lib/types/zona.ts`), el script de siembra
 * (`scripts/seed-sinpe-inicial.ts`) y los tests.
 *
 * ⚠️ NO ES LA UNICA DEFENSA, Y ESO ES DELIBERADO. La misma regla vive TAMBIEN como `CHECK` en
 * Postgres (`zona_sinpe_numero_check`), porque el borde de la aplicacion no es el unico escritor:
 * los seeds, los `scripts/` y cualquier `UPDATE` corrido a mano contra produccion —via el MCP de
 * Supabase, que es como se escribe en prod en este repo— entran por debajo de zod.
 *
 * EL PRECIO, DECLARADO: hay dos fuentes del mismo formato y pueden divergir. Se cierra con
 * `tests/fixtures/sinpe-casos.ts`, la MISMA tabla de casos corrida contra este validador
 * (`tests/unit/utils/sinpe-cr.test.ts`) y contra el `CHECK` de Postgres
 * (`tests/integration/db/zona-sinpe-migration.test.ts`). Si alguien relaja uno de los dos, el
 * test lo dice.
 */

/**
 * OCHO DIGITOS, EL PRIMERO 6, 7 u 8. Es la numeracion movil de Costa Rica, y SINPE Movil solo
 * funciona sobre una linea movil: un fijo (2…) o un numero de ocho digitos que empiece por otra
 * cosa no puede recibir una transferencia.
 *
 * ⚠️ LA MISMA CADENA vive en el `CHECK` de la migracion `..._zona_sinpe_no_nulo`. Se escribe con
 * la sintaxis de Postgres alli (`~ '^[678][0-9]{7}$'`) y con la de JavaScript aqui; el test de
 * equivalencia es lo que garantiza que dicen lo mismo.
 */
export const SINPE_NUMERO_REGEX = /^[678][0-9]{7}$/;

/** Ancho de `zona.sinpe_nombre` (VARCHAR(60)). El borde recorta ANTES de que Postgres truncue. */
export const SINPE_NOMBRE_MAX_CHARS = 60;

/** El mensaje que ve quien teclea mal el numero. Dice QUE se espera, no solo que esta mal. */
export const MSG_SINPE_NUMERO_INVALIDO =
  "El SINPE tiene que ser un móvil de Costa Rica: 8 dígitos que empiecen por 6, 7 u 8.";

/** El mensaje del titular vacio. */
export const MSG_SINPE_NOMBRE_VACIO = "Escribe a nombre de quién está el SINPE.";

/**
 * R9 — NORMALIZA A LOS OCHO DIGITOS, o devuelve algo que el predicado va a rechazar.
 *
 * Quita separadores (espacios de cualquier clase, guiones, puntos y parentesis) y el prefijo de
 * pais en sus tres formas (`+506`, `00506` y `506` pegado a ocho digitos). NUNCA inventa: si lo
 * que queda no son ocho digitos, se devuelve tal cual y `esSinpeNumeroValido` lo rechaza.
 *
 * ⚠️ EL PREFIJO `506` SIN `+` SOLO SE QUITA CUANDO LO QUE QUEDA SON EXACTAMENTE OCHO DIGITOS.
 * Sin esa condicion, un numero que EMPIEZA por 506 —`50612345`, ocho digitos perfectamente
 * validos— se convertiria en `12345` en silencio. Es justo la clase de correccion amable que
 * termina mandando el dinero a otra cuenta.
 */
export function normalizarSinpeNumero(entrada: string): string {
  const sinSeparadores = entrada.replace(/[\s\-.()]/g, "");
  if (sinSeparadores.startsWith("+506")) return sinSeparadores.slice(4);
  if (sinSeparadores.startsWith("00506") && sinSeparadores.length === 13) {
    return sinSeparadores.slice(5);
  }
  if (sinSeparadores.startsWith("506") && sinSeparadores.length === 11) {
    return sinSeparadores.slice(3);
  }
  return sinSeparadores;
}

/** `true` si `valor` YA es un SINPE valido. No normaliza: se le pasa lo ya normalizado. */
export function esSinpeNumeroValido(valor: string): boolean {
  return SINPE_NUMERO_REGEX.test(valor);
}

/**
 * Normaliza y valida de una pasada. `null` = no hay forma de leerlo como un SINPE de Costa Rica.
 * Lo usan el script de siembra y cualquier camino que no sea zod.
 */
export function sinpeNumeroONull(entrada: string): string | null {
  const normalizado = normalizarSinpeNumero(entrada);
  return esSinpeNumeroValido(normalizado) ? normalizado : null;
}

/**
 * EL ESQUEMA DEL BORDE. Normaliza PRIMERO y valida DESPUES, en ese orden y no al reves: R9 exige
 * que `"8888 1111"` se guarde como `88881111`, no que se rechace por llevar un espacio.
 *
 * El `.refine` va sobre la SALIDA de la transformacion, asi que lo que se guarda es siempre lo
 * que se valido — no hay ventana entre «esto es valido» y «esto es lo que se escribe».
 */
export const sinpeNumeroSchema = z
  .string()
  .transform(normalizarSinpeNumero)
  .refine(esSinpeNumeroValido, { message: MSG_SINPE_NUMERO_INVALIDO });

/**
 * R8 — el titular. `trim()` ANTES del `min(1)`: `"   "` es un titular vacio, no uno de tres
 * caracteres. El `CHECK` de Postgres dice lo mismo con `~ '[^[:space:]]'`.
 *
 * ⚠️ `~ '[^[:space:]]'` Y NO `btrim(...) <> ''`, QUE ES LO QUE PROPONIA EL `design.md` Y SE
 * DESCARTO MIDIENDOLO: `btrim` sin segundo argumento recorta SOLO el espacio (0x20), asi que un
 * titular de un unico TABULADOR pasaba el `CHECK` mientras este esquema lo rechazaba. La clase
 * POSIX `[:space:]` cubre espacio, tabulador, salto de linea, retorno y avance de pagina, que es
 * exactamente lo que recorta el `.trim()` de JavaScript. Las dos fuentes dicen lo mismo, y
 * `tests/integration/db/zona-sinpe-migration.test.ts` lo cobra corriendo los mismos casos contra
 * las dos.
 */
export const sinpeNombreSchema = z
  .string()
  .trim()
  .min(1, { message: MSG_SINPE_NOMBRE_VACIO })
  .max(SINPE_NOMBRE_MAX_CHARS);
