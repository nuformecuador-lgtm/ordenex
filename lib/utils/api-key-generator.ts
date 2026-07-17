import { randomBytes } from "node:crypto";

// Feature 81 [D3] (design §4): genera el secreto de una API key. Helper PURO, sin
// efectos secundarios: no persiste, no loguea (R20) y no conoce la DB. Mismo patron
// que `lib/utils/password-generator.ts`.

/** Prefijo fijo e identificable de las keys de esta app (R15), patron `sk_`/`ghp_`. */
export const API_KEY_PREFIX = "ordx_";

/** Chars del inicio que se guardan en claro como `key_prefix` (R17): `ordx_` + 7. */
export const PREFIX_VISIBLE_CHARS = 12;

/** Bytes de entropia del secreto: 32 bytes = 256 bits (R14). */
const SECRET_BYTES = 32;

export interface GeneratedApiKey {
  /** Secreto completo en claro. Solo vive en memoria y se devuelve UNA vez (R18). */
  plain: string;
  /** Primeros `PREFIX_VISIBLE_CHARS` del secreto. NO es secreto: se persiste (R17). */
  prefix: string;
}

/**
 * Genera una API key nueva: `ordx_` + 32 bytes aleatorios en base64url (R14/R15).
 * La aleatoriedad es criptografica (`randomBytes`), por lo que dos invocaciones con
 * el mismo identificador producen secretos distintos (R22): el identificador ni
 * siquiera entra en el calculo.
 */
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(SECRET_BYTES).toString("base64url"); // 256 bits (R14)
  const plain = `${API_KEY_PREFIX}${secret}`; // R15
  return { plain, prefix: plain.slice(0, PREFIX_VISIBLE_CHARS) }; // R17
}
