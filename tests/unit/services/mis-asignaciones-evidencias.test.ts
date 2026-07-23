import { describe, it, expect, vi } from "vitest";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import type {
  IGestionOrdenRepository,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 119 (R9/R10/R11/R13) — atomicidad Storage <-> DB de la evidencia MULTIPLE. La subida
// es SECUENCIAL y acumula los paths en `uploaded`; ante cualquier fallo se compensa con
// `storage.remove(uploaded)` y NO se persiste nada. En exito, el resultado devuelve las N URLs
// firmadas (nunca el path crudo).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

function gestionRow(overrides: Partial<OrdenGestionRow> = {}): OrdenGestionRow {
  return {
    id: "o1",
    estatusValue: "en_reparto",
    deletedAt: null,
    mensajeroAsignadoId: "m1",
    montoCobrar: 100,
    zonaId: "z-satelite",
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<IGestionOrdenRepository> = {}): IGestionOrdenRepository {
  return {
    findMisAsignaciones: vi.fn(async () => []),
    contarEntregadas: vi.fn(async () => 0),
    sumMontoCobrarEntregadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => [gestionRow()]),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    reprogramarDesdeDevuelta: vi.fn(async () => true),
    ...overrides,
  };
}

function fakeOrdenRepo(): Pick<IOrdenRepository, "findEstatusIdByValue" | "findMensajerosBloqueados"> {
  const ids: Record<string, string> = {
    en_reparto: "os-reparto",
    entregada: "os-entregada",
    rechazada: "os-rechazada",
    devuelta: "os-devuelta",
    reprogramada: "os-reprogramada",
  };
  return {
    findEstatusIdByValue: vi.fn(async (v: string) => ids[v] ?? null),
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
  };
}

function fakeStorage(overrides: Partial<IFileStorage> = {}): IFileStorage {
  return {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeSignedUrls(overrides: Partial<ISignedUrlProvider> = {}): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (path: string) => `https://signed/${path}`),
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
    ...overrides,
  };
}

function fakeRutaRepo(): Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen"> {
  return { findByMensajero: vi.fn(async () => null), upsertOrigen: vi.fn(async () => {}) };
}

function fakeMetaRepo(): Pick<IOrdenMensajeroMetaRepository, "findMarcarLuegoByMensajero"> {
  return { findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()) };
}

function newService(
  repo: IGestionOrdenRepository = fakeRepo(),
  storage: IFileStorage = fakeStorage(),
  signed: ISignedUrlProvider = fakeSignedUrls(),
) {
  return new MisAsignacionesService(
    repo,
    fakeOrdenRepo(),
    storage,
    signed,
    fakeRutaRepo(),
    fakeMetaRepo(),
  );
}

function foto(n: number) {
  return { contentType: "image/jpeg", bytes: new Uint8Array([n]) };
}

function rechazoConFotos(k: number): GestionarInput {
  return {
    ordenId: "o1",
    resultado: "rechazada",
    motivo: "cliente rechazo",
    evidencias: Array.from({ length: k }, (_v, i) => foto(i)),
  };
}

describe("R9: subida secuencial de N fotos + persistencia en una transaccion", () => {
  it("sube las N fotos y las pasa al repo con indice 0..N-1 en orden", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const r = await newService(repo, storage).gestionar(rechazoConFotos(3), MENSAJERO);

    expect(r.status).toBe("ok");
    expect(storage.upload).toHaveBeenCalledTimes(3);
    const gArg = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const evidencias = gArg.gestion.evidencias as { storagePath: string; indice: number }[];
    expect(evidencias.map((e) => e.indice)).toEqual([0, 1, 2]);
    // Cada path lleva el sufijo -i de su posicion (unicidad entre fotos de la misma gestion).
    expect(evidencias[0].storagePath).toMatch(/o1\/rechazada-\d+-0\./);
    expect(evidencias[2].storagePath).toMatch(/o1\/rechazada-\d+-2\./);
  });
});

describe("R10: falla la subida #k -> compensa las k-1 previas y NO persiste", () => {
  it("borra del storage SOLO las ya subidas y NO invoca al repo; propaga el error", async () => {
    // La 3.a subida falla; las 2 primeras ya estan en `uploaded`.
    let n = 0;
    const storage = fakeStorage({
      upload: vi.fn(async (input: { path: string }) => {
        n += 1;
        if (n === 3) throw new Error("storage caido en la foto 3");
        return input.path;
      }),
    });
    const repo = fakeRepo();

    await expect(newService(repo, storage).gestionar(rechazoConFotos(3), MENSAJERO)).rejects.toThrow(
      "storage caido en la foto 3",
    );

    // R10: rollback TOTAL de storage: remove con EXACTAMENTE las 2 ya subidas.
    expect(storage.remove).toHaveBeenCalledTimes(1);
    const removed = (storage.remove as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(removed).toHaveLength(2);
    // R10: nada en la base (el repo ni se invoca).
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("si falla la PRIMERA subida no hay nada que compensar (remove no se invoca)", async () => {
    const storage = fakeStorage({
      upload: vi.fn(async () => {
        throw new Error("storage caido");
      }),
    });
    const repo = fakeRepo();
    await expect(newService(repo, storage).gestionar(rechazoConFotos(2), MENSAJERO)).rejects.toThrow(
      "storage caido",
    );
    expect(storage.remove).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});

describe("R11: la transaccion falla DESPUES de subir -> borra las N y propaga", () => {
  it("remove con las N evidencias subidas; el error se propaga (no es resultado de dominio)", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("tx caida");
      }),
    });

    await expect(newService(repo, storage).gestionar(rechazoConFotos(3), MENSAJERO)).rejects.toThrow(
      "tx caida",
    );

    expect(storage.remove).toHaveBeenCalledTimes(1);
    const removed = (storage.remove as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(removed).toHaveLength(3);
  });
});

describe("R13: exito -> N URLs firmadas (TTL de config), nunca el path crudo", () => {
  it("devuelve una URL firmada por foto, en el orden de subida", async () => {
    const signed = fakeSignedUrls();
    const r = await newService(fakeRepo(), fakeStorage(), signed).gestionar(rechazoConFotos(3), MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.evidenciaUrls).toHaveLength(3);
    for (const url of r.evidenciaUrls ?? []) {
      expect(url).toMatch(/^https:\/\/signed\//);
      expect(url).not.toMatch(/gestion-evidencias/); // nunca el nombre del bucket crudo
    }
    // Se firmo con `createSignedUrls` (batch), no una por una.
    expect(signed.createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it("reprogramada (sin foto) -> evidenciaUrls undefined y no firma nada", async () => {
    const signed = fakeSignedUrls();
    const r = await newService(fakeRepo(), fakeStorage(), signed).gestionar(
      { ordenId: "o1", resultado: "reprogramada", fechaReprogramacion: "2027-01-01", motivo: "x" },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.evidenciaUrls).toBeUndefined();
    expect(signed.createSignedUrls).not.toHaveBeenCalled();
  });
});
