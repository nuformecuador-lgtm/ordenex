import { describe, it, expect, vi, beforeEach } from "vitest";

// El cliente real NUNCA se construye en este archivo: el `.env` local apunta Storage a PRODUCCION.
// Si algun camino llegase a `createServerClient`, este mock lo delata.
const createServerClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createServerClient }));

import {
  SupabaseAlmacenDescargas,
  type AlmacenStorageClientLike,
  type ObjetoListado,
} from "@/lib/storage/SupabaseAlmacenDescargas";
import { BUCKETS } from "@/lib/storage/buckets";

// Ficha 470 (T2.2, R9/R10/R14/R17) — el almacen de los objetos temporales, con un DOBLE de Storage.

const UUID_V4 = /^tmp\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json\.gz$/;

type Err = { message: string; statusCode?: string; status?: number } | null;

function doble(opciones: {
  upload?: Array<Err>;
  createBucket?: Err;
  firmar?: { url?: string; error?: Err };
  objetos?: ObjetoListado[];
  listError?: Err;
  removeError?: Err;
} = {}) {
  const colaUpload = [...(opciones.upload ?? [])];
  let objetos = [...(opciones.objetos ?? [])];
  const upload = vi.fn(async (path: string) => {
    const error = colaUpload.length ? colaUpload.shift()! : null;
    return error ? { data: null, error } : { data: { path }, error: null };
  });
  const createSignedUrl = vi.fn(async (path: string, ttl: number) =>
    opciones.firmar?.error
      ? { data: null, error: opciones.firmar.error }
      : { data: { signedUrl: opciones.firmar?.url ?? `https://x.supabase.co/storage/v1/object/sign/descargas/${path}?token=t&ttl=${ttl}` }, error: null },
  );
  const list = vi.fn(async (_path: string, o?: { limit?: number }) => {
    if (opciones.listError) return { data: null, error: opciones.listError };
    const orden = [...objetos].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    return { data: orden.slice(0, o?.limit ?? 100), error: null };
  });
  const remove = vi.fn(async (paths: string[]) => {
    if (opciones.removeError) return { data: null, error: opciones.removeError };
    objetos = objetos.filter((o) => !paths.includes(`tmp/${o.name}`));
    return { data: [], error: null };
  });
  const createBucket = vi.fn(async () => ({ data: null, error: opciones.createBucket ?? null }));
  const from = vi.fn(() => ({ upload, createSignedUrl, list, remove }));
  const cliente: AlmacenStorageClientLike = { from, createBucket };
  return { cliente, from, upload, createSignedUrl, list, remove, createBucket, restantes: () => objetos };
}

beforeEach(() => createServerClient.mockReset());

describe("guardar · ruta y subida (R9)", () => {
  it("BUCKETS.DESCARGAS es «descargas» y es el bucket por defecto", async () => {
    expect(BUCKETS.DESCARGAS).toBe("descargas");
    const d = doble();
    await new SupabaseAlmacenDescargas(d.cliente).guardar(new Uint8Array([1]));
    expect(d.from).toHaveBeenCalledWith("descargas");
  });

  it("ruta = tmp/<uuid v4>.json.gz, sin nada mas; dos llamadas ⇒ dos rutas distintas", async () => {
    const d = doble();
    const almacen = new SupabaseAlmacenDescargas(d.cliente);
    const a = await almacen.guardar(new Uint8Array([1]));
    const b = await almacen.guardar(new Uint8Array([2]));
    expect(a.ruta).toMatch(UUID_V4);
    expect(b.ruta).toMatch(UUID_V4);
    expect(a.ruta).not.toBe(b.ruta);
  });

  it("sube con upsert: false y contentType application/gzip, los bytes tal cual", async () => {
    const d = doble();
    const bytes = new Uint8Array([31, 139, 8]);
    const { ruta } = await new SupabaseAlmacenDescargas(d.cliente).guardar(bytes);
    expect(d.upload).toHaveBeenCalledWith(ruta, bytes, { contentType: "application/gzip", upsert: false });
  });

  it("un error de subida que no es «bucket no existe» lanza con contexto y NO crea bucket", async () => {
    const d = doble({ upload: [{ message: "Payload too large", statusCode: "413" }] });
    await expect(new SupabaseAlmacenDescargas(d.cliente).guardar(new Uint8Array([1]))).rejects.toThrow(
      /fallo al subir la descarga temporal: Payload too large/,
    );
    expect(d.createBucket).not.toHaveBeenCalled();
    expect(d.upload).toHaveBeenCalledTimes(1);
  });
});

