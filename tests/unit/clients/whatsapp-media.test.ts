import { describe, it, expect, vi } from "vitest";
import { WhatsappMediaClient } from "@/lib/clients/whatsapp-media";
import type { WhatsappConfig } from "@/lib/config/whatsapp";

// Feature 299 — F1.T (R21/R24/R35). Cliente de DESCARGA de media. Tres cosas que se prueban
// aqui y en ningun otro sitio:
//   1. `expirado` es un desenlace PROPIO (R24): la UI tiene que poder decir "ya no esta
//      disponible" y no "error"; sin esta distincion el requisito no existe.
//   2. El token viaja SOLO en la cabecera `Authorization` y NUNCA aparece en un detalle de
//      error (R35). Se comprueba con un token reconocible.
//   3. `fetchImpl` inyectable: cero red, cero credencial real.

const TOKEN = "TOKEN-SECRETO-QUE-NO-DEBE-FILTRARSE";

const CONFIG: WhatsappConfig = {
  token: TOKEN,
  numeroId: "num-1",
  wabaId: "waba-1",
  apiVersion: "v21.0",
  templateCategoria: "UTILITY",
  templateIdioma: "es",
};

function respuestaJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cliente(fetchImpl: typeof fetch) {
  return new WhatsappMediaClient({ config: CONFIG, fetchImpl, timeoutMs: 50 });
}

describe("WhatsappMediaClient.descargar — camino feliz (R21)", () => {
  it("dos saltos: metadatos y binario; devuelve ok con el stream y el mime", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("graph.facebook.com/v21.0/MEDIA-1")) {
        return respuestaJson({ url: "https://lookaside.test/tmp", mime_type: "image/jpeg", file_size: 42 });
      }
      return new Response("BINARIO", {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Content-Length": "7" },
      });
    }) as unknown as typeof fetch;

    const outcome = await cliente(fetchImpl).descargar("MEDIA-1");

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.mime).toBe("image/jpeg");
      expect(outcome.tamano).toBe(7);
      expect(outcome.cuerpo).not.toBeNull();
    }
  });

  it("el token viaja en Authorization: Bearer en AMBOS saltos, nunca en la URL", async () => {
    const llamadas: { url: string; auth: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      llamadas.push({ url: String(url), auth: headers.get("Authorization") });
      if (llamadas.length === 1) return respuestaJson({ url: "https://lookaside.test/tmp" });
      return new Response("BINARIO", { status: 200 });
    }) as unknown as typeof fetch;

    await cliente(fetchImpl).descargar("MEDIA-1");

    expect(llamadas).toHaveLength(2);
    for (const l of llamadas) {
      expect(l.auth).toBe(`Bearer ${TOKEN}`);
      expect(l.url).not.toContain(TOKEN);
    }
  });
});

describe("WhatsappMediaClient.descargar — caducidad a los 30 dias (R24)", () => {
  it("404 de Meta -> expirado (no un error generico)", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaJson({ error: { message: "Unsupported get request", code: 803 } }, 404),
    ) as unknown as typeof fetch;

    expect(await cliente(fetchImpl).descargar("MEDIA-VIEJA")).toEqual({ status: "expirado" });
  });

  it("error.code 100 (objeto inexistente) -> expirado", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaJson({ error: { message: "Object does not exist", code: 100 } }, 400),
    ) as unknown as typeof fetch;

    expect(await cliente(fetchImpl).descargar("MEDIA-VIEJA")).toEqual({ status: "expirado" });
  });

  it("una `url` vacia en un 2xx tambien es expirado (tercer sintoma observado)", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaJson({ url: "", mime_type: "image/jpeg" }),
    ) as unknown as typeof fetch;

    expect(await cliente(fetchImpl).descargar("MEDIA-VIEJA")).toEqual({ status: "expirado" });
  });

  it("un 404 en el SEGUNDO salto (la url temporal caduco) tambien es expirado", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) return respuestaJson({ url: "https://lookaside.test/tmp" });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    expect(await cliente(fetchImpl).descargar("MEDIA-1")).toEqual({ status: "expirado" });
  });
});

describe("WhatsappMediaClient.descargar — fallos y PII (R35)", () => {
  it("un 500 de la Graph API es `error`, NO `expirado`", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaJson({ error: { message: "boom", code: 2 } }, 500),
    ) as unknown as typeof fetch;

    const outcome = await cliente(fetchImpl).descargar("MEDIA-1");
    expect(outcome.status).toBe("error");
  });

  it("el token NO aparece en el detalle de NINGUN error (red, 5xx, json roto)", async () => {
    const detalles: string[] = [];

    const casos: (typeof fetch)[] = [
      // fallo de red
      vi.fn(async () => {
        throw new Error(`fallo con el token ${TOKEN}`);
      }) as unknown as typeof fetch,
      // 5xx con el token ecoado en el cuerpo (peor caso imaginable)
      vi.fn(async () =>
        respuestaJson({ error: { message: `bad token ${TOKEN}`, code: 190 } }, 500),
      ) as unknown as typeof fetch,
      // 2xx con cuerpo que no es JSON
      vi.fn(async () => new Response("<html>proxy</html>", { status: 200 })) as unknown as typeof fetch,
    ];

    for (const fetchImpl of casos) {
      const outcome = await cliente(fetchImpl).descargar("MEDIA-1");
      expect(outcome.status).toBe("error");
      if (outcome.status === "error") detalles.push(outcome.detalle);
    }

    expect(detalles).toHaveLength(3);
    for (const d of detalles) expect(d).not.toContain(TOKEN);
  });

  it("no loguea nada: el media id no llega a la consola", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const fetchImpl = vi.fn(async () =>
      respuestaJson({ error: { code: 100 } }, 400),
    ) as unknown as typeof fetch;
    await cliente(fetchImpl).descargar("MEDIA-SECRETA");

    for (const spy of [warn, log, error]) expect(spy).not.toHaveBeenCalled();
    warn.mockRestore();
    log.mockRestore();
    error.mockRestore();
  });
});
