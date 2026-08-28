import { describe, it, expect, vi, type Mock } from "vitest";
import fs from "fs";
import path from "path";
import { GET } from "@/app/api/chat/media/[mensajeId]/route";
import type { ChatMediaRouteDeps } from "@/app/api/chat/media/[mensajeId]/route";
import type { WhatsappMediaOutcome } from "@/lib/clients/whatsapp-media";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ChatMediaAutorizada } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { PrismaClient } from "@prisma/client";
import { ChatMensajeRepository } from "@/lib/repositories/ChatMensajeRepository";

// Feature 311 — F3.T (R15/R21/R22/R23/R24/R25). El proxy de media.
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

  it("un filename con CJK y emoji responde 200 (no 500) y conserva el nombre en filename*", async () => {
    // REGRESION (revision 311, B4): el nombre se interpolaba CRUDO en `Content-Disposition`, y
    // una cabecera HTTP es una ByteString -> `new Headers({...})` lanzaba
    // «Cannot convert argument to a ByteString ... value 22577 which is greater than 255» y el
    // handler moria con 500 EN VEZ de entregar el archivo. Los acentos del español caen dentro
    // de Latin-1, por eso solo se veia con CJK/emoji. La salida es RFC 5987/6266.
    const res = await pedir(
      {
        getActor: async () => MENSAJERO,
        mensajeRepo: {
          findMediaParaMensajero: vi.fn(async () =>
            media({ mediaMime: "application/pdf", mediaNombre: "报告 final 🎉.pdf" }),
          ),
        },
        descargador: descargadorOk("application/pdf"),
      },
      "?descarga=1",
    );

    expect(res.status).toBe(200);
    const disposicion = res.headers.get("Content-Disposition") ?? "";
    expect(disposicion).toContain("attachment");
    expect(disposicion).toContain("filename*=UTF-8''");
    const codificado = disposicion.split("filename*=UTF-8''")[1] as string;
    expect(decodeURIComponent(codificado)).toBe("报告 final 🎉.pdf");
    // El binario sigue saliendo: el fallo era en la construccion de la respuesta, no antes.
    expect(await res.text()).toBe("BINARIO");
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

// ---------------------------------------------------------------------------------------------
// Feature 316 — F2 (R24/R25). El proxy sirve un adjunto SALIENTE **sin un solo cambio**.
//
// La premisa del design §6.4 de la 316 es que `findMediaParaMensajero` autoriza por
// `orden.mensajero_asignado_id` y NO filtra por `direccion`, asi que un mensaje propio del
// mensajero se sirve por la misma ruta que los entrantes de la 311. Este bloque la convierte en
// un ASSERT, y lo hace por dos vias para que no sea tautologico:
//
//   1) La ruta, con un doble del repositorio que reproduce la semantica REAL de la query
//      (casa por id de mensaje y por mensajero asignado, y NADA MAS: no mira la direccion).
//   2) La query de verdad: se instancia el `ChatMensajeRepository` REAL con un `$queryRaw`
//      espiado y se asserta que el SQL no menciona `direccion` en ninguna forma. Sin este
//      segundo assert, el doble del punto 1 solo estaria probandose a si mismo.
//
// Si algun dia alguien acota el proxy a los entrantes, el punto 2 lo delata en el PR.

const OTRO_MENSAJERO: Actor = { usuarioId: "men-2", rol: "mensajero", zonaId: null };
const MEDIA_ID_SALIENTE = "MEDIA-SALIENTE-777";

/** Fila tal y como quedaria en la base tras enviar una foto desde el chat (316, R17). */
const FILA_SALIENTE = {
  mensajeId: MENSAJE_ID,
  direccion: "saliente" as const,
  tipo: "imagen" as const,
  mediaId: MEDIA_ID_SALIENTE,
  mediaMime: "image/jpeg",
  mediaNombre: "foto-que-envie.jpg",
  ordenId: "orden-1",
  mensajeroAsignadoId: MENSAJERO.usuarioId,
};

/**
 * Doble FIEL a la query real: autoriza por (id del mensaje, mensajero asignado a la orden) y
 * **no** consulta `direccion`. La fidelidad la sostiene el ultimo `describe` de este archivo.
 */
function repoComoLaQueryReal(fila = FILA_SALIENTE) {
  return {
    findMediaParaMensajero: vi.fn(
      async (mensajeId: string, mensajeroId: string): Promise<ChatMediaAutorizada | null> => {
        if (mensajeId !== fila.mensajeId) return null;
        if (mensajeroId !== fila.mensajeroAsignadoId) return null;
        return {
          mediaId: fila.mediaId,
          mediaMime: fila.mediaMime,
          mediaNombre: fila.mediaNombre,
          ordenId: fila.ordenId,
        };
      },
    ),
  };
}

describe("316 / F2 — el proxy sirve un adjunto SALIENTE sin cambios (R24)", () => {
  it("200 con el binario para el mensajero asignado, con las mismas cabeceras que un entrante", async () => {
    const descargador = descargadorOk();
    const res = await pedir({
      getActor: async () => MENSAJERO,
      mensajeRepo: repoComoLaQueryReal(),
      descargador,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect(await res.text()).toBe("BINARIO");
    // El adjunto propio se baja de Meta igual que el del cliente: mismo `media_id`, mismo camino.
    expect(descargador.descargar).toHaveBeenCalledWith(MEDIA_ID_SALIENTE);
  });

  it("403 para OTRO mensajero, sin tocar la Graph API (la puerta es la orden, no la direccion)", async () => {
    const descargador = descargadorOk();
    const repo = repoComoLaQueryReal();

    const res = await pedir({
      getActor: async () => OTRO_MENSAJERO,
      mensajeRepo: repo,
      descargador,
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(repo.findMediaParaMensajero).toHaveBeenCalledWith(MENSAJE_ID, OTRO_MENSAJERO.usuarioId);
    expect(descargador.descargar).not.toHaveBeenCalled();
  });

  it("R25: 410 cuando el binario propio ya caduco en Meta (30 dias), no 502", async () => {
    const res = await pedir({
      getActor: async () => MENSAJERO,
      mensajeRepo: repoComoLaQueryReal(),
      descargador: descargadorCon({ status: "expirado" }),
    });

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "expirado" });
  });

  it("el media id de Meta no sale ni en las cabeceras ni en el cuerpo del saliente", async () => {
    const res = await pedir({
      getActor: async () => MENSAJERO,
      mensajeRepo: repoComoLaQueryReal(),
      descargador: descargadorOk(),
    });

    const cabeceras = JSON.stringify([...res.headers.entries()]);
    expect(cabeceras).not.toContain(MEDIA_ID_SALIENTE);
    expect(await res.text()).not.toContain(MEDIA_ID_SALIENTE);
  });

  it("tampoco se filtra en el cuerpo de los desenlaces de error del saliente (410 y 502)", async () => {
    for (const outcome of [
      { status: "expirado" } as const,
      { status: "error", detalle: "HTTP 500" } as const,
    ]) {
      const res = await pedir({
        getActor: async () => MENSAJERO,
        mensajeRepo: repoComoLaQueryReal(),
        descargador: descargadorCon(outcome),
      });
      expect(await res.text()).not.toContain(MEDIA_ID_SALIENTE);
    }
  });
});

describe("316 / F2 — la premisa: la autorizacion NO filtra por direccion", () => {
  it("el SQL real de findMediaParaMensajero no menciona la direccion del mensaje", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const repo = new ChatMensajeRepository({ $queryRaw: queryRaw } as unknown as PrismaClient);

    await repo.findMediaParaMensajero(MENSAJE_ID, MENSAJERO.usuarioId);

    const arg = queryRaw.mock.calls[0][0] as { strings: readonly string[]; values: unknown[] };
    const texto = arg.strings.join("?");
    // La puerta es la orden asignada...
    expect(texto).toContain("o.mensajero_asignado_id");
    // ...y NADA sobre quien mando el mensaje: por eso el saliente se sirve sin cambiar el proxy.
    expect(texto).not.toMatch(/direccion/i);
    expect(texto).not.toMatch(/entrante/i);
    expect(texto).not.toMatch(/saliente/i);
    expect(arg.values).toContain(MENSAJERO.usuarioId);
  });

  it("el route handler tampoco mira la direccion en ninguna rama", () => {
    const fuenteRoute = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "app", "api", "chat", "media", "[mensajeId]", "route.ts"),
      "utf8",
    );
    expect(fuenteRoute).not.toMatch(/direccion/i);
  });
});
