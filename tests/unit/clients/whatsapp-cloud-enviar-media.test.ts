import { describe, it, expect, vi } from "vitest";
import { WhatsappCloudClient } from "@/lib/clients/whatsapp-cloud";
import type { WhatsappConfig } from "@/lib/config/whatsapp";

// Feature 316 — B2.T (R5/R6/R17). `enviarMedia` SI reusa el `enviar()` privado (es JSON, misma
// URL `/messages`, mismo manejo de transitorio/permanente). Lo que se prueba aqui es el CUERPO
// que se serializa, porque cada una de sus tres reglas produce un 400 de Meta si se equivoca:
// el pie en audio, el `filename` fuera de documento y la clave del objeto segun el tipo.

const CONFIG: WhatsappConfig = {
  token: "TOKEN-DE-PRUEBA",
  numeroId: "num-1",
  wabaId: "waba-1",
  apiVersion: "v21.0",
  templateCategoria: "UTILITY",
  templateIdioma: "es",
};

const DESTINO = "573001112233";

/** Captura el cuerpo JSON serializado que viaja a la Graph API. */
function clienteQueCaptura(status = 200, body: unknown = { messages: [{ id: "wamid.M1" }] }) {
  const cuerpos: Record<string, unknown>[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const client = new WhatsappCloudClient({ config: CONFIG, fetchImpl, timeoutMs: 50 });
  return { client, cuerpos };
}

describe("WhatsappCloudClient.enviarMedia — cuerpo serializado (R5/R6/R17)", () => {
  it("(a) imagen con pie: {type:'image', image:{id, caption}}", async () => {
    const { client, cuerpos } = clienteQueCaptura();

    const outcome = await client.enviarMedia(DESTINO, "image", "MEDIA-1", {
      caption: "aqui esta tu paquete",
    });

    expect(outcome).toEqual({ status: "ok", mensajeId: "wamid.M1" });
    expect(cuerpos[0]).toEqual({
      messaging_product: "whatsapp",
      to: DESTINO,
      type: "image",
      image: { id: "MEDIA-1", caption: "aqui esta tu paquete" },
    });
  });

  it("(b) R6: en audio NO existe la clave caption aunque se pase", async () => {
    const { client, cuerpos } = clienteQueCaptura();

    await client.enviarMedia(DESTINO, "audio", "MEDIA-2", { caption: "esto no debe viajar" });

    const audio = cuerpos[0].audio as Record<string, unknown>;
    expect(audio.caption).toBeUndefined();
    expect(audio).toEqual({ id: "MEDIA-2" });
    // Y el texto del mensajero no se cuela por ninguna otra clave.
    expect(JSON.stringify(cuerpos[0])).not.toContain("esto no debe viajar");
  });

  it("(c) documento: {document:{id, filename, caption}}", async () => {
    const { client, cuerpos } = clienteQueCaptura();

    await client.enviarMedia(DESTINO, "document", "MEDIA-3", {
      caption: "la factura",
      filename: "factura.pdf",
    });

    expect(cuerpos[0].document).toEqual({
      id: "MEDIA-3",
      caption: "la factura",
      filename: "factura.pdf",
    });
  });

  it("el filename NO viaja fuera de documento (Meta lo ignora y ensucia el volcado)", async () => {
    const { client, cuerpos } = clienteQueCaptura();

    await client.enviarMedia(DESTINO, "video", "MEDIA-4", { filename: "video.mp4" });

    expect(cuerpos[0].video).toEqual({ id: "MEDIA-4" });
  });

  it("un pie vacio o solo con espacios no viaja como caption", async () => {
    const { client, cuerpos } = clienteQueCaptura();

    await client.enviarMedia(DESTINO, "image", "MEDIA-5", { caption: "   " });
    await client.enviarMedia(DESTINO, "image", "MEDIA-6");

    expect(cuerpos[0].image).toEqual({ id: "MEDIA-5" });
    expect(cuerpos[1].image).toEqual({ id: "MEDIA-6" });
  });
});

describe("WhatsappCloudClient.enviarMedia — desenlaces, igual que enviarTexto (d)", () => {
  it("(d) un 400 es `permanente` con el codigo de Meta", async () => {
    const { client } = clienteQueCaptura(400, { error: { code: 131_053, message: "media bad" } });

    const outcome = await client.enviarMedia(DESTINO, "image", "MEDIA-1");
    expect(outcome.status).toBe("permanente");
    if (outcome.status === "permanente") expect(outcome.codigoMeta).toBe(131_053);
  });

  it("(d) un 503 es `transitorio`", async () => {
    const { client } = clienteQueCaptura(503, { error: { code: 2 } });

    expect((await client.enviarMedia(DESTINO, "image", "MEDIA-1")).status).toBe("transitorio");
  });
});
