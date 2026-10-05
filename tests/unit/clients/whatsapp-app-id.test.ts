import { describe, it, expect, vi } from "vitest";
import {
  ResolutorAppIdMeta,
  mensajeAppIdNoResuelto,
  type CacheAppId,
} from "@/lib/clients/whatsapp-app-id";
import { WhatsappNoConfiguradoError, type WhatsappConfig } from "@/lib/config/whatsapp";

// Ficha 474 (T4.3, R48) — el ID de la app se obtiene del token con GET /<apiVersion>/app, token en
// la CABECERA; anulacion por env sin red; cache solo del exito.

const TOKEN = "EAAG-token-secreto-123";
const CONFIG: WhatsappConfig = {
  token: TOKEN,
  numeroId: "111",
  wabaId: "222",
  apiVersion: "v21.0",
  templateCategoria: "UTILITY",
  templateIdioma: "es",
};

function respuesta(status: number, cuerpo: unknown): Response {
  return new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status });
}

function crear(fetchImpl: typeof fetch, extra: { anulacion?: string; cache?: CacheAppId; leerConfig?: () => WhatsappConfig } = {}) {
  const logs: string[] = [];
  const r = new ResolutorAppIdMeta({
    fetchImpl,
    leerConfig: extra.leerConfig ?? (() => CONFIG),
    leerAnulacion: () => extra.anulacion,
    cache: extra.cache ?? { appId: null },
    logger: { warn: (m) => logs.push(m) },
  });
  return { r, logs };
}

describe("474/R48 — exito", () => {
  it("GET a /v21.0/app con Authorization Bearer y el token FUERA de la URL", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { id: "1234567890", name: "Ordenex" }));
    const { r } = crear(fetchImpl as unknown as typeof fetch);
    const out = await r.resolver();
    expect(out).toEqual({ ok: true, appId: "1234567890", origen: "meta" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/app");
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("la segunda llamada NO vuelve a la red (cache de proceso)", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { id: "987" }));
    const cache = { appId: null };
    const a = crear(fetchImpl as unknown as typeof fetch, { cache });
    await a.r.resolver();
    const b = crear(fetchImpl as unknown as typeof fetch, { cache }); // otro resolutor, mismo proceso
    expect(await b.r.resolver()).toEqual({ ok: true, appId: "987", origen: "meta" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("474/R48 — anulacion por WHATSAPP_APP_ID", () => {
  it("con valor: cero llamadas a fetch y origen env", async () => {
    const fetchImpl = vi.fn();
    const { r } = crear(fetchImpl as unknown as typeof fetch, { anulacion: " 555 " });
    expect(await r.resolver()).toEqual({ ok: true, appId: "555", origen: "env" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("vacia: se ignora y se consulta a Meta", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { id: "1" }));
    const { r } = crear(fetchImpl as unknown as typeof fetch, { anulacion: "  " });
    expect((await r.resolver()).ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("474/R48 — fallos (no se cachean)", () => {
  it("HTTP 400 con codigo de Meta -> ok:false http + codigo; la siguiente vuelve a pedir", async () => {
    const fetchImpl = vi.fn(async () => respuesta(400, { error: { code: 190, message: `token ${TOKEN} invalido` } }));
    const cache = { appId: null };
    const { r, logs } = crear(fetchImpl as unknown as typeof fetch, { cache });
    const out = await r.resolver();
    expect(out).toEqual({ ok: false, motivo: "http", codigo: 190 });
    await r.resolver();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cache.appId).toBeNull();
    expect(JSON.stringify(out) + logs.join("|")).not.toContain(TOKEN);
  });

  it("red -> ok:false red", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const { r } = crear(fetchImpl as unknown as typeof fetch);
    expect(await r.resolver()).toEqual({ ok: false, motivo: "red" });
  });

  it("timeout -> ok:false timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error("timeout");
      e.name = "TimeoutError";
      throw e;
    });
    const { r } = crear(fetchImpl as unknown as typeof fetch);
    expect(await r.resolver()).toEqual({ ok: false, motivo: "timeout" });
  });

  it("id no numerico -> respuesta_invalida", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { id: "abc" }));
    const cache = { appId: null };
    const { r } = crear(fetchImpl as unknown as typeof fetch, { cache });
    expect(await r.resolver()).toEqual({ ok: false, motivo: "respuesta_invalida" });
    expect(cache.appId).toBeNull();
  });

  it("sin credencial -> sin_credencial con el NOMBRE de la variable, sin red", async () => {
    const fetchImpl = vi.fn();
    const { r } = crear(fetchImpl as unknown as typeof fetch, {
      leerConfig: () => {
        throw new WhatsappNoConfiguradoError("WHATSAPP_CLOUD_TOKEN");
      },
    });
    const out = await r.resolver();
    expect(out).toEqual({ ok: false, motivo: "sin_credencial", variableFaltante: "WHATSAPP_CLOUD_TOKEN" });
    expect(fetchImpl).not.toHaveBeenCalled();
    if (out.ok) throw new Error("imposible");
    expect(mensajeAppIdNoResuelto(out)).toContain("falta WHATSAPP_CLOUD_TOKEN");
  });

  it("el mensaje de fallo nombra el codigo y no lleva secretos", () => {
    const m = mensajeAppIdNoResuelto({ ok: false, motivo: "http", codigo: 190 });
    expect(m).toContain("código 190");
    expect(m).toContain("Las plantillas con documento no se pueden enviar a aprobación");
  });
});
