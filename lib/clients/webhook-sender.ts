// Feature 99 (design §4, R17/R19/R20/R29) — cliente HTTP de entrega de webhooks. POST del
// cuerpo firmado al callback del integrador.
//
// TRES INVARIANTES:
// 1. `fetch` INYECTABLE (`fetchImpl`, patron de `google-geocode.ts`): los tests ejercitan
//    2xx, no-2xx, timeout y fallo de red SIN tocar la red.
// 2. TIMEOUT via `AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)`: un callback lento no cuelga el
//    drenado de la cola.
// 3. El `detalle` de un desenlace transitorio cita solo el CODIGO o "timeout"/"red": NUNCA
//    la URL (que es dato del integrador) ni el cuerpo (que puede llevar identificadores de
//    orden). Privacidad R29.
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";

/** Nombre de la operacion citado en los detalles de error. Sin URL, sin cuerpo. */
const OPERACION = "entregar webhook";

export interface WebhookSenderOpts {
  /** Timeout de la peticion en ms. */
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red (invariante 1). */
  fetchImpl?: typeof fetch;
}

export class WebhookSender implements IWebhookSender {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WebhookSenderOpts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async entregar(
    url: string,
    cuerpo: string,
    headers: Record<string, string>,
  ): Promise<WebhookOutcome> {
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: cuerpo,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Fallo de RED o timeout -> transitorio (R20). El detalle NO incluye la URL ni el
      // cuerpo: solo la operacion (R29).
      return { status: "transitorio", detalle: `${OPERACION}: fallo de red o timeout` };
    }

    // 2xx -> aceptado (R19). Cualquier otro codigo -> transitorio, reintentable (R20). El
    // detalle cita solo el codigo, jamas el cuerpo de la respuesta.
    if (respuesta.status >= 200 && respuesta.status < 300) {
      return { status: "ok" };
    }
    return { status: "transitorio", detalle: `${OPERACION}: HTTP ${respuesta.status}` };
  }
}
