import { describe, it, expect, vi } from "vitest";
import { WhatsappMediaUploadClient } from "@/lib/clients/whatsapp-media-upload";
import type { WhatsappConfig } from "@/lib/config/whatsapp";

// Feature 316 — B1.T (R17/R19/R28). Cliente de SUBIDA de media. Cuatro cosas se prueban aqui
// y en ningun otro sitio:
//   1. el multipart lo arma el cliente y el `Content-Type` NO se fija a mano (lo pone el
//      runtime con el `boundary`): es la razon tecnica de que este cliente exista aparte;
//   2. un 200 con forma inesperada es `error`, NUNCA un `ok` con `mediaId` vacio -que
//      terminaria en la columna `media_id` y en una burbuja rota para siempre-;
//   3. `rechazado` (4xx) y `error` (red/5xx) son desenlaces distintos;
//   4. el token viaja SOLO en `Authorization` y no aparece en ningun `detalle` (R28).

const TOKEN = "TOKEN-SECRETO-QUE-NO-DEBE-FILTRARSE";

const CONFIG: WhatsappConfig = {
  token: TOKEN,
  numeroId: "num-1",
  wabaId: "waba-1",
  apiVersion: "v21.0",
  templateCategoria: "UTILITY",
  templateIdioma: "es",
};

const NOMBRE_ARCHIVO = "acta-de-entrega-de-ana.pdf";

function respuestaJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cliente(fetchImpl: typeof fetch) {
  return new WhatsappMediaUploadClient({ config: CONFIG, fetchImpl, timeoutMs: 50 });
}

function adjunto() {
  return {
    mime: "image/jpeg",
    nombre: NOMBRE_ARCHIVO,
    cuerpo: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }),
  };
}

describe("WhatsappMediaUploadClient.subir — camino feliz (R17)", () => {
  it("(a) un 200 con {id} devuelve ok con ese media id", async () => {
    const fetchImpl = vi.fn(async () => respuestaJson({ id: "MEDIA-9" })) as unknown as typeof fetch;

    expect(await cliente(fetchImpl).subir(adjunto())).toEqual({
      status: "ok",
      mediaId: "MEDIA-9",
    });
  });

  it("(b) manda un FormData con messaging_product y NO fija Content-Type a mano", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetchImpl = vi.fn(async (u: string | URL | Request, i?: RequestInit) => {
      url = String(u);
      init = i;
      return respuestaJson({ id: "MEDIA-9" });
    }) as unknown as typeof fetch;

    await cliente(fetchImpl).subir(adjunto());

    expect(url).toBe("https://graph.facebook.com/v21.0/num-1/media");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);

    const form = init?.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("image/jpeg");
    expect(form.get("file")).not.toBeNull();

    // El `Content-Type` del multipart lo pone el RUNTIME junto con el boundary. Fijarlo aqui
    // produciria un boundary ausente o desparejado y un 400 imposible de diagnosticar.
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBeNull();
  });
});

describe("WhatsappMediaUploadClient.subir — desenlaces de fallo (R19)", () => {
  it("(c) un 400 es `rechazado` con el codigo de Meta", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaJson({ error: { message: "Invalid file", code: 100 } }, 400),
    ) as unknown as typeof fetch;

    const outcome = await cliente(fetchImpl).subir(adjunto());
    expect(outcome.status).toBe("rechazado");
    if (outcome.status === "rechazado") {
      expect(outcome.codigoMeta).toBe(100);
      expect(outcome.detalle).toContain("400");
    }
  });

  it("(c) un fallo de red es `error`, no `rechazado`", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const outcome = await cliente(fetchImpl).subir(adjunto());
    expect(outcome.status).toBe("error");
  });

  it("(c) un 503 es `error` (pasajero), no `rechazado`", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaJson({ error: { code: 2 } }, 503),
    ) as unknown as typeof fetch;

    expect((await cliente(fetchImpl).subir(adjunto())).status).toBe("error");
  });

  it("(d) un 200 con {} es `error` y NUNCA un ok con mediaId vacio", async () => {
    const casos: unknown[] = [{}, { id: "" }, { id: 42 }, { media: "MEDIA-9" }];

    for (const body of casos) {
      const fetchImpl = vi.fn(async () => respuestaJson(body)) as unknown as typeof fetch;
      const outcome = await cliente(fetchImpl).subir(adjunto());

      expect(outcome.status).toBe("error");
      // El assert que importa: nada de `ok` con un id que luego iria a la columna `media_id`.
      expect(outcome).not.toHaveProperty("mediaId");
    }
  });

  it("(d) un 200 cuyo cuerpo no es JSON es `error`", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>proxy</html>", { status: 200 }),
    ) as unknown as typeof fetch;

    expect((await cliente(fetchImpl).subir(adjunto())).status).toBe("error");
  });
});

describe("WhatsappMediaUploadClient.subir — PII y token (R28)", () => {
  it("(e) el token va SOLO en Authorization: Bearer y nunca en la URL", async () => {
    let url = "";
    let auth: string | null = null;
    const fetchImpl = vi.fn(async (u: string | URL | Request, i?: RequestInit) => {
      url = String(u);
      auth = new Headers(i?.headers).get("Authorization");
      return respuestaJson({ id: "MEDIA-9" });
    }) as unknown as typeof fetch;

    await cliente(fetchImpl).subir(adjunto());

    expect(auth).toBe(`Bearer ${TOKEN}`);
    expect(url).not.toContain(TOKEN);
  });

  it("(e) ningun `detalle` lleva el token ni el nombre del archivo, en NINGUNA rama", async () => {
    const casos: (typeof fetch)[] = [
      // fallo de red cuyo Error ecoa el token (peor caso imaginable)
      vi.fn(async () => {
        throw new Error(`fallo con el token ${TOKEN}`);
      }) as unknown as typeof fetch,
      // 400 con el token y el nombre del archivo ecoados en el cuerpo
      vi.fn(async () =>
        respuestaJson(
          { error: { message: `bad token ${TOKEN} para ${NOMBRE_ARCHIVO}`, code: 190 } },
          400,
        ),
      ) as unknown as typeof fetch,
      // 500 con lo mismo
      vi.fn(async () =>
        respuestaJson({ error: { message: `${TOKEN} / ${NOMBRE_ARCHIVO}`, code: 2 } }, 500),
      ) as unknown as typeof fetch,
      // 200 con forma inesperada
      vi.fn(async () => respuestaJson({})) as unknown as typeof fetch,
    ];

    const detalles: string[] = [];
    for (const fetchImpl of casos) {
      const outcome = await cliente(fetchImpl).subir(adjunto());
      expect(outcome.status).not.toBe("ok");
      if (outcome.status !== "ok") detalles.push(outcome.detalle);
    }

    expect(detalles).toHaveLength(4);
    for (const d of detalles) {
      expect(d).not.toContain(TOKEN);
      expect(d).not.toContain(NOMBRE_ARCHIVO);
    }
  });

  it("(e) no loguea nada: ni el nombre del archivo ni el media id llegan a la consola", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const fetchImpl = vi.fn(async () =>
      respuestaJson({ error: { code: 100 } }, 400),
    ) as unknown as typeof fetch;
    await cliente(fetchImpl).subir(adjunto());

    for (const spy of [warn, log, error]) expect(spy).not.toHaveBeenCalled();
    warn.mockRestore();
    log.mockRestore();
    error.mockRestore();
  });
});