describe("guardar · bucket inexistente (R14)", () => {
  it("«Bucket not found» ⇒ createBucket PRIVADO y UN reintento con la misma ruta", async () => {
    const d = doble({ upload: [{ message: "Bucket not found", statusCode: "404", status: 400 }] });
    const { ruta } = await new SupabaseAlmacenDescargas(d.cliente).guardar(new Uint8Array([1]));
    expect(d.createBucket).toHaveBeenCalledWith("descargas", { public: false });
    expect(d.upload).toHaveBeenCalledTimes(2);
    expect(d.upload.mock.calls[1][0]).toBe(ruta);
  });

  it("un 404 sin el texto tambien cuenta como bucket inexistente", async () => {
    const d = doble({ upload: [{ message: "x", statusCode: "404" }] });
    await new SupabaseAlmacenDescargas(d.cliente).guardar(new Uint8Array([1]));
    expect(d.createBucket).toHaveBeenCalledTimes(1);
  });

  it("«already exists» al crear se tolera (carrera entre dos descargas)", async () => {
    const d = doble({
      upload: [{ message: "Bucket not found", statusCode: "404" }],
      createBucket: { message: "The resource already exists", statusCode: "409" },
    });
    await expect(new SupabaseAlmacenDescargas(d.cliente).guardar(new Uint8Array([1]))).resolves.toMatchObject({
      ruta: expect.stringMatching(UUID_V4),
    });
    expect(d.upload).toHaveBeenCalledTimes(2);
  });

  it("otro error al crear el bucket lanza sin reintentar", async () => {
    const d = doble({ upload: [{ message: "Bucket not found" }], createBucket: { message: "permiso denegado" } });
    await expect(new SupabaseAlmacenDescargas(d.cliente).guardar(new Uint8Array([1]))).rejects.toThrow(/crear el bucket/);
    expect(d.upload).toHaveBeenCalledTimes(1);
  });

  it("si el reintento vuelve a fallar, lanza (no hay un tercer intento)", async () => {
    const d = doble({ upload: [{ message: "Bucket not found" }, { message: "Bucket not found" }] });
    await expect(new SupabaseAlmacenDescargas(d.cliente).guardar(new Uint8Array([1]))).rejects.toThrow(/fallo al subir/);
    expect(d.upload).toHaveBeenCalledTimes(2);
    expect(d.createBucket).toHaveBeenCalledTimes(1);
  });
});

describe("firmar (R10)", () => {
  it("llama a createSignedUrl con la ruta y el TTL recibidos y devuelve la URL", async () => {
    const d = doble({ firmar: { url: "https://firmada" } });
    const url = await new SupabaseAlmacenDescargas(d.cliente).firmar("tmp/a.json.gz", 300);
    expect(d.createSignedUrl).toHaveBeenCalledWith("tmp/a.json.gz", 300);
    expect(url).toBe("https://firmada");
  });

  it("nunca pide una URL publica: el cliente ni la expone ni se llama", async () => {
    const d = doble();
    const getPublicUrl = vi.fn();
    d.from.mockImplementation(() => ({ upload: d.upload, createSignedUrl: d.createSignedUrl, list: d.list, remove: d.remove, getPublicUrl }) as never);
    const almacen = new SupabaseAlmacenDescargas(d.cliente);
    const { ruta } = await almacen.guardar(new Uint8Array([1]));
    await almacen.firmar(ruta, 300);
    expect(getPublicUrl).not.toHaveBeenCalled();
  });

  it("error del SDK al firmar ⇒ lanza con contexto", async () => {
    const d = doble({ firmar: { error: { message: "Object not found" } } });
    await expect(new SupabaseAlmacenDescargas(d.cliente).firmar("tmp/a.json.gz", 300)).rejects.toThrow(
      /fallo al firmar la descarga temporal: Object not found/,
    );
  });
});

