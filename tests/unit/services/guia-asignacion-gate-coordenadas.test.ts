import { describe, it, expect, vi } from "vitest";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 92 (R8) — el gate de asignabilidad enganchado en los DOS writers de
// `mensajero_asignado_id` de `GuiaAsignacionService`: `generarGuia` (rama GAM CON
// mensajero) y `asignarDesdeBodega`.
//
// La invariante que este archivo protege: una orden sin coordenadas utilizables NUNCA
// entra a la ruta de un mensajero, y el rechazo es TODO-O-NADA por lote (contrato ya
// vigente de estos services, no se cambia) con un `motivo` que identifica el estado.

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
    estatusValue: "en_fulfillment",
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
    findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajerosBloqueados: vi.fn(async () => new Set<string>()),
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

describe("R8 — generarGuia (rama GAM con mensajero)", () => {
  it.each(NO_ASIGNABLES)("motivo %s -> conflict SIN persistir", async (estado) => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate({ o1: estado }));

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m1" }] },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: estado }]);
    }
    // Sin efectos: ni una escritura.
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("TODO-O-NADA: una sola orden no asignable aborta el lote entero", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2" }),
        ordenRow({ id: "o3" }),
      ]),
    });
    const service = new GuiaAsignacionService(
      repo,
      fakeZonaRepo(),
      gate({ o2: "geocodificacion_agotada" }),
    );

    const r = await service.generarGuia(
      {
        decisiones: [
          { ordenId: "o1", mensajeroId: "m1" },
          { ordenId: "o2", mensajeroId: "m1" },
          { ordenId: "o3", mensajeroId: "m1" },
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      // Solo la conflictiva aparece en el detalle, pero NINGUNA se persiste.
      expect(r.detalle).toEqual([{ ordenId: "o2", motivo: "geocodificacion_agotada" }]);
    }
    expect(repo.generarGuiaLote).not.toHaveBeenCalled();
  });

  it("todas asignables -> persiste con normalidad", async () => {
    const repo = fakeRepo();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate());

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m1" }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(repo.generarGuiaLote).toHaveBeenCalledTimes(1);
  });

  it("una orden GAM SIN mensajero (va a bodega) NO pasa por el gate", async () => {
    // No se le asigna a nadie: exigirle coordenadas ahora bloquearia el flujo de bodega
    // sin ninguna ganancia. Se le exigiran cuando la bodega la asigne.
    const repo = fakeRepo();
    const g = gate();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    // Ni siquiera se invoca al gate: sin ids que evaluar, se corta antes.
    expect(g.evaluar).not.toHaveBeenCalled();
    expect(repo.findParaAsignabilidad).not.toHaveBeenCalled();
  });

  it("una orden NO-GAM (ruteo a satelite) tampoco pasa por el gate", async () => {
    const repo = fakeRepo({
      findByIdsForTransicion: vi.fn(async () => [
        ordenRow({ id: "o1", zonaId: "z-limon", zonaEsGam: false }),
      ]),
    });
    const g = gate();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g);

    const r = await service.generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    // Ni siquiera se invoca al gate: sin ids que evaluar, se corta antes.
    expect(g.evaluar).not.toHaveBeenCalled();
  });
});

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

  it.each(NO_ASIGNABLES)("motivo %s -> conflict SIN persistir", async (estado) => {
    const repo = repoBodega();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate({ o1: estado }));

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
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), g);

    await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(repo.findParaAsignabilidad).toHaveBeenCalledWith(["o1", "o2"]);
  });

  it("todas asignables -> persiste con normalidad", async () => {
    const repo = repoBodega();
    const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate());

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
    );

    await service.asignarDesdeBodega({ ordenIds: ["o1", "o2"], mensajeroId: "m1" }, MAESTRO);

    expect(orden).toContain("gate");
    expect(orden.filter((o) => o.startsWith("estatus:en_espera"))).toHaveLength(0);
  });
});
