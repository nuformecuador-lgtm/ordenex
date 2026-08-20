import { describe, it, expect, vi } from "vitest";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import type {
  IGestionOrdenRepository,
  GestionOrdenData,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

// Feature 158 (R6/R7/R8/R10/R11) — el SERVICE del reporte de incidente del mensajero. Dobles
// del repo/storage (nada de DB real): lo que se afirma es el `GestionOrdenData` EMITIDO hacia
// `crearGestionYTransicionar`, el estado destino y los efectos sobre el bucket.
//
// Molde: `mis-asignaciones-causa-devolucion.test.ts` (73).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_reparto: "os-reparto",
  entregada: "os-entregada",
  reprogramada: "os-reprogramada",
  devuelta: "os-devuelta",
  rechazada: "os-rechazada",
  incidente: "os-incidente", // feature 154: el value del catalogo; 1:1 con el `resultado`
};

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
    findMisAsignacionesByIds: vi.fn(async () => []),
    contarEntregadas: vi.fn(async () => 0),
    sumMontoCobrarGestionadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => [gestionRow()]),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    reprogramarDesdeDevuelta: vi.fn(async () => true),
    // Feature 237: `MisAsignacionesService` NO lo usa (la tienda gestiona por su propio
    // servicio); el doble lo declara porque la interfaz lo exige.
    crearGestionDesdeAyuda: vi.fn(async () => "g-desde-ayuda"),
    ...overrides,
  };
}

function newService(
  repo: IGestionOrdenRepository,
  opts: { bloqueados?: string[]; storage?: IFileStorage } = {},
) {
  const ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue" | "findMensajerosBloqueadosParaGestion"> = {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    findMensajerosBloqueadosParaGestion: vi.fn(
      async (): Promise<Set<string>> => new Set(opts.bloqueados ?? []),
    ),
  };
  const storage: IFileStorage = opts.storage ?? {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
  };
  const signed: ISignedUrlProvider = {
    createSignedUrl: vi.fn(async (path: string) => `https://signed/${path}`),
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
  };
  const rutaRepo: Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen"> = {
    findByMensajero: vi.fn(async () => null),
    upsertOrigen: vi.fn(async () => {}),
  };
  const metaRepo = {
    findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
  };
  const service = new MisAsignacionesService(
    repo,
    ordenRepo,
    storage,
    signed,
    rutaRepo,
    metaRepo,
    fakeIntentosEnLote(),
  );
  return { service, ordenRepo, storage, signed };
}

function gestionEmitida(repo: IGestionOrdenRepository): GestionOrdenData {
  const call = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
  return call.gestion as GestionOrdenData;
}

function incidente(overrides: Partial<GestionarInput> = {}): GestionarInput {
  return {
    ordenId: "o1",
    resultado: "incidente",
    causaIncidente: "danado",
    motivo: "la caja llego aplastada",
    evidencias: [{ contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) }],
    ...overrides,
  } as GestionarInput;
}

describe("Feature 158 · R6 — la gestion y la transicion viajan en UNA sola transaccion", () => {
  it("R6: `incidente` -> UNA llamada al repo con la gestion Y el estatus destino `incidente`", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);

    const r = await service.gestionar(incidente(), MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.estado).toBe("incidente");
    expect(repo.crearGestionYTransicionar).toHaveBeenCalledTimes(1);
    const call = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // El mapeo resultado -> estado es 1:1 POR NOMBRE (`findEstatusIdByValue(resultado)`): si
    // el value del catalogo y el value del enum divergieran, esto se caeria.
    expect(call.nuevoEstatusId).toBe("os-incidente");
    expect(call.gestion.resultado).toBe("incidente");
    expect(call.mensajeroId).toBe("m1");
  });

  it("R6: si la tx falla, el service PROPAGA el fallo (nada queda persistido a medias)", async () => {
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("fallo de la tx de gestion");
      }),
    });
    const { service } = newService(repo);
    await expect(service.gestionar(incidente(), MENSAJERO)).rejects.toThrow(
      "fallo de la tx de gestion",
    );
  });

  it("R6: el catalogo sin el value `incidente` (seed pendiente) -> validation_error sin escribir", async () => {
    const repo = fakeRepo();
    const ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue" | "findMensajerosBloqueadosParaGestion"> = {
      findEstatusIdByValue: vi.fn(async (v: string) => (v === "incidente" ? null : "os-x")),
      findMensajerosBloqueadosParaGestion: vi.fn(async (): Promise<Set<string>> => new Set()),
    };
    const storage: IFileStorage = { upload: vi.fn(), remove: vi.fn(async () => {}) };
    const service = new MisAsignacionesService(
      repo,
      ordenRepo,
      storage,
      {
        createSignedUrl: vi.fn(),
        createSignedUrls: vi.fn(async () => ({})),
      } as unknown as ISignedUrlProvider,
      { findByMensajero: vi.fn(async () => null), upsertOrigen: vi.fn(async () => {}) },
      {
        findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
      },
      fakeIntentosEnLote(),
    );

    const r = await service.gestionar(incidente(), MENSAJERO);

    expect(r.status).toBe("validation_error");
    // R7: la guardia del catalogo va ANTES de subir la foto -> cero objetos en el bucket.
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});