function obj(n: number, minuto: number): ObjetoListado {
  return { name: `id-${String(n).padStart(4, "0")}.json.gz`, id: `uuid-${n}`, created_at: new Date(Date.UTC(2026, 9, 2, 10, minuto)).toISOString() };
}
const CORTE = new Date(Date.UTC(2026, 9, 2, 10, 30));

describe("purgarAnterioresA (R17)", () => {
  it("borra SOLO los creados antes del corte y conserva los recientes", async () => {
    const d = doble({ objetos: [obj(1, 0), obj(2, 29), obj(3, 30), obj(4, 45)] });
    const r = await new SupabaseAlmacenDescargas(d.cliente).purgarAnterioresA(CORTE, 5000);
    expect(r).toEqual({ borrados: 2, quedaPendiente: false });
    expect(d.restantes().map((o) => o.name)).toEqual(["id-0003.json.gz", "id-0004.json.gz"]);
    expect(d.remove).toHaveBeenCalledWith(["tmp/id-0001.json.gz", "tmp/id-0002.json.gz"]);
    expect(d.list).toHaveBeenCalledWith("tmp", { limit: 1000, offset: 0, sortBy: { column: "created_at", order: "asc" } });
  });

  it("pagina: 2.500 objetos viejos se borran en varias vueltas", async () => {
    const d = doble({ objetos: Array.from({ length: 2500 }, (_, i) => obj(i, 0)) });
    const r = await new SupabaseAlmacenDescargas(d.cliente).purgarAnterioresA(CORTE, 5000);
    expect(r).toEqual({ borrados: 2500, quedaPendiente: false });
    expect(d.restantes()).toHaveLength(0);
    expect(d.remove).toHaveBeenCalledTimes(3);
  });

  it("respeta `maximo` y avisa de que queda trabajo", async () => {
    const d = doble({ objetos: Array.from({ length: 12 }, (_, i) => obj(i, 0)) });
    const r = await new SupabaseAlmacenDescargas(d.cliente).purgarAnterioresA(CORTE, 5);
    expect(r).toEqual({ borrados: 5, quedaPendiente: true });
    expect(d.restantes()).toHaveLength(7);
  });

  it("con `maximo` exacto y nada mas viejo detras, no queda pendiente", async () => {
    const d = doble({ objetos: [obj(1, 0), obj(2, 1), obj(3, 50)] });
    expect(await new SupabaseAlmacenDescargas(d.cliente).purgarAnterioresA(CORTE, 2)).toEqual({ borrados: 2, quedaPendiente: false });
  });

  it("ignora las carpetas (id null) y los objetos sin fecha", async () => {
    const d = doble({ objetos: [{ name: "sub", id: null, created_at: null }, { name: "x.json.gz", id: "u", created_at: null }, obj(1, 0)] });
    const r = await new SupabaseAlmacenDescargas(d.cliente).purgarAnterioresA(CORTE, 5000);
    expect(r.borrados).toBe(1);
    expect(d.remove).toHaveBeenCalledWith(["tmp/id-0001.json.gz"]);
  });

  it("bucket inexistente ⇒ 0 borrados, no es error", async () => {
    const d = doble({ listError: { message: "Bucket not found", statusCode: "404" } });
    expect(await new SupabaseAlmacenDescargas(d.cliente).purgarAnterioresA(CORTE, 5000)).toEqual({ borrados: 0, quedaPendiente: false });
    expect(d.remove).not.toHaveBeenCalled();
  });

  it("error del SDK en remove ⇒ LANZA (no falla en silencio)", async () => {
    const d = doble({ objetos: [obj(1, 0)], removeError: { message: "boom" } });
    await expect(new SupabaseAlmacenDescargas(d.cliente).purgarAnterioresA(CORTE, 5000)).rejects.toThrow(/borrar.*boom/);
  });

  it("error del SDK en list (que no es bucket inexistente) ⇒ lanza", async () => {
    const d = doble({ listError: { message: "timeout", statusCode: "500" } });
    await expect(new SupabaseAlmacenDescargas(d.cliente).purgarAnterioresA(CORTE, 5000)).rejects.toThrow(/listar.*timeout/);
  });
});

describe("cliente perezoso (K1)", () => {
  it("construir la clase sin cliente inyectado NO llama a createServerClient", () => {
    new SupabaseAlmacenDescargas();
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
