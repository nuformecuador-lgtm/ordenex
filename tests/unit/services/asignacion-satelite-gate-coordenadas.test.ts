import { describe, it, expect, vi } from "vitest";
import { AsignacionSateliteService } from "@/lib/services/AsignacionSateliteService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 92 (R8) — el gate de asignabilidad en el TERCER writer de
// `mensajero_asignado_id`: `AsignacionSateliteService.asignar` (rol adminSatelite).

const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const ZONA = "z-limon";

function ordenRow(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    estatusValue: "en_bodega_satelite",
    numGuia: 10,
    deletedAt: null,
    zonaId: ZONA,
    zonaEsGam: false,
    tiendaId: "t1",
    ...over,
  };
}

function fakeRepo(over: Record<string, unknown> = {}) {
  return {
    findUsuarioZonaId: vi.fn(async () => ZONA),
    findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]) => new Set(ids)),
    findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1" }), ordenRow({ id: "o2" })]),
    findEstatusIdByValue: vi.fn(async (v: string) =>
      v === "en_bodega_satelite" ? "os-sat" : "os-espera",
    ),
    asignarSateliteLote: vi.fn(async (ids: string[]) => ids.length),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set<string>()),
    findParaAsignabilidad: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, direccion: "x", latitud: null, longitud: null, geocodeStatus: null })),
    ),
    ...over,
  };
}

function gate(porOrden: Record<string, EstadoAsignabilidad> = {}): IAsignabilidadCoordenadasService {
  return {
    evaluar: vi.fn(async (ordenes: OrdenAsignabilidadRow[]) =>
      new Map<string, EstadoAsignabilidad>(
        ordenes.map((o) => [o.id, porOrden[o.id] ?? "asignable"]),
      ),
    ),
  };
}

const NO_ASIGNABLES: EstadoAsignabilidad[] = [
  "direccion_no_geocodificable",
  "geocodificacion_agotada",
  "geocodificacion_en_curso",
  "geocodificacion_encolada",
  "geocodificacion_no_encolable",
];

describe("R8 — AsignacionSateliteService.asignar", () => {
  it.each(NO_ASIGNABLES)("motivo %s -> conflict SIN escribir", async (estado) => {
    const repo = fakeRepo();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: estado }),
    );

    const r = await service.asignar({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: estado }]);
    }
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("TODO-O-NADA: dos ordenes no asignables producen dos entradas y cero escrituras", async () => {
    const repo = fakeRepo();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "geocodificacion_agotada", o2: "direccion_no_geocodificable" }),
    );

    const r = await service.asignar({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([
        { ordenId: "o1", motivo: "geocodificacion_agotada" },
        { ordenId: "o2", motivo: "direccion_no_geocodificable" },
      ]);
    }
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("todas asignables -> asigna con normalidad", async () => {
    const repo = fakeRepo();
    const service = new AsignacionSateliteService(repo as unknown as IOrdenRepository, gate());

    const r = await service.asignar({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(r.status).toBe("ok");
    expect(repo.asignarSateliteLote).toHaveBeenCalledTimes(1);
  });

  it("el gate corre DESPUES de las guardas de zona/estado y ANTES de escribir", async () => {
    // Orden importante: una orden de zona ajena debe seguir reportando `zona_ajena`, no
    // un motivo de coordenadas; el gate solo opina de las que llegarian a asignarse.
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [ordenRow({ id: "o1", zonaId: "z-otra" })]),
    });
    const g = gate({ o1: "geocodificacion_agotada" });
    const service = new AsignacionSateliteService(repo as unknown as IOrdenRepository, g);

    const r = await service.asignar({ ordenIds: ["o1"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: "zona_ajena" }]);
    }
    expect(g.evaluar).not.toHaveBeenCalled();
  });

  it("rol no autorizado -> forbidden sin llegar al gate", async () => {
    const repo = fakeRepo();
    const g = gate();
    const service = new AsignacionSateliteService(repo as unknown as IOrdenRepository, g);

    const r = await service.asignar(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { usuarioId: "u", rol: "maestro" },
    );

    expect(r.status).toBe("forbidden");
    expect(g.evaluar).not.toHaveBeenCalled();
  });
});
