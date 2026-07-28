// Logger de la integracion de WhatsApp y volcado de diagnostico del webhook.
//
// INVARIANTE DE PRIVACIDAD (feature 109/R11): NUNCA se emite el numero del cliente, el cuerpo
// del mensaje, el token de la Graph API ni la firma HMAC. Lo que SI se emite es la respuesta
// de Meta SOBRE EL ERROR, que es justamente lo que hace falta para diagnosticar y no
// identifica a nadie por si sola.

import type { ChatLogger } from "@/lib/services/ChatWhatsappService";

/** Implementacion real: `console.warn`. En Vercel aparece en los logs de la funcion. */
export const consoleLogger: ChatLogger = {
  warn: (message: string) => {
    console.warn(message);
  },
};

/**
 * Claves del payload de Meta que identifican al destinatario. Se REDACTAN antes de volcar el
 * status crudo: `recipient_id` es el telefono del cliente en E.164, o sea PII directa.
 */
const CLAVES_PII = new Set(["recipient_id", "recipient", "from", "wa_id", "phone_number"]);

/**
 * Copia profunda del valor sustituyendo por `"[redactado]"` cualquier clave de `CLAVES_PII`.
 * Puro y defensivo: tolera null, arrays y anidacion arbitraria sin lanzar.
 */
function redactar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(redactar);
  if (valor === null || typeof valor !== "object") return valor;
  const salida: Record<string, unknown> = {};
  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    salida[clave] = CLAVES_PII.has(clave) ? "[redactado]" : redactar(v);
  }
  return salida;
}

/**
 * Vuelca el status CRUDO y COMPLETO de cada saliente `failed` del lote, con el destinatario
 * redactado. Es la unica forma de ver todo lo que manda Meta: el borde tipado
 * (`parseWebhookEventos`) hace zod strip y se queda solo con lo accionable, asi que campos
 * como `conversation`, `pricing` o un `errors[].error_data` con forma nueva no sobreviven.
 *
 * Se alimenta del cuerpo YA PARSEADO como JSON en el route handler; nunca del texto crudo,
 * que es lo que se firma. Cualquier fallo de forma se traga: el diagnostico no puede romper
 * la ingesta ni el 200 que Meta espera (R9).
 */
export function volcarStatusesFallidos(cuerpo: unknown, logger: ChatLogger): void {
  try {
    const entry = (cuerpo as { entry?: unknown[] })?.entry;
    if (!Array.isArray(entry)) return;
    for (const e of entry) {
      const changes = (e as { changes?: unknown[] })?.changes;
      if (!Array.isArray(changes)) continue;
      for (const c of changes) {
        const statuses = (c as { value?: { statuses?: unknown[] } })?.value?.statuses;
        if (!Array.isArray(statuses)) continue;
        for (const s of statuses) {
          if ((s as { status?: unknown })?.status !== "failed") continue;
          logger.warn(`[whatsapp] status failed (crudo): ${JSON.stringify(redactar(s))}`);
        }
      }
    }
  } catch {
    // Diagnostico best-effort: jamas debe tumbar la ingesta.
  }
}
