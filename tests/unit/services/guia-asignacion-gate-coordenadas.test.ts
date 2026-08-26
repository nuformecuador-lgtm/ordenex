import { describe, it, expect, vi } from "vitest";
import { MSG_MENSAJERO_SIN_VEHICULO } from "@/lib/services/mensajes-bloqueo";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 92 (R8) — el gate de asignabilidad enganchado en los writers de
// `mensajero_asignado_id` de `GuiaAsignacionService`.
//
// La invariante que este archivo protege: una orden sin coordenadas utilizables NUNCA
// entra a la ruta de un mensajero, y el rechazo es TODO-O-NADA por lote (contrato ya
// vigente de estos services, no se cambia) con un `motivo` que identifica el estado.
//
// FEATURE 156 (R12/R19) — `generarGuia` deja de escribir `mensajero_asignado_id`, asi que
// sale de la lista de writers y el gate DEJA de aplicarsele: numerar una orden y moverla a
// la bodega central no la mete en la ruta de nadie. Los casos de `generarGuia` no se
// borran: se INVIERTEN (ahora terminan en `ok`) y ademas se afirma que el gate ni se
// invoca. Los de `asignarDesdeBodega` se conservan INTACTOS — es el punto del que depende
// la invariante, porque ahi si se asigna. Tras esta feature los dos unicos writers del
// sistema son `asignarDesdeBodega` (aqui) y `AsignacionSateliteService` (su propio test).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const GAM = "z-gam";

const ESTATUS: Record<string, string> = {
  por_recoger: "os-espera",
  en_bodega_central: "os-bodega",
  en_ruta_bodega_satelite: "os-ruta-satelite",
};

function ordenRow(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    // Feature 156: `en_preparacion` es el unico origen de generar guia.
    estatusValue: "en_preparacion",
    numGuia: null,
    deletedAt: null,
    zonaId: GAM,
    zonaEsGam: true,
    tiendaId: "t1",
    ...over,
  };
}

function fakeRepo(over: Record<string, unknown> = {}): IOrdenRepository {
  return {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
    findByIdsForTransicion: vi.fn(async () => [ordenRow()]),
    findMensajeroIdsConVehiculo: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set<string>()),
    // Feature 157 (regla de dedicacion): nadie ocupado, para no interferir con el gate.
    findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
    findMensajerosByZona: vi.fn(async () => []),
    findParaAsignabilidad: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, direccion: "x", latitud: null, longitud: null, geocodeStatus: null })),
    ),
    generarGuiaLote: vi.fn(async (ds: { ordenId: string }[]) =>
      ds.map((d, i) => ({ ordenId: d.ordenId, numGuia: i + 1 })),
    ),
    asignarBodegaLote: vi.fn(async () => 1),
    ...over,
  } as unknown as IOrdenRepository;
}

function fakeZonaRepo(): IZonaRepository {
  return { findCentralZonaId: vi.fn(async () => GAM) } as unknown as IZonaRepository;
}

/** Gate que devuelve el estado indicado por orden; el resto, `asignable`. */
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

describe("156/R12 — generarGuia YA NO pasa por el gate (dejo de asignar mensajero)", () => {
  // Estos son los mismos casos que antes exigian el gate en `generarGuia`. No se borran:
  // se invierten, porque la razon de ser del gate desaparecio de esta via. Si alguien
  // devolviera la asignacion a `generarGuia` sin devolver el gate, estos casos seguirian
  // verdes — por eso el archivo conserva ADEMAS los de `asignarDesdeBodega` (R19), que son
  // los que de verdad protegen la invariante.
  it.each(NO_ASIGNABLES)("motivo %s -> ok igualmente, la orden se numera", async (estado) => {
    const repo = fakeRepo();
    const g = gate({ o1: estado });
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados[0]).toMatchObject({ ordenId: "o1", estado: "en_bodega_central" });
    expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1);
    // Ni se consulta: no hay a quien asignar, no hay coordenadas que exigir.
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.findParaAsignabilidad).not.toHaveBeenCalled();
  });

  it("un lote entero sin coordenadas se numera completo (ninguna orden entra a una ruta)", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2" }),
        ordenRow({ id: "o3" }),
      ]),
    });
    const g = gate({ o2: "geocodificacion_agotada" });
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.generarGuia({ ordenIds: ["o1", "o2", "o3"] }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.resultados).toHaveLength(3);
    expect(g.evaluar).not.toHaveBeenCalled();
  });

  it("156/R2: ninguna decision del lote lleva mensajero (por eso el gate sobra)", async () => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate(), fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    await service.generarGuia({ ordenIds: ["o1"] }, MAESTRO);

    const decisiones = vi.mocked(repo.generarGuiaLote).mock.calls[0]![0] as {
      mensajeroAsignadoId: string | null;
    }[];
    for (const d of decisiones) expect(d.mensajeroAsignadoId).toBeNull();
  });
});

// 156/R19 — NO-REGRESION. Ni una asercion de este bloque se relaja: `asignarDesdeBodega` es
// uno de los dos unicos escritores de `mensajero_asignado_id` que quedan y conserva el gate.
describe("R8 — asignarDesdeBodega (todo el lote recibe mensajero)", () => {
  function repoBodega(over: Record<string, unknown> = {}) {
    return fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", estatusValue: "en_bodega_central" }),
        ordenRow({ id: "o2", estatusValue: "en_bodega_central" }),
      ]),
      ...over,
    });
  }

  // Feature 21 (pedido humano 2026-08-26): el mensajero es de la zona GAM y esta libre,
  // pero no tiene vehiculo asociado. Se para AQUI y con motivo propio: el mismo texto que
  // emite la asignacion desde bodega satelite, porque es la misma regla.
  it("feature 21: mensajero sin vehiculo asociado -> validation_error, sin persistir", async () => {
    const repo = repoBodega({
      findMensajeroIdsConVehiculo: vi.fn(async () => new Set<string>()),
    });
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate(), fakeIntentosEnLote());

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { mensajeroId: [MSG_MENSAJERO_SIN_VEHICULO] },
    });
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it.each(NO_ASIGNABLES)("motivo %s -> conflict SIN persistir", async (estado) => {
    const repo = repoBodega();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate({ o1: estado }), fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: estado }]);
    }
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("el gate evalua el LOTE ENTERO (aqui todas reciben mensajero)", async () => {
    const repo = repoBodega();
    const g = gate();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(repo.findParaAsignabilidad).toHaveBeenCalledWith(["o1", "o2"]);
  });

  it("todas asignables -> persiste con normalidad", async () => {
    const repo = repoBodega();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate(), fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.asignarBodegaLote).toHaveBeenCalledTimes(1);
  });

  it("el gate corre ANTES de resolver el catalogo de estados (aborta lo antes posible)", async () => {
    const orden: string[] = [];
    const repo = repoBodega({
      findParaAsignabilidad: vi.fn(async (ids: string[]) => {
        orden.push("gate");
        return ids.map((id) => ({
          id,
          direccion: "x",
          latitud: null,
          longitud: null,
          geocodeStatus: null,
        }));
      }),
      findEstatusIdByValue: vi.fn(async (v: string) => {
        orden.push(`estatus:${v}`);
        return ESTATUS[v] ?? null;
      }),
    });
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o1: "direccion_no_geocodificable" }),
      fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */,
    );

    await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(orden).toContain("gate");
    expect(orden.filter((o) => o.startsWith("estatus:en_espera"))).toHaveLength(0);
  });
});
