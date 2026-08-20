import { describe, expect, it, vi } from "vitest";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import {
  compensarEvidencias,
  subirEvidenciasCompensadas,
} from "@/lib/services/evidencias-compensadas";

// Feature 237 (T4.1, D5, R15/R16/R17) — el modulo EXTRAIDO de la subida compensada.
//
// Lo que se prueba aqui es la CONDUCTA que las dos copias de origen tenian y que la 237 no puede
// permitirse perder: subida secuencial, indices 0..N-1 en orden, y compensacion exacta de lo ya
// subido ante cualquier fallo. Si esto se rompe, quedan archivos huerfanos en un bucket privado
// que nadie vuelve a mirar.
//
// El doble de `IFileStorage` no toca red: `upload` devuelve el path que recibe (como hace el
// Supabase real) y `remove` cuenta llamadas.

function fakeStorage(overrides: Partial<IFileStorage> = {}): IFileStorage {
  return {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
    ...overrides,
  };
}

function fotos(n: number) {
  return Array.from({ length: n }, (_v, i) => ({
    contentType: "image/jpeg",
    bytes: new Uint8Array([i]),
  }));
}

const ENTRADA = { ordenId: "o1", prefijo: "rechazada-" };

describe("subirEvidenciasCompensadas — el camino feliz (R17)", () => {
  it("sube las N en orden y devuelve N paths con indices 0..N-1", async () => {
    const storage = fakeStorage();
    const { paths, evidencias } = await subirEvidenciasCompensadas(storage, {
      ...ENTRADA,
      evidencias: fotos(3),
    });

    expect(storage.upload).toHaveBeenCalledTimes(3);
    expect(paths).toHaveLength(3);
    expect(evidencias.map((e) => e.indice)).toEqual([0, 1, 2]);
    // El indice es la POSICION de llegada, y de ahi sale la portada denormalizada (119/R12): si el
    // orden se perdiera, la foto de portada seria otra.
    expect(evidencias.map((e) => e.storagePath)).toEqual(paths);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("el path lleva la orden, el prefijo del acto y el sufijo `-i` de su posicion", async () => {
    // El `-i` es lo que da unicidad entre las fotos de la MISMA subida, que comparten el instante.
    // El prefijo es lo que distingue las fotos de dos actos distintos sobre la misma orden.
    const storage = fakeStorage();
    const { paths } = await subirEvidenciasCompensadas(storage, {
      ...ENTRADA,
      evidencias: fotos(3),
    });

    expect(paths[0]).toMatch(/^o1\/rechazada-\d+-0\.jpg$/);
    expect(paths[2]).toMatch(/^o1\/rechazada-\d+-2\.jpg$/);
    expect(new Set(paths).size).toBe(3); // ni un path repetido
  });

  it("el prefijo lo elige el llamador: dos actos sobre la MISMA orden no se pisan", async () => {
    const storage = fakeStorage();
    const a = await subirEvidenciasCompensadas(storage, {
      ordenId: "o1",
      prefijo: "incidente-",
      evidencias: fotos(1),
    });
    const b = await subirEvidenciasCompensadas(storage, {
      ordenId: "o1",
      prefijo: "rechazada-",
      evidencias: fotos(1),
    });
    expect(a.paths[0]).toContain("/incidente-");
    expect(b.paths[0]).toContain("/rechazada-");
    expect(a.paths[0]).not.toBe(b.paths[0]);
  });

  it("el MIME decide la extension, y uno desconocido cae a `bin` sin romper", async () => {
    const storage = fakeStorage();
    const { paths } = await subirEvidenciasCompensadas(storage, {
      ...ENTRADA,
      evidencias: [
        { contentType: "image/png", bytes: new Uint8Array([1]) },
        { contentType: "image/webp", bytes: new Uint8Array([2]) },
        // El borde zod ya rechaza este MIME; el `?? "bin"` es la red de que nunca se construya un
        // path con `undefined` dentro si algun llamador futuro se saltara el borde.
        { contentType: "application/pdf", bytes: new Uint8Array([3]) },
      ],
    });
    expect(paths[0]).toMatch(/\.png$/);
    expect(paths[1]).toMatch(/\.webp$/);
    expect(paths[2]).toMatch(/\.bin$/);
  });

  it("lista vacia: ni sube, ni compensa, ni devuelve nada", async () => {
    const storage = fakeStorage();
    const r = await subirEvidenciasCompensadas(storage, { ...ENTRADA, evidencias: [] });
    expect(r.paths).toEqual([]);
    expect(r.evidencias).toEqual([]);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// R15/R16 — LA COMPENSACION. Es la razon de que el bucle sea secuencial. [💰 no, pero SI deja
// basura permanente en un bucket privado si falla]
// ---------------------------------------------------------------------------------------------

describe("subirEvidenciasCompensadas — falla la #k (R15)", () => {
  it("retira EXACTAMENTE las k-1 ya subidas, propaga el error y no devuelve nada", async () => {
    let n = 0;
    const storage = fakeStorage({
      upload: vi.fn(async (input: { path: string }) => {
        n += 1;
        if (n === 3) throw new Error("storage caido en la foto 3");
        return input.path;
      }),
    });

    await expect(
      subirEvidenciasCompensadas(storage, { ...ENTRADA, evidencias: fotos(4) }),
    ).rejects.toThrow("storage caido en la foto 3");

    // Compensacion EXACTA: las dos primeras, ni una mas ni una menos.
    expect(storage.remove).toHaveBeenCalledTimes(1);
    const removidos = (storage.remove as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(removidos).toHaveLength(2);
    expect(removidos[0]).toMatch(/-0\.jpg$/);
    expect(removidos[1]).toMatch(/-1\.jpg$/);
    // Y la #4 nunca se intento: el bucle para en el fallo (esto es lo que `Promise.all` perderia).
    expect(storage.upload).toHaveBeenCalledTimes(3);
  });

  it("si falla la PRIMERA no hay nada que compensar: `remove` no se invoca", async () => {
    const storage = fakeStorage({
      upload: vi.fn(async () => {
        throw new Error("storage caido");
      }),
    });

    await expect(
      subirEvidenciasCompensadas(storage, { ...ENTRADA, evidencias: fotos(2) }),
    ).rejects.toThrow("storage caido");

    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("el error se PROPAGA: no hay resultado parcial que alguien pueda persistir", async () => {
    // La forma del fallo importa tanto como la compensacion: si devolviera `{ paths: [] }` en vez
    // de lanzar, el llamador seguiria adelante y crearia una gestion SIN sus fotos.
    const storage = fakeStorage({
      upload: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const r = await subirEvidenciasCompensadas(storage, {
      ...ENTRADA,
      evidencias: fotos(1),
    }).catch((e: unknown) => e);
    expect(r).toBeInstanceOf(Error);
  });
});

describe("compensarEvidencias — la retirada que llama el `catch` del llamador (R16)", () => {
  it("borra los N paths en UNA llamada", async () => {
    const storage = fakeStorage();
    await compensarEvidencias(storage, ["a", "b", "c"]);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("con la lista vacia no llama a `remove`", async () => {
    const storage = fakeStorage();
    await compensarEvidencias(storage, []);
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