describe("Feature 158 · R9/R11 — causa y motivo se persisten en campos SEPARADOS", () => {
  it.each([...CAUSA_INCIDENTE_SEED])(
    "R9: la causa `%s` viaja en `GestionOrdenData.causaIncidente`",
    async (causa) => {
      const repo = fakeRepo();
      const { service } = newService(repo);
      const r = await service.gestionar(incidente({ causaIncidente: causa }), MENSAJERO);
      expect(r.status).toBe("ok");
      expect(gestionEmitida(repo).causaIncidente).toBe(causa);
    },
  );

  it("R11: el motivo emitido es EXACTAMENTE el de entrada, sin decorarlo con la causa", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);
    const motivo = "me lo quitaron en la parada del bus";
    await service.gestionar(incidente({ causaIncidente: "robado", motivo }), MENSAJERO);
    const gestion = gestionEmitida(repo);
    expect(gestion.motivo).toBe(motivo);
    expect(gestion.motivo).not.toMatch(/robado|Robado/);
  });

  it("R9/R11: causa y motivo son campos APARTE del mismo objeto, y no hay causa de devolucion", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);
    await service.gestionar(incidente(), MENSAJERO);
    const gestion = gestionEmitida(repo);
    expect(gestion).toMatchObject({
      resultado: "incidente",
      causaIncidente: "danado",
      motivo: "la caja llego aplastada",
    });
    expect(gestion.causaDevolucion).toBeUndefined();
  });

  it("R22: el service NO escribe `indemnizacion` al reportar (el monto lo captura el admin)", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);
    await service.gestionar(incidente(), MENSAJERO);
    // La columna existe, pero NO viaja en el contrato de creacion de la gestion: si alguien la
    // colara aqui, el mensajero estaria fijando el monto de su propia indemnizacion.
    expect(gestionEmitida(repo)).not.toHaveProperty("indemnizacion");
  });

  it("no hay recaudo: el incidente no emite `montoRecibido` ni `metodoPago`", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);
    await service.gestionar(incidente(), MENSAJERO);
    const gestion = gestionEmitida(repo);
    expect(gestion.montoRecibido).toBeUndefined();
    expect(gestion.metodoPago).toBeUndefined();
  });
});

