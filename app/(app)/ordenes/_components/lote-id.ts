// Feature 146 (C4, design §3.6) — identificador del lote de una carga masiva por
// INTERFAZ. El servidor no sabe cual es el ultimo chunk (lo trocea el cliente), asi
// que el cliente genera este uuid al INICIAR la carga y lo reusa en cada reintento:
// es la clave de idempotencia de `notificarCargaMasivaTerminada` (R39).

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
 * Devuelve un uuid v4. Usa `crypto.randomUUID` cuando existe (todo navegador con
 * contexto seguro) y cae al generador propio en el resto — el backend valida el
 * formato con `z.uuid()`, asi que el fallback debe seguir siendo un uuid v4 valido.
 */
export function nuevoLoteId(): string {
  const cripto = globalThis.crypto;
  return typeof cripto?.randomUUID === "function"
    ? cripto.randomUUID()
    : uuidV4Fallback();
}
