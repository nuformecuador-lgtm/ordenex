import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Feature 99 (design §3.1, D2/R32) — cifrado EN REPOSO del secreto de firma del webhook.
// Modulo NUEVO (el repo no tenia cifrado aplicativo). El emisor necesita el secreto LEGIBLE
// para firmar el HMAC de cada entrega (a diferencia de `ApiKey`, que solo compara un hash),
// asi que se guarda CIFRADO (no en claro) y se descifra en memoria justo para firmar.
//
// AES-256-GCM: cifrado autenticado. El authTag detecta manipulacion del ciphertext. IV
// aleatorio por cifrado (NUNCA reutilizar IV con GCM). Formato persistido:
//   v1:<iv_b64>:<tag_b64>:<ct_b64>
// El prefijo `v1:` versiona el esquema para una rotacion futura de clave/algoritmo sin
// migrar datos a ciegas (design §11, seguimiento 5).
//
// El secreto (ni en claro ni cifrado) NUNCA se loguea (R29/R32); ningun error de este modulo
// incluye el secreto.

const VERSION = "v1";
const ALGORITMO = "aes-256-gcm";
const IV_BYTES = 12; // recomendado para GCM
const CLAVE_BYTES = 32; // AES-256
const AUTH_TAG_BYTES = 16;

/**
 * R32: error RECUPERABLE del descifrado. Se lanza cuando la clave falta, es invalida, o el
 * authTag no cuadra. El handler lo deja propagar -> la cola aplica backoff (no dead-letter
 * inmediato), para que al configurar la clave los eventos pendientes se entreguen. El
 * mensaje NUNCA incluye el secreto ni el ciphertext.
 */
export class WebhookSecretKeyError extends Error {
  constructor(detalle: string) {
    super(`webhook_estado: no se pudo descifrar el secreto de firma (${detalle})`);
    this.name = "WebhookSecretKeyError";
  }
}

/**
 * Resuelve la clave cruda (base64 o hex) a 32 bytes. Lanza `WebhookSecretKeyError` si la
 * clave falta o no mide 32 bytes en ningun encoding aceptado. NUNCA incluye la clave en el
 * error.
 */
function resolverClave(claveRaw: string | null): Buffer {
  if (claveRaw === null || claveRaw === "") {
    throw new WebhookSecretKeyError("clave de cifrado no configurada");
  }
  // Se intenta base64 primero y hex como respaldo; ambos deben producir 32 bytes.
  const base64 = Buffer.from(claveRaw, "base64");
  if (base64.length === CLAVE_BYTES) return base64;
  const hex = Buffer.from(claveRaw, "hex");
  if (hex.length === CLAVE_BYTES) return hex;
  throw new WebhookSecretKeyError("clave de cifrado con longitud invalida (se esperan 32 bytes)");
}

/**
 * Cifra `secreto` con AES-256-GCM y devuelve el empaquetado `v1:<iv>:<tag>:<ct>`. La clave
 * DEBE estar configurada (32 bytes base64/hex); si no, lanza `WebhookSecretKeyError`.
 */
export function cifrarSecreto(claveRaw: string | null, secreto: string): string {
  const clave = resolverClave(claveRaw);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITMO, clave, iv);
  const ct = Buffer.concat([cipher.update(secreto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/**
 * Descifra el empaquetado `v1:<iv>:<tag>:<ct>` y verifica el authTag. Lanza
 * `WebhookSecretKeyError` (recuperable) si la clave falta o es invalida, si el formato no es
 * el esperado o si el authTag no cuadra. NUNCA incluye el secreto en el error.
 */
export function descifrarSecreto(claveRaw: string | null, empaquetado: string): string {
  const clave = resolverClave(claveRaw); // clave ausente -> WebhookSecretKeyError (R32)

  const partes = empaquetado.split(":");
  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new WebhookSecretKeyError("formato de secreto cifrado no reconocido");
  }
  const iv = Buffer.from(partes[1], "base64");
  const tag = Buffer.from(partes[2], "base64");
  const ct = Buffer.from(partes[3], "base64");
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) {
    throw new WebhookSecretKeyError("iv o authTag con longitud invalida");
  }

  try {
    const decipher = createDecipheriv(ALGORITMO, clave, iv);
    decipher.setAuthTag(tag);
    const plano = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plano.toString("utf8");
  } catch {
    // authTag no cuadra (ciphertext manipulado o clave equivocada). Sin detalle del valor.
    throw new WebhookSecretKeyError("verificacion de integridad fallida");
  }
}