describe("Feature 158 · R10 — las 1..N evidencias se suben y se persisten", () => {
  it("R10: sube las N fotos ANTES de la tx y las emite con su indice 0..N-1", async () => {
    const repo = fakeRepo();
    const { service, storage } = newService(repo);

    const r = await service.gestionar(
      incidente({
        evidencias: [
          { contentType: "image/jpeg", bytes: new Uint8Array([1]) },
          { contentType: "image/png", bytes: new Uint8Array([2]) },
        ],
      } as Partial<GestionarInput>),
      MENSAJERO,
    );

    expect(r.status).toBe("ok");
    expect(storage.upload).toHaveBeenCalledTimes(2);
    const evidencias = gestionEmitida(repo).evidencias ?? [];
    expect(evidencias.map((e) => e.indice)).toEqual([0, 1]);
    expect(evidencias.map((e) => e.contentType)).toEqual(["image/jpeg", "image/png"]);
    // El path lleva el `resultado` -> los objetos del incidente son distinguibles en el bucket.
    for (const e of evidencias) expect(e.storagePath).toContain("incidente-");
  });

  it("R10: las evidencias se devuelven FIRMADAS, nunca el path crudo del bucket", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);
    const r = await service.gestionar(incidente(), MENSAJERO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.evidenciaUrls).toHaveLength(1);
    expect(r.evidenciaUrls?.[0]).toMatch(/^https:\/\/signed\//);
  });

  it("R7/R10: si la tx falla DESPUES de subir, se COMPENSA borrando los objetos del bucket", async () => {
    const remove = vi.fn(async () => {});
    const storage: IFileStorage = {
      upload: vi.fn(async (input: { path: string }) => input.path),
      remove,
    };
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const { service } = newService(repo, { storage });

    await expect(
      service.gestionar(
        incidente({
          evidencias: [
            { contentType: "image/jpeg", bytes: new Uint8Array([1]) },
            { contentType: "image/jpeg", bytes: new Uint8Array([2]) },
          ],
        } as Partial<GestionarInput>),
        MENSAJERO,
      ),
    ).rejects.toThrow("boom");

    expect(remove).toHaveBeenCalledTimes(1);
    expect((remove.mock.calls[0] as unknown as [string[]])[0]).toHaveLength(2);
  });

  it("R10: si falla la subida de la 2.a foto, se borra la 1.a y NO se persiste nada", async () => {
    let n = 0;
    const remove = vi.fn(async () => {});
    const storage: IFileStorage = {
      upload: vi.fn(async (input: { path: string }) => {
        n += 1;
        if (n === 2) throw new Error("storage caido");
        return input.path;
      }),
      remove,
    };
    const repo = fakeRepo();
    const { service } = newService(repo, { storage });

    await expect(
      service.gestionar(
        incidente({
          evidencias: [
            { contentType: "image/jpeg", bytes: new Uint8Array([1]) },
            { contentType: "image/jpeg", bytes: new Uint8Array([2]) },
          ],
        } as Partial<GestionarInput>),
        MENSAJERO,
      ),
    ).rejects.toThrow("storage caido");

    expect((remove.mock.calls[0] as unknown as [string[]])[0]).toHaveLength(1);
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});

describe("Feature 158 · R7 — el reporte se rechaza SIN efectos si la guardia no pasa", () => {
  it.each([
    ["por_recoger", "aun no la recogio"],
    ["en_bodega_central", "la orden esta en bodega"],
    ["entregada", "ya se gestiono"],
    ["incidente", "ya es un incidente"],
  ])(
    "R7: la orden en `%s` (no `en_reparto`) -> conflict, sin subir fotos ni escribir (%s)",
    async (estatusValue) => {
      const repo = fakeRepo({ findByIdsParaGestion: vi.fn(async () => [gestionRow({ estatusValue })]) });
      const { service, storage } = newService(repo);

      const r = await service.gestionar(incidente(), MENSAJERO);

      expect(r.status).toBe("conflict");
      expect(storage.upload).not.toHaveBeenCalled(); // cero objetos en el bucket
      expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
    },
  );

  it("R7: orden de OTRO mensajero -> forbidden, sin subir fotos ni escribir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ mensajeroAsignadoId: "otro" })]),
    });
    const { service, storage } = newService(repo);

    const r = await service.gestionar(incidente(), MENSAJERO);

    expect(r).toEqual({ status: "forbidden" });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R7: orden BORRADA -> conflict, sin subir fotos ni escribir", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ deletedAt: new Date() })]),
    });
    const { service, storage } = newService(repo);

    const r = await service.gestionar(incidente(), MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R7: mensajero con un CIERRE PENDIENTE que lo bloquea -> conflict, sin efectos", async () => {
    const repo = fakeRepo();
    const { service, storage } = newService(repo, { bloqueados: ["m1"] });

    const r = await service.gestionar(incidente(), MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/cierre pendiente/i);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.findByIdsParaGestion).not.toHaveBeenCalled();
  });

  it("R7: rol distinto de mensajero -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);

    const r = await service.gestionar(incidente(), { usuarioId: "a1", rol: "adminSatelite" });

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.findByIdsParaGestion).not.toHaveBeenCalled();
  });

  it("R7: con OTRA orden activa en gestion -> conflict, sin subir fotos ni escribir", async () => {
    const repo = fakeRepo({ getOrdenEnGestion: vi.fn(async () => "otra-orden") });
    const { service, storage } = newService(repo);

    const r = await service.gestionar(incidente(), MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});

describe("Feature 158 · R35 — los cuatro resultados previos no cambian", () => {
  it("una `entregada` sigue emitiendo monto/metodo y NINGUNA causa de incidente", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);
    const r = await service.gestionar(
      {
        ordenId: "o1",
        resultado: "entregada",
        montoRecibido: 100,
        metodoPago: "efectivo",
        pagos: [{ metodo: "efectivo", monto: 100 }], // feature 212: desglose normalizado (R12)
        evidencias: [{ contentType: "image/jpeg", bytes: new Uint8Array([1]) }],
      },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    const gestion = gestionEmitida(repo);
    expect(gestion).toMatchObject({ resultado: "entregada", montoRecibido: 100 });
    expect(gestion.causaIncidente).toBeUndefined();
  });

  it("una `reprogramada` sigue SIN subir fotos (el incidente no cambio esa lista)", async () => {
    const repo = fakeRepo();
    const { service, storage } = newService(repo);
    const r = await service.gestionar(
      {
        ordenId: "o1",
        resultado: "reprogramada",
        fechaReprogramacion: "2099-01-01",
        motivo: "reagendar",
      },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(gestionEmitida(repo).causaIncidente).toBeUndefined();
  });
});
