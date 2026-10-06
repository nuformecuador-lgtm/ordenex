import { describe, it, expect, vi } from "vitest";
import {
  SupabaseAlmacenEnviosWhatsapp,
  type EnviosStorageClientLike,
} from "@/lib/storage/SupabaseAlmacenEnviosWhatsapp";

// Ficha 474 (T4.2, R43/R44) — almacen privado de los PDFs: ruta por ejecucion, nunca sobrescribe,
// bucket privado creado en el primer uso, firmado, y `borrar` propaga el error.

function doble(over: Partial<ReturnType<EnviosStorageClientLike["from"]>> = {}, createBucket = vi.fn(async () => ({ data: {}, error: null }))) {
  const api = {
    upload: vi.fn(async (path: string) => ({ data: { path }, error: null })),
    download: vi.fn(async () => ({ data: new Blob([new Uint8Array([1, 2])]), error: null })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://firmado" }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    ...over,
  };
  const from = vi.fn(() => api);
  const client = { from, createBucket } as unknown as EnviosStorageClientLike;
  return { client, api, from, createBucket };
}

describe("474/R43 — guardar", () => {
  it("ruta <envioId>/<ejecucionId>.pdf, upsert false, content type pdf, bucket configurado", async () => {
    const d = doble();
    const a = new SupabaseAlmacenEnviosWhatsapp(d.client, "whatsapp-envios");
    expect(await a.guardar("env-1", "eje-1", new Uint8Array([1]))).toEqual({ ruta: "env-1/eje-1.pdf" });
    expect(d.from).toHaveBeenCalledWith("whatsapp-envios");
    expect(d.api.upload).toHaveBeenCalledWith("env-1/eje-1.pdf", expect.any(Uint8Array), {
      contentType: "application/pdf",
      upsert: false,
    });
  });

  it("bucket inexistente: lo crea PRIVADO y reintenta una vez", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "Bucket not found", statusCode: "404" } })
      .mockResolvedValueOnce({ data: { path: "p" }, error: null });
    const d = doble({ upload });
    const a = new SupabaseAlmacenEnviosWhatsapp(d.client, "b");
    await a.guardar("e", "x", new Uint8Array([1]));
    expect(d.createBucket).toHaveBeenCalledWith("b", { public: false });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("un objeto existente NO se sobrescribe: el conflicto lanza", async () => {
    const upload = vi.fn(async () => ({ data: null, error: { message: "The resource already exists", statusCode: "409" } }));
    const d = doble({ upload });
    const a = new SupabaseAlmacenEnviosWhatsapp(d.client, "b");
    await expect(a.guardar("e", "x", new Uint8Array([1]))).rejects.toThrow(/ya estaba guardado/);
  });
});

describe("474/R43 — firmar y leer", () => {
  it("firma con el TTL pedido", async () => {
    const d = doble();
    const a = new SupabaseAlmacenEnviosWhatsapp(d.client, "b");
    expect(await a.firmar("e/x.pdf", 300)).toBe("https://firmado");
    expect(d.api.createSignedUrl).toHaveBeenCalledWith("e/x.pdf", 300);
  });

  it("leer devuelve los bytes", async () => {
    const d = doble();
    const a = new SupabaseAlmacenEnviosWhatsapp(d.client, "b");
    expect(Array.from(await a.leer("e/x.pdf"))).toEqual([1, 2]);
  });
});

describe("474/R44 — borrar", () => {
  it("propaga el error del SDK", async () => {
    const d = doble({ remove: vi.fn(async () => ({ data: null, error: { message: "boom" } })) });
    const a = new SupabaseAlmacenEnviosWhatsapp(d.client, "b");
    await expect(a.borrar(["e/x.pdf"])).rejects.toThrow(/boom/);
  });

  it("lista vacia: no llama al SDK", async () => {
    const d = doble();
    const a = new SupabaseAlmacenEnviosWhatsapp(d.client, "b");
    await a.borrar([]);
    expect(d.api.remove).not.toHaveBeenCalled();
  });
});
