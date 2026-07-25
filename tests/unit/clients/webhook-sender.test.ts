import { describe, it, expect, vi } from "vitest";
import { WebhookSender } from "@/lib/clients/webhook-sender";

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
