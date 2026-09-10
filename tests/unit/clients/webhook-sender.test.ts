import { describe, it, expect, vi } from "vitest";
import { WebhookSender, parseRetryAfterMs } from "@/lib/clients/webhook-sender";

// Feature 99 (R17/R19/R20/R29) — el cliente traduce el resultado HTTP a dominio SIN tocar la
// red (fetch inyectable): 2xx -> ok; no-2xx | timeout | red -> transitorio. Ningun detalle de
// error contiene la URL ni el cuerpo.

const URL_CALLBACK = "https://integrador.example.com/hooks/ordenex?token=SECRETO-EN-URL";
const CUERPO = JSON.stringify({ eventoId: "webhook_estado:o1:s1:2026", orden: { numGuia: 999 } });
const HEADERS = { "X-Ordenex-Signature": "sha256=abc", "X-Ordenex-Timestamp": "1700000000" };

function fetchQueDevuelve(status: number): typeof fetch {
  return vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;
}

describe("R17/R19 — 2xx completa", () => {
  it("hace POST a la url con el cuerpo y las cabeceras, y un 200 -> ok", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const sender = new WebhookSender({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const outcome = await sender.entregar(URL_CALLBACK, CUERPO, HEADERS);
    expect(outcome).toEqual({ status: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_CALLBACK);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(CUERPO);
    expect((init.headers as Record<string, string>)["X-Ordenex-Signature"]).toBe("sha256=abc");
  });

  it("un 204 tambien es ok", async () => {
    const sender = new WebhookSender({ fetchImpl: fetchQueDevuelve(204) });
    expect(await sender.entregar(URL_CALLBACK, CUERPO, HEADERS)).toEqual({ status: "ok" });
  });
});

describe("R20 — no-2xx | timeout | red -> transitorio", () => {
  it("un 5xx es transitorio", async () => {
    const sender = new WebhookSender({ fetchImpl: fetchQueDevuelve(500) });
    const outcome = await sender.entregar(URL_CALLBACK, CUERPO, HEADERS);
    expect(outcome.status).toBe("transitorio");
  });

  it("un 404 es transitorio", async () => {
    const sender = new WebhookSender({ fetchImpl: fetchQueDevuelve(404) });
    expect((await sender.entregar(URL_CALLBACK, CUERPO, HEADERS)).status).toBe("transitorio");
  });

  it("un fallo de red (fetch lanza) es transitorio", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED contra integrador.example.com");
    });
    const sender = new WebhookSender({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await sender.entregar(URL_CALLBACK, CUERPO, HEADERS)).status).toBe("transitorio");
  });

  it("un timeout (AbortError) es transitorio", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("The operation was aborted");
      err.name = "TimeoutError";
      throw err;
    });
    const sender = new WebhookSender({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await sender.entregar(URL_CALLBACK, CUERPO, HEADERS)).status).toBe("transitorio");
  });
});

