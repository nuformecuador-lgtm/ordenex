import type { ActionError } from "@/lib/types/orden";
import { MSG, CODE_BY_DOMAIN_STATUS } from "@/lib/errors/codes";

/**
 * R21: adaptador PURO que traduce un `ActionError` de dominio a su mensaje
 * canónico en español. Reutiliza las cadenas de `lib/errors` (no duplica textos).
 *
 * [RESUELTO-B]: para `validation_error` devuelve el mensaje genérico
 * `MSG.VALIDATION_ERROR`; los `fieldErrors` no se aplanan en el mensaje.
 */
export function messageFromActionError(err: ActionError): string {
  const code = CODE_BY_DOMAIN_STATUS[err.status]; // domain status -> AppErrorCode
  return MSG[code]; // mensaje canónico en español
}
