import { describe, it, expect, vi } from "vitest";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import type {
  IGestionOrdenRepository,
  GestionOrdenData,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";

// Feature 73 (R11/R12/R13) — el SERVICE propaga la causa a los datos de la gestion, en su
// campo propio y SIN tocar el texto libre. Dobles del repo/storage (nada de DB real): lo que
// se afirma es el `GestionOrdenData` EMITIDO hacia `crearGestionYTransicionar`.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_reparto: "os-reparto",
  entregada: "os-entregada",
  devuelta: "os-devuelta",
  rechazada: "os-rechazada",
  en_bodega: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
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
    contarEntregadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => [gestionRow()]),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    ...overrides,
  };
}

function newService(repo: IGestionOrdenRepository) {
  const ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue"> = {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
  };
  const storage: IFileStorage = {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
  };
  const signed: ISignedUrlProvider = {
    createSignedUrl: vi.fn(async (path: string) => `https://signed/${path}`),
    createSignedUrls: vi.fn(async () => ({})),
  };
  const historial: Pick<IOrdenHistorialService, "contarIntentos"> = {
    contarIntentos: vi.fn(async () => 0),
  };
  const zonaRepo: Pick<IZonaRepository, "findCentralZonaId"> = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  };
  return new MisAsignacionesService(repo, ordenRepo, storage, signed, historial, zonaRepo);
}

function gestionEmitida(repo: IGestionOrdenRepository): GestionOrdenData {
  const call = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
  return call.gestion as GestionOrdenData;
}

function devolucion(overrides: Partial<GestionarInput> = {}): GestionarInput {
  return {
    ordenId: "o1",
    resultado: "devuelta",
    causaDevolucion: "wrong_address",
    motivo: "la direccion no existe",
    ...overrides,
  } as GestionarInput;
}

describe("Feature 73 · el service persiste la causa en su campo propio (R11)", () => {
  it.each([...CAUSA_DEVOLUCION_SEED])(
    "R11: la causa `%s` viaja en `GestionOrdenData.causaDevolucion`",
    async (causa) => {
      const repo = fakeRepo();
      const r = await newService(repo).gestionar(devolucion({ causaDevolucion: causa }), MENSAJERO);
      expect(r.status).toBe("ok");
      const gestion = gestionEmitida(repo);
      expect(gestion.resultado).toBe("devuelta");
      expect(gestion.causaDevolucion).toBe(causa);
    },
  );

  it("R13: la causa viaja DENTRO de `gestion` -> misma tx que estado y seguimiento (sin firma nueva)", async () => {
    const repo = fakeRepo();
    await newService(repo).gestionar(devolucion(), MENSAJERO);
    const call = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Un solo argumento con TODO: gestion (con su causa) + estado destino + seguimiento de la 47.
    expect(call.gestion.causaDevolucion).toBe("wrong_address");
    expect(call.nuevoEstatusId).toBe("os-devuelta");
    expect(call.seguimiento).toBeDefined();
    expect(repo.crearGestionYTransicionar).toHaveBeenCalledTimes(1);
  });

  it("R13: si la tx falla, el service propaga el fallo (no hay causa persistida a medias)", async () => {
    const repo = fakeRepo({
      crearGestionYTransicionar: vi.fn(async () => {
        throw new Error("fallo del append de seguimiento (47)");
      }),
    });
    await expect(newService(repo).gestionar(devolucion(), MENSAJERO)).rejects.toThrow(
      "fallo del append de seguimiento (47)",
    );
  });
});

describe("Feature 73 · el `motivo` NO se decora con la causa (R12)", () => {
  it("R12: el motivo emitido es EXACTAMENTE el de entrada, sin prefijo, sufijo ni concatenacion", async () => {
    const repo = fakeRepo();
    const motivo = "toque 3 veces y nadie abrio";
    await newService(repo).gestionar(devolucion({ motivo }), MENSAJERO);
    const gestion = gestionEmitida(repo);
    expect(gestion.motivo).toBe(motivo);
    // Ni el slug del enum ni la etiqueta legible se cuelan en el texto libre.
    expect(gestion.motivo).not.toMatch(/wrong_address|Dirección errada/);
  });

  it("R11/R12: causa y motivo son campos SEPARADOS del mismo objeto", async () => {
    const repo = fakeRepo();
    await newService(repo).gestionar(devolucion(), MENSAJERO);
    const gestion = gestionEmitida(repo);
    expect(gestion).toMatchObject({
      resultado: "devuelta",
      causaDevolucion: "wrong_address",
      motivo: "la direccion no existe",
    });
  });
});

describe("Feature 73 · las otras ramas no emiten causa (R10/R19)", () => {
  it("R10: una entrega no lleva `causaDevolucion` en su GestionOrdenData", async () => {
    const repo = fakeRepo();
    await newService(repo).gestionar(
      {
        ordenId: "o1",
        resultado: "entregada",
        montoRecibido: 100,
        metodoPago: "efectivo",
        evidencia: { contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) },
      },
      MENSAJERO,
    );
    expect(gestionEmitida(repo).causaDevolucion).toBeUndefined();
  });

  it("R19: un rechazo conserva motivo libre y NO lleva causa", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).gestionar(
      {
        ordenId: "o1",
        resultado: "rechazada",
        motivo: "el cliente lo rechazo",
        evidencia: { contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) },
      },
      MENSAJERO,
    );
    expect(r.status).toBe("ok");
    const gestion = gestionEmitida(repo);
    expect(gestion.motivo).toBe("el cliente lo rechazo");
    expect(gestion.causaDevolucion).toBeUndefined();
  });
});
