import { describe, it, expect, vi, type Mock } from "vitest";
import fs from "fs";
import path from "path";
import { GET } from "@/app/api/chat/media/[mensajeId]/route";
import type { ChatMediaRouteDeps } from "@/app/api/chat/media/[mensajeId]/route";
import type { WhatsappMediaOutcome } from "@/lib/clients/whatsapp-media";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ChatMediaAutorizada } from "@/lib/interfaces/repositories/IChatMensajeRepository";

// Feature 299 — F3.T (R15/R21/R22/R23/R24/R25). El proxy de media.
//
// Lo que estos tests protegen, en una frase: NADIE que no sea el mensajero asignado consigue
// que el servidor llame siquiera a la Graph API, y lo que sale por el cable nunca lleva el
// token ni el media id de Meta.

const MENSAJE_ID = "11111111-2222-4333-8444-555555555555";
const MENSAJERO: Actor = { usuarioId: "men-1", rol: "mensajero", zonaId: null };

function media(over: Partial<ChatMediaAutorizada> = {}): ChatMediaAutorizada {
  return {
    mediaId: "MEDIA-DE-META-123",
    mediaMime: "image/jpeg",
    mediaNombre: null,
    ordenId: "orden-1",
    ...over,
  };
}

function pedir(deps: ChatMediaRouteDeps, query = ""): Promise<Response> {
  return GET(
    new Request(`https://app.test/api/chat/media/${MENSAJE_ID}${query}`),
    { params: Promise.resolve({ mensajeId: MENSAJE_ID }) },
    deps,
  );
}

type DescargadorEspiado = { descargar: Mock<(mediaId: string) => Promise<WhatsappMediaOutcome>> };

function descargadorOk(mime = "image/jpeg"): DescargadorEspiado {
  return {
    descargar: vi.fn(async (): Promise<WhatsappMediaOutcome> => ({
      status: "ok",
      cuerpo: new Response("BINARIO").body,
      mime,
      tamano: 7,
    })),
  };
}

function descargadorCon(outcome: WhatsappMediaOutcome): DescargadorEspiado {
  return { descargar: vi.fn(async () => outcome) };
}

