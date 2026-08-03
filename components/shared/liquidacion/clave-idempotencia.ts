/**
 * Feature 172 (T D.1, design §4.1) — la CLAVE DE IDEMPOTENCIA de un registro de pago.
 *
 * La genera el CLIENTE al abrir el formulario, no el servidor: el servidor no puede saber si
 * dos peticiones idénticas son un doble submit o dos pagos legítimos del mismo importe el
 * mismo día (`design.md §11 C`). La columna `liquidacion_pago.clave_idempotencia` es UNIQUE,
 * así que la barrera contra el doble pago es DE DATOS (R44) y esta clave es lo único que la
 * activa.
 *
 * El backend la valida con `z.string().uuid()`, así que el fallback también tiene que ser un
 * uuid v4 válido. Molde: `app/(app)/ordenes/_components/lote-id.ts` (feature 146), que
 * resuelve el mismo problema —identidad generada en el navegador y reusada en cada
 * reintento— para la carga masiva. No se importa de allí porque este módulo vive en
 * `components/shared/` y no puede depender de `app/`.
 */

/** Plantilla de uuid v4 para el fallback (entornos sin `crypto.randomUUID`). */
const PLANTILLA_UUID_V4 = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";

function uuidV4Fallback(): string {
  return PLANTILLA_UUID_V4.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Devuelve una clave de idempotencia nueva. Usa `crypto.randomUUID` cuando existe (todo
 * navegador en contexto seguro) y cae al generador propio en el resto.
 */
export function nuevaClaveIdempotencia(): string {
  const cripto = globalThis.crypto;
  return typeof cripto?.randomUUID === "function"
    ? cripto.randomUUID()
    : uuidV4Fallback();
}
