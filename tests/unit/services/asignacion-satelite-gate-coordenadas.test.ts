import { describe, it, expect, vi } from "vitest";
import { AsignacionSateliteService } from "@/lib/services/AsignacionSateliteService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
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
    findMensajeroIdsConVehiculo: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajerosNoAsignablesPorEstado: vi.fn(async (): Promise<Set<string>> => new Set()),
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
  // Feature 368 (R2/R18) — ACTUALIZADO: una sola orden bloqueada por coordenadas YA NO aborta
  // el lote. La asignable se asigna (`partial`), la bloqueada se reporta, y `asignarSateliteLote`
  // se llama SOLO con la asignable.
  it.each(NO_ASIGNABLES)("motivo %s -> partial: asigna la asignable, reporta la bloqueada", async (estado) => {
    const repo = fakeRepo();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: estado }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
    );

    const r = await service.asignar({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, ADMIN_SATELITE);

    expect(r.status).toBe("partial");
    if (r.status === "partial") {
      expect(r.resultados).toEqual([{ ordenId: "o2", estado: "por_recoger" }]);
      expect(r.bloqueadas).toEqual([{ ordenId: "o1", motivo: estado }]);
    }
    expect(repo.asignarSateliteLote).toHaveBeenCalledTimes(1);
    expect(repo.asignarSateliteLote).toHaveBeenCalledWith(
      ["o2"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("TODO-O-NADA: dos ordenes no asignables producen dos entradas y cero escrituras", async () => {
    const repo = fakeRepo();
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "geocodificacion_agotada", o2: "direccion_no_geocodificable" }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
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

  // Feature 368 (R17) — NUEVO, el caso de carrera COMPUESTA: `o1` bloqueada por coordenadas Y,
  // de las que SI pasaron el gate (`o2`, `o3`), `o2` pierde la carrera de concurrencia (cambia
  // de zona entre la lectura y la escritura guardada). El resultado sigue siendo `conflict`
  // (NUNCA `partial` ni `ok` en este camino raro) y el `detalle` combina el motivo de carrera
  // de `o2` con el motivo de coordenadas de `o1`, para no perder esa informacion (design.md §5).
  it("368/R17: carrera compuesta — bloqueada por coordenadas + carrera en las asignables -> conflict con ambos motivos", async () => {
    let llamada = 0;
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async (ids: string[]) => {
        llamada += 1;
        if (llamada === 1) {
          // Precarga inicial (paso 4): las tres en estado valido, para pasar las guardas de
          // zona/estado y llegar al gate de coordenadas.
          return [ordenRow({ id: "o1" }), ordenRow({ id: "o2" }), ordenRow({ id: "o3" })];
        }
        // Re-lectura tras la escritura (paso 7, solo sobre `asignables` = ["o2", "o3"]): o2
        // cambio de zona entre la lectura y la escritura (perdio la carrera); o3 si transiciono.
        return ids.map((id) =>
          id === "o2"
            ? ordenRow({ id, zonaId: "z-otra" })
            : ordenRow({ id, estatusValue: "por_recoger" }),
        );
      }),
      // Solo 1 de las 2 asignables (o2, o3) se escribio de verdad -> dispara el chequeo de carrera.
      asignarSateliteLote: vi.fn(async () => 1),
    });
    const service = new AsignacionSateliteService(
      repo as unknown as IOrdenRepository,
      gate({ o1: "geocodificacion_agotada" }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
    );

    const r = await service.asignar(
      { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      const porOrden = new Map(r.detalle.map((d) => [d.ordenId, d.motivo]));
      expect(porOrden.get("o1")).toBe("geocodificacion_agotada"); // no se pierde el motivo de coordenadas
      expect(porOrden.get("o2")).toBe("zona_ajena"); // motivo de la carrera
    }
    // `asignarSateliteLote` solo se llamo con las asignables (["o2","o3"]), nunca con "o1".
    expect(repo.asignarSateliteLote).toHaveBeenCalledWith(
      ["o2", "o3"],
      "m1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("todas asignables -> asigna con normalidad", async () => {
    const repo = fakeRepo();
    const service = new AsignacionSateliteService(repo as unknown as IOrdenRepository, gate(), fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

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
    const service = new AsignacionSateliteService(repo as unknown as IOrdenRepository, g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

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
    const service = new AsignacionSateliteService(repo as unknown as IOrdenRepository, g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.asignar(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { usuarioId: "u", rol: "maestro" },
    );

    expect(r.status).toBe("forbidden");
    expect(g.evaluar).not.toHaveBeenCalled();
  });
});
