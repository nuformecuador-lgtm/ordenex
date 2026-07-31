import { describe, it, expect, vi } from "vitest";
import {
  SupabaseSignedUrlProvider,
  type SignedUrlClientLike,
} from "@/lib/storage/SupabaseSignedUrlProvider";
import { postulacionConfig } from "@/lib/config/postulacion";

// Feature 22 / R8/R9: firma URLs temporales del bucket privado. Cliente falso
// para verificar path/ttl y manejo de error sin red.

function buildClient() {
  const createSignedUrl = vi
    .fn()
    .mockResolvedValue({ data: { signedUrl: "https://signed/one" }, error: null });
  const createSignedUrls = vi.fn().mockImplementation(async (paths: string[]) => ({
    data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}`, error: null })),
    error: null,
  }));
  const from = vi.fn().mockReturnValue({ createSignedUrl, createSignedUrls });
  const client: SignedUrlClientLike = { from } as unknown as SignedUrlClientLike;
  return { client, from, createSignedUrl, createSignedUrls };
}

describe("SupabaseSignedUrlProvider (R8/R9)", () => {
  it("firma una URL con el bucket privado y el ttl indicado", async () => {
    const { client, from, createSignedUrl } = buildClient();
    const provider = new SupabaseSignedUrlProvider(client);

    const url = await provider.createSignedUrl("usr-1/cedula_anverso.jpg", 300);

    expect(url).toBe("https://signed/one");
    expect(from).toHaveBeenCalledWith(postulacionConfig.BUCKET);
    expect(createSignedUrl).toHaveBeenCalledWith("usr-1/cedula_anverso.jpg", 300);
  });

  it("firma varias URLs en batch y devuelve mapa path->url con el ttl", async () => {
    const { client, createSignedUrls } = buildClient();
    const provider = new SupabaseSignedUrlProvider(client);

    const map = await provider.createSignedUrls(["a.jpg", "b.jpg"], 120);

    expect(createSignedUrls).toHaveBeenCalledWith(["a.jpg", "b.jpg"], 120);
    expect(map).toEqual({ "a.jpg": "https://signed/a.jpg", "b.jpg": "https://signed/b.jpg" });
  });

  it("batch vacio no llama al backend", async () => {
    const { client, createSignedUrls } = buildClient();
    const provider = new SupabaseSignedUrlProvider(client);
    const map = await provider.createSignedUrls([], 300);
    expect(map).toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("lanza con contexto si el backend devuelve error al firmar una URL", async () => {
    const { client, from } = buildClient();
    from.mockReturnValue({
      createSignedUrl: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
      createSignedUrls: vi.fn(),
    });
    const provider = new SupabaseSignedUrlProvider(client);
    await expect(provider.createSignedUrl("x", 300)).rejects.toThrow(/fallo al firmar/);
  });

  // El batch devuelve un resultado PARCIAL: la entrada que el storage no pudo firmar se
  // omite. Antes lanzaba, y un solo objeto perdido tumbaba a quien pidiera el lote entero:
  // asi se quedo un cierre de dia sin poder abrirse (produccion, 2026-07-29) y, con el,
  // bloqueadas las asignaciones de la zona de ese mensajero. Quien consume el mapa ya
  // resuelve la ausencia con `?? null`, porque un documento puede faltar por diseño.
  it("una entrada con error se OMITE del mapa, sin tumbar el resto del batch", async () => {
    const { client, from } = buildClient();
    from.mockReturnValue({
      createSignedUrl: vi.fn(),
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [
          { path: "a.jpg", signedUrl: "", error: "not found" },
          { path: "b.jpg", signedUrl: "https://signed/b.jpg", error: null },
        ],
        error: null,
      }),
    });
    const provider = new SupabaseSignedUrlProvider(client);

    const map = await provider.createSignedUrls(["a.jpg", "b.jpg"], 300);

    expect(map).toEqual({ "b.jpg": "https://signed/b.jpg" });
  });

  it("un batch entero fallido devuelve mapa vacio, no una excepcion por entrada", async () => {
    const { client, from } = buildClient();
    from.mockReturnValue({
      createSignedUrl: vi.fn(),
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [{ path: "a.jpg", signedUrl: "", error: "not found" }],
        error: null,
      }),
    });
    const provider = new SupabaseSignedUrlProvider(client);

    expect(await provider.createSignedUrls(["a.jpg"], 300)).toEqual({});
  });

  // El error GLOBAL (credencial ausente, storage caido) sigue lanzando: no es "falta este
  // objeto", es "no se pudo preguntar". Quien lo necesite best-effort lo decide arriba.
  it("un error global del backend SI lanza (distinto de una entrada fallida)", async () => {
    const { client, from } = buildClient();
    from.mockReturnValue({
      createSignedUrl: vi.fn(),
      createSignedUrls: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "supabaseUrl is required" } }),
    });
    const provider = new SupabaseSignedUrlProvider(client);

    await expect(provider.createSignedUrls(["a.jpg"], 300)).rejects.toThrow(/fallo al firmar/);
  });
});
