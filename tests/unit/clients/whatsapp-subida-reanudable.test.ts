import { describe, it, expect, vi } from "vitest";
import { WhatsappSubidaReanudableClient } from "@/lib/clients/whatsapp-subida-reanudable";

// Ficha 474 (T4.1, R5) — subida reanudable en dos pasos; el token nunca en URL ni en el error.

const TOKEN = "EAAG-secreto-xyz";
const config = { token: TOKEN, apiVersion: "v21.0" };
const input = { appId: "123", bytes: new Uint8Array([37, 80, 68, 70]), nombreArchivo: "ejemplo.pdf", mime: "application/pdf" as const };

function resp(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), { status });
}

describe("474/R5 — WhatsappSubidaReanudableClient", () => {
  it("dos pasos: sesion bajo /{appId}/uploads y binario con OAuth + file_offset 0", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(200, { id: "upload:ABC" }))
      .mockResolvedValueOnce(resp(200, { h: "4::HANDLE" }));
    const c = new WhatsappSubidaReanudableClient({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await c.subir(input)).toEqual({ status: "ok", handle: "4::HANDLE" });

    const [url1, init1] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url1).toBe(
      "https://graph.facebook.com/v21.0/123/uploads?file_name=ejemplo.pdf&file_length=4&file_type=application%2Fpdf",
    );
    expect((init1.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);

    const [url2, init2] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url2).toBe("https://graph.facebook.com/v21.0/upload:ABC");
    expect((init2.headers as Record<string, string>).Authorization).toBe(`OAuth ${TOKEN}`);
    expect((init2.headers as Record<string, string>).file_offset).toBe("0");
    for (const [u] of fetchImpl.mock.calls as [string][]) expect(u).not.toContain(TOKEN);
  });

  it("error de Meta 4xx -> rechazado con codigo, sin token en el detalle", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(resp(400, { error: { code: 100, message: `bad ${TOKEN}` } }));
    const c = new WhatsappSubidaReanudableClient({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await c.subir(input);
    expect(r).toEqual({ status: "rechazado", detalle: "subir documento de ejemplo a meta: HTTP 400 (Meta 100)", codigoMeta: 100 });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("5xx en el segundo paso -> error", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(resp(200, { id: "upload:X" })).mockResolvedValueOnce(resp(503, {}));
    const c = new WhatsappSubidaReanudableClient({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await c.subir(input)).status).toBe("error");
  });

  it("timeout/red -> error sin token", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    const c = new WhatsappSubidaReanudableClient({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await c.subir(input);
    expect(r).toEqual({ status: "error", detalle: "subir documento de ejemplo a meta: fallo de red o timeout" });
  });

  it("respuesta sin handle -> error", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(resp(200, { id: "upload:X" })).mockResolvedValueOnce(resp(200, {}));
    const c = new WhatsappSubidaReanudableClient({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await c.subir(input)).status).toBe("error");
  });
});
