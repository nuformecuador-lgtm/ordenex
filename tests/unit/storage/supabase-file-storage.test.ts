import { describe, it, expect, vi } from "vitest";
import { SupabaseFileStorage, type StorageClientLike } from "@/lib/storage/SupabaseFileStorage";
import { postulacionConfig } from "@/lib/config/postulacion";

// Feature 21 / R18: los documentos van a un bucket PRIVADO; nunca se genera URL
// publica. Se inyecta un cliente Storage falso para verificar sin red.

function buildStorage() {
  const upload = vi.fn().mockResolvedValue({ data: { path: "usr/cedula_anverso.jpg" }, error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const getPublicUrl = vi.fn();
  const from = vi.fn().mockReturnValue({ upload, remove, getPublicUrl });
  const client: StorageClientLike = { from } as unknown as StorageClientLike;
  return { client, from, upload, remove, getPublicUrl };
}

describe("SupabaseFileStorage (R18)", () => {
  it("sube al bucket privado configurado con upsert:false y contentType", async () => {
    const { client, from, upload } = buildStorage();
    const storage = new SupabaseFileStorage(client);

    const path = await storage.upload({
      path: "usr/cedula_anverso.jpg",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    });

    expect(path).toBe("usr/cedula_anverso.jpg");
    expect(from).toHaveBeenCalledWith(postulacionConfig.BUCKET);
    expect(upload).toHaveBeenCalledWith(
      "usr/cedula_anverso.jpg",
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "image/jpeg", upsert: false }),
    );
  });

  it("R18: nunca solicita una URL publica del objeto", async () => {
    const { client, getPublicUrl } = buildStorage();
    const storage = new SupabaseFileStorage(client);
    await storage.upload({
      path: "usr/foto.jpg",
      bytes: new Uint8Array([1]),
      contentType: "image/jpeg",
    });
    expect(getPublicUrl).not.toHaveBeenCalled();
  });

  it("lanza si el backend devuelve error en la subida", async () => {
    const { client, from } = buildStorage();
    from.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
      remove: vi.fn(),
    });
    const storage = new SupabaseFileStorage(client);
    await expect(
      storage.upload({ path: "x", bytes: new Uint8Array([1]), contentType: "image/png" }),
    ).rejects.toThrow(/fallo al subir/);
  });

  it("remove no lanza con lista vacia y delega al backend con paths", async () => {
    const { client, remove } = buildStorage();
    const storage = new SupabaseFileStorage(client);
    await storage.remove([]);
    expect(remove).not.toHaveBeenCalled();
    await storage.remove(["a", "b"]);
    expect(remove).toHaveBeenCalledWith(["a", "b"]);
  });
});
