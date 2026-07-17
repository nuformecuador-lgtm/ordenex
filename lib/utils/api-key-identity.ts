// Feature 81 [D4] (design §6): derivacion de la identidad del usuario sintetico que
// respalda una API key. Helpers PUROS (sin DB, sin logging).
//
// Estos valores se DERIVAN del identificador y NUNCA se aceptan desde el borde: si el
// cliente pudiera suministrar el email, un maestro podria apuntar una key a un email
// real de otra persona. Por eso `ApiKeyService` no reusa `UsuarioService.crear()`.

/** Namespace reservado del email sintetico. `.invalid` es TLD reservado (RFC 2606). */
const EMAIL_DOMAIN = "apikey.invalid";
const EMAIL_LOCAL_PREFIX = "apikey";

/** Namespace reservado de la cedula sintetica. */
const CEDULA_PREFIX = "APIKEY-";

/** Rango de marcas diacriticas combinantes que NFD separa de su letra base. */
const DIACRITICOS = /[̀-ͯ]/g;

/**
 * R5: normaliza el identificador a un slug: NFD para separar los diacriticos, se
 * eliminan, minusculas, todo lo que no sea [a-z0-9] colapsa a "-", y se recortan los
 * "-" de los extremos. Devuelve "" si no queda nada utilizable (lo traduce a
 * `validation_error` el service, R6).
 */
export function slugify(identificador: string): string {
  return identificador
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * R10: email en el espacio de nombres reservado. El TLD `.invalid` (RFC 2606) no es
 * enrutable por ningun proveedor y no puede colisionar con el de un usuario humano.
 * La unicidad la garantiza el indice `usuario_email_key` (R11).
 */
export function emailSintetico(slug: string): string {
  return `${EMAIL_LOCAL_PREFIX}+${slug}@${EMAIL_DOMAIN}`;
}

/**
 * R10: cedula en el espacio de nombres reservado. La columna es TEXT libre (sin CHECK
 * de formato en la DB). Unicidad via el indice `usuario_cedula_key` (R11).
 */
export function cedulaSintetica(slug: string): string {
  return `${CEDULA_PREFIX}${slug}`;
}