describe("GET /api/chat/media/[mensajeId] — camino feliz (R21)", () => {
  it("devuelve el binario con su Content-Type al mensajero asignado", async () => {
    const descargador = descargadorOk();
    const res = await pedir({
      getActor: async () => MENSAJERO,
      mensajeRepo: { findMediaParaMensajero: vi.fn(async () => media()) },
      descargador,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // Nunca `public`: el binario es PII del cliente.
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect(res.headers.get("Cache-Control")).not.toContain("public");
    expect(await res.text()).toBe("BINARIO");
    expect(descargador.descargar).toHaveBeenCalledWith("MEDIA-DE-META-123");
  });

  it("el media id de Meta NO aparece en ninguna cabecera de la respuesta (R21/R35)", async () => {
    const res = await pedir({
      getActor: async () => MENSAJERO,
      mensajeRepo: { findMediaParaMensajero: vi.fn(async () => media()) },
      descargador: descargadorOk(),
    });

    const cabeceras = JSON.stringify([...res.headers.entries()]);
    expect(cabeceras).not.toContain("MEDIA-DE-META-123");
  });
});

describe("GET /api/chat/media/[mensajeId] — autorizacion (R22/R23)", () => {
  it("R22: sin sesion responde 401 y NO llama a la Graph API ni a la base", async () => {
    const descargador = descargadorOk();
    const findMediaParaMensajero = vi.fn(async () => media());

    const res = await pedir({
      getActor: async () => null,
      mensajeRepo: { findMediaParaMensajero },
      descargador,
    });

    expect(res.status).toBe(401);
    expect(descargador.descargar).not.toHaveBeenCalled();
    expect(findMediaParaMensajero).not.toHaveBeenCalled();
  });

  it("R23: orden de otro mensajero responde 403 y NO llama a la Graph API", async () => {
    const descargador = descargadorOk();

    const res = await pedir({
      getActor: async () => MENSAJERO,
      // La query con el scope no devuelve fila: la orden no es suya.
      mensajeRepo: { findMediaParaMensajero: vi.fn(async () => null) },
      descargador,
    });

    expect(res.status).toBe(403);
    expect(descargador.descargar).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("un mensajeId con formato invalido se trata como ajeno (403), sin tocar la red", async () => {
    const descargador = descargadorOk();
    const findMediaParaMensajero = vi.fn(async () => media());

    const res = await GET(
      new Request("https://app.test/api/chat/media/no-es-uuid"),
      { params: Promise.resolve({ mensajeId: "no-es-uuid" }) },
      {
        getActor: async () => MENSAJERO,
        mensajeRepo: { findMediaParaMensajero },
        descargador,
      },
    );

    expect(res.status).toBe(403);
    expect(findMediaParaMensajero).not.toHaveBeenCalled();
    expect(descargador.descargar).not.toHaveBeenCalled();
  });

  it("un mensaje propio SIN adjunto responde 404, sin llamar a la Graph API", async () => {
    const descargador = descargadorOk();
    const res = await pedir({
      getActor: async () => MENSAJERO,
      mensajeRepo: { findMediaParaMensajero: vi.fn(async () => media({ mediaId: null })) },
      descargador,
    });

    expect(res.status).toBe(404);
    expect(descargador.descargar).not.toHaveBeenCalled();
  });
});

describe("GET /api/chat/media/[mensajeId] — caducidad (R24)", () => {
  it("media caducada responde 410 con { error: 'expirado' }, distinguible de un error", async () => {
    const res = await pedir({
      getActor: async () => MENSAJERO,
      mensajeRepo: { findMediaParaMensajero: vi.fn(async () => media()) },
      descargador: descargadorCon({ status: "expirado" }),
    });

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "expirado" });
  });

  it("un fallo real de la Graph API es 502, NO 410 (no se confunde con caducado)", async () => {
    const res = await pedir({
      getActor: async () => MENSAJERO,
      mensajeRepo: { findMediaParaMensajero: vi.fn(async () => media()) },
      descargador: descargadorCon({ status: "error", detalle: "HTTP 500" }),
    });

    expect(res.status).toBe(502);
  });
});

describe("GET /api/chat/media/[mensajeId] — descarga y sniffing (R25)", () => {
  it("?descarga=1 responde attachment con el filename saneado", async () => {
    const res = await pedir(
      {
        getActor: async () => MENSAJERO,
        mensajeRepo: {
          findMediaParaMensajero: vi.fn(async () =>
            media({ mediaMime: "application/pdf", mediaNombre: 'fac"tura\r\n/../.pdf' }),
          ),
        },
        descargador: descargadorOk("application/pdf"),
      },
      "?descarga=1",
    );

    const disposicion = res.headers.get("Content-Disposition") ?? "";
    expect(disposicion).toContain("attachment");
    expect(disposicion).not.toContain("\r");
    expect(disposicion).not.toContain("\n");
    expect(disposicion).not.toContain("/");
    expect(disposicion).not.toContain("..");
    expect(disposicion).toBe('attachment; filename="factura.pdf"');
  });

  it("un image/svg+xml sale como attachment + octet-stream + nosniff", async () => {
    const res = await pedir({
      getActor: async () => MENSAJERO,
      mensajeRepo: {
        findMediaParaMensajero: vi.fn(async () =>
          media({ mediaMime: "image/svg+xml", mediaNombre: "logo.svg" }),
        ),
      },
      descargador: descargadorOk("image/svg+xml"),
    });

    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="logo.svg"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("GET /api/chat/media/[mensajeId] — sin almacenamiento propio (R15/D1)", () => {
  // El handler hace PASSTHROUGH del stream. Si alguien mañana decide "cachear" el binario en
  // Supabase Storage o en disco, este assert lo delata en el PR: es la unica forma de que R15
  // sea una regla y no una intencion.
  const fuente = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "app", "api", "chat", "media", "[mensajeId]", "route.ts"),
    "utf8",
  );

  it("no importa ningun cliente de Storage ni escribe en disco", () => {
    expect(fuente).not.toMatch(/supabase/i);
    expect(fuente).not.toMatch(/\bstorage\b/i);
    expect(fuente).not.toMatch(/from\s+"fs"/);
    expect(fuente).not.toMatch(/writeFile/);
    expect(fuente).not.toMatch(/createWriteStream/);
  });

  it("no persiste el binario en la base: el handler no llama a ningun create/update", () => {
    expect(fuente).not.toMatch(/\.create\(/);
    expect(fuente).not.toMatch(/\.update\(/);
    expect(fuente).not.toMatch(/createMany/);
  });
});
