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
//
// FICHA 403 (design §6) — el 429 deja de tratarse como un fallo generico: si el destino dice
// CUANTO esperar (`Retry-After`), esa cifra viaja como `retryAfterMs` del desenlace. El cliente
// sigue sin decidir politica —no sabe que es un backoff ni que es una pausa—: solo TRADUCE la
// cabecera a milisegundos. Quien acota y decide es `JobQueueService` (R17).
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";

/** Nombre de la operacion citado en los detalles de error. Sin URL, sin cuerpo. */
const OPERACION = "entregar webhook";

/** FICHA 403 (R14): el unico codigo que trae una espera negociada. */
const HTTP_DEMASIADAS_PETICIONES = 429;

/**
 * FICHA 403 (R14/R15) — `Retry-After` a milisegundos, o `null` si no es interpretable.
 *
 * Funcion PURA y con `ahora` explicito: la forma "fecha HTTP" es relativa al reloj, y sin un
 * instante inyectado el test seria no determinista o tendria que congelar el reloj global.
 *
 * RFC 7231 §7.1.3 admite DOS formas y las dos se soportan:
 *   - `delay-seconds`: un entero no negativo de SEGUNDOS  (`Retry-After: 120`);
 *   - `HTTP-date`:     una fecha absoluta                  (`Retry-After: Wed, 09 Sep 2026 10:05:00 GMT`).
 *
 * QUE DEVUELVE `null`, y todo esto acaba en el backoff generico (R15), nunca en una excepcion:
 *   - cabecera ausente;
 *   - texto que no es ni numero ni fecha (`"pronto"`, `""`);
 *   - un numero NEGATIVO o una fecha YA PASADA: "espera un tiempo negativo" no significa nada, y
 *     tratarlo como 0 seria peor que ignorarlo (pediria reintentar YA, mas agresivo que el
 *     backoff normal — justo lo contrario de lo que un 429 pide).
 * Un `0` legitimo tambien cae aqui: son 0 ms de espera, o sea ninguna sugerencia util.
 *
 * ⚠️ NO SE ACOTA AQUI. El tope (`JOBS_BACKOFF_CAP_MS`, R17) es politica de la COLA, no del
 * cliente HTTP: si este archivo la aplicara, la cola no podria seguir siendo el unico sitio donde
 * se decide cuanto puede esperar un job y habria dos topes que mantener de acuerdo.
 */
export function parseRetryAfterMs(header: string | null, ahora: Date): number | null {
  if (header === null) return null;
  const crudo = header.trim();
  if (crudo === "") return null;

  // Forma 1: delay-seconds. `^\d+$` y no `Number.parseInt`: este ultimo se traga `"12abc"` y
  // `"12.9"` devolviendo 12, y aceptar basura a medias es peor que caer al backoff generico.
  if (/^\d+$/.test(crudo)) {
    const segundos = Number(crudo);
    return segundos > 0 ? segundos * 1000 : null;
  }

  // Forma 2: HTTP-date. `Date.parse` devuelve NaN si no la entiende.
  const instante = Date.parse(crudo);
  if (Number.isNaN(instante)) return null;
  const espera = instante - ahora.getTime();
  return espera > 0 ? espera : null;
}

export interface WebhookSenderOpts {
  /** Timeout de la peticion en ms. */
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red (invariante 1). */
  fetchImpl?: typeof fetch;
  /**
   * FICHA 403: reloj inyectable. Solo lo usa `parseRetryAfterMs` para la forma "fecha HTTP"; sin
   * el, ese caso no seria determinista en un test.
   */
  now?: () => Date;
}

export class WebhookSender implements IWebhookSender {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(opts: WebhookSenderOpts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => new Date());
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

    const detalle = `${OPERACION}: HTTP ${respuesta.status}`;
    // FICHA 403 (R14/R16): un 429 sigue siendo un transitorio NORMAL —mismo `status`, mismo
    // formato de detalle, mismo gasto de intento—; lo unico que gana es la sugerencia de espera.
    if (respuesta.status !== HTTP_DEMASIADAS_PETICIONES) return { status: "transitorio", detalle };

    const retryAfterMs = parseRetryAfterMs(respuesta.headers.get("Retry-After"), this.now());
    // R15: sin cabecera interpretable, el desenlace es EXACTAMENTE el de cualquier otro fallo. Se
    // omite la clave en vez de mandar `undefined` para que el objeto siga siendo comparable con un
    // `toEqual` literal, que es como lo miden los tests de la 99.
    if (retryAfterMs === null) return { status: "transitorio", detalle };
    return { status: "transitorio", detalle, retryAfterMs };
  }
}