describe("R29 — el detalle de error nunca contiene la URL ni el cuerpo", () => {
  it("ni el codigo HTTP ni el fallo de red filtran url/cuerpo", async () => {
    for (const impl of [
      fetchQueDevuelve(500),
      (vi.fn(async () => {
        throw new Error("boom hacia integrador.example.com con SECRETO-EN-URL");
      }) as unknown as typeof fetch),
    ]) {
      const sender = new WebhookSender({ fetchImpl: impl });
      const outcome = await sender.entregar(URL_CALLBACK, CUERPO, HEADERS);
      if (outcome.status === "transitorio") {
        expect(outcome.detalle).not.toContain(URL_CALLBACK);
        expect(outcome.detalle).not.toContain("SECRETO-EN-URL");
        expect(outcome.detalle).not.toContain(CUERPO);
        expect(outcome.detalle).not.toContain("999");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// FICHA 403 (T7, R14/R15/R16) — el 429 deja de tratarse como un fallo generico.
//
// Contexto medido en produccion: 2.042 fallos `HTTP 429` contra un solo destino en cinco dias.
// Reintentar con el backoff de siempre contra un destino que esta diciendo «me estas saturando»
// es exactamente lo que produjo esa cifra.
//
// LO QUE **NO** CAMBIA, y se afirma abajo: sigue siendo `transitorio`, sigue con el mismo
// `detalle`, y sigue gastando un intento (R16). Lo unico que gana es una SUGERENCIA de espera.
// ---------------------------------------------------------------------------

const AHORA = new Date("2026-09-09T10:00:00.000Z");

/** Una respuesta 429 con las cabeceras dadas. */
function fetch429(headers: Record<string, string> = {}): typeof fetch {
  return vi.fn(async () => new Response(null, { status: 429, headers })) as unknown as typeof fetch;
}

function sender429(headers: Record<string, string> = {}): WebhookSender {
  return new WebhookSender({ fetchImpl: fetch429(headers), now: () => AHORA });
}

describe("403/R14 — 429 con `Retry-After` interpretable trae la espera en ms", () => {
  it("⭑ forma SEGUNDOS: `Retry-After: 120` -> 120_000 ms", async () => {
    const outcome = await sender429({ "Retry-After": "120" }).entregar(URL_CALLBACK, CUERPO, HEADERS);
    expect(outcome).toEqual({
      status: "transitorio",
      detalle: "entregar webhook: HTTP 429",
      retryAfterMs: 120_000,
    });
  });

  it("⭑ forma FECHA HTTP: se resta el `now` INYECTADO, no el reloj del sistema", async () => {
    // El `now` inyectable existe para esto: sin el, este caso o seria no determinista o exigiria
    // congelar el reloj global. La fecha esta 5 minutos por delante del `AHORA` del sender.
    const outcome = await sender429({
      "Retry-After": "Wed, 09 Sep 2026 10:05:00 GMT",
    }).entregar(URL_CALLBACK, CUERPO, HEADERS);
    expect(outcome).toEqual({
      status: "transitorio",
      detalle: "entregar webhook: HTTP 429",
      retryAfterMs: 300_000,
    });
  });

  it("R16: sigue siendo un `transitorio` normal — el 429 no es un desenlace nuevo", async () => {
    // Es lo que mantiene intacto `MAX_INTENTOS_WEBHOOK`: la cola ve el mismo tipo de fallo de
    // siempre, asi que el job sigue gastando intentos y muriendo al quinto. Si esto fuera otro
    // `status`, todo el camino de dead-letter tendria que aprender un caso nuevo.
    const outcome = await sender429({ "Retry-After": "60" }).entregar(URL_CALLBACK, CUERPO, HEADERS);
    expect(outcome.status).toBe("transitorio");
  });
});

describe("403/R15 — 429 sin cabecera usable cae al backoff generico", () => {
  it("⭑ sin `Retry-After`, el desenlace es EXACTAMENTE el de cualquier otro fallo", async () => {
    const outcome = await sender429().entregar(URL_CALLBACK, CUERPO, HEADERS);
    // `toEqual` literal y no `toMatchObject`: la ausencia de la clave ES el contrato. Con
    // `retryAfterMs: undefined` presente, `JobQueueService` seguiria funcionando, pero el objeto
    // dejaria de ser identico al de un 500 y esa diferencia se acabaria colando en otro sitio.
    expect(outcome).toEqual({ status: "transitorio", detalle: "entregar webhook: HTTP 429" });
    expect("retryAfterMs" in outcome).toBe(false);
  });

  it("⭑ una cabecera ILEGIBLE no revienta: cae a la misma forma", async () => {
    for (const basura of ["pronto", "", "   ", "12abc", "cuando-quieras", "NaN"]) {
      const outcome = await sender429({ "Retry-After": basura }).entregar(
        URL_CALLBACK,
        CUERPO,
        HEADERS,
      );
      expect(outcome, `con "${basura}"`).toEqual({
        status: "transitorio",
        detalle: "entregar webhook: HTTP 429",
      });
    }
  });

  it("⭑ un `Retry-After` que pide esperar CERO o hacia atras se ignora", async () => {
    // Tratar un 0 o una fecha pasada como «espera 0 ms» pediria reintentar YA — mas agresivo que
    // el backoff normal, o sea lo contrario de lo que un 429 esta pidiendo. La direccion segura es
    // ignorarlo y dejar que mande la cola.
    for (const h of ["0", "Wed, 09 Sep 2026 09:00:00 GMT"]) {
      const outcome = await sender429({ "Retry-After": h }).entregar(URL_CALLBACK, CUERPO, HEADERS);
      expect(outcome, `con "${h}"`).toEqual({
        status: "transitorio",
        detalle: "entregar webhook: HTTP 429",
      });
    }
  });

  it("⭑ un 503 CON `Retry-After` NO trae sugerencia: solo el 429 la negocia (R14)", () => {
    // Anti-generalizacion. R14 habla del 429 y de nadie mas; extenderlo a cualquier codigo con
    // `Retry-After` seria diseño nuevo, no el arreglo minimo.
    return sender503().then((outcome) => {
      expect(outcome).toEqual({ status: "transitorio", detalle: "entregar webhook: HTTP 503" });
    });
  });
});

/** Un 503 que ADEMAS manda `Retry-After`, para el caso de anti-generalizacion de arriba. */
async function sender503() {
  const fetchImpl = vi.fn(
    async () => new Response(null, { status: 503, headers: { "Retry-After": "300" } }),
  ) as unknown as typeof fetch;
  return new WebhookSender({ fetchImpl, now: () => AHORA }).entregar(URL_CALLBACK, CUERPO, HEADERS);
}

describe("403/R14/R15 — `parseRetryAfterMs`, la funcion pura", () => {
  it("⭑ segundos: entero positivo -> ms; 0, negativo y decimal -> null", () => {
    expect(parseRetryAfterMs("1", AHORA)).toBe(1000);
    expect(parseRetryAfterMs("3600", AHORA)).toBe(3_600_000);
    // Un `Retry-After` gigante SE DEVUELVE TAL CUAL: acotarlo es politica de la cola (R17), no del
    // cliente HTTP. Si se acotara aqui habria dos topes que mantener de acuerdo.
    expect(parseRetryAfterMs("999999999", AHORA)).toBe(999_999_999_000);
    expect(parseRetryAfterMs("0", AHORA)).toBeNull();
    expect(parseRetryAfterMs("-5", AHORA)).toBeNull();
    expect(parseRetryAfterMs("12.5", AHORA)).toBeNull();
  });

  it("⭑ `12abc` NO se lee como 12: aceptar basura a medias es peor que ignorarla", () => {
    // `Number.parseInt("12abc")` devuelve 12. Este es el caso que obliga a la regex `^\\d+$`.
    expect(parseRetryAfterMs("12abc", AHORA)).toBeNull();
  });

  it("⭑ fecha HTTP: futura -> la diferencia; pasada, igual o ilegible -> null", () => {
    expect(parseRetryAfterMs("Wed, 09 Sep 2026 10:00:30 GMT", AHORA)).toBe(30_000);
    expect(parseRetryAfterMs("Wed, 09 Sep 2026 10:00:00 GMT", AHORA)).toBeNull(); // exactamente ahora
    expect(parseRetryAfterMs("Wed, 09 Sep 2026 09:59:59 GMT", AHORA)).toBeNull(); // pasada
    expect(parseRetryAfterMs("no-es-una-fecha", AHORA)).toBeNull();
  });

  it("cabecera ausente o vacia -> null", () => {
    expect(parseRetryAfterMs(null, AHORA)).toBeNull();
    expect(parseRetryAfterMs("", AHORA)).toBeNull();
    expect(parseRetryAfterMs("   ", AHORA)).toBeNull();
  });

  it("es PURA: el mismo header con otro `ahora` da otro resultado, y sin tocar el reloj real", () => {
    const header = "Wed, 09 Sep 2026 10:10:00 GMT";
    expect(parseRetryAfterMs(header, AHORA)).toBe(600_000);
    expect(parseRetryAfterMs(header, new Date("2026-09-09T10:05:00.000Z"))).toBe(300_000);
  });
});
