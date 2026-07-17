import { createHash } from "node:crypto";

// Feature 81 [D7] (design §5): hasheo del secreto de una API key.
//
// SHA-256, NO bcrypt — y es deliberado (no es un descuido de alineacion con el login):
//   - bcrypt existe para proteger secretos de BAJA entropia (contrasenas humanas)
//     encareciendo el diccionario. Una key de 256 bits uniformes no tiene diccionario
//     que atacar, asi que bcrypt no aporta nada aqui.
//   - bcrypt sala cada hash => el mismo secreto da hashes distintos => imposible el
//     lookup `WHERE key_hash = $1`. Verificar una key (feature 81a) exigiria un
//     `bcrypt.compare` contra CADA fila: O(n) hashes lentos por request.
//   - bcrypt trunca a 72 bytes.
// El precio clasico de SHA-256 sin sal (rainbow tables) NO aplica: no hay tabla
// precomputable para 2^256 valores aleatorios.
//
// La contrasena del usuario dedicado SI sigue en bcrypt via `hashPassword`
// (`lib/utils/password.ts`): ahi la alineacion con el login importa y se mantiene.
// No confundir ambos hasheos.

/**
 * Hash SHA-256 en hex (64 chars) del secreto completo en claro. Determinista (permite
 * el lookup por indice UNIQUE de R25). Funcion pura: no loguea el secreto ni el hash
 * (R20). Es lo UNICO que se persiste de la key (R16).
 */
export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}
