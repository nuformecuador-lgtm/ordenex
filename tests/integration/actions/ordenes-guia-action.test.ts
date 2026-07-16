import { describe, it, expect, vi } from "vitest";
import {
  generarGuia,
  asignarDesdeBodega,
  listarMensajerosParaAsignacion,
  listarCatalogoEstatus,
  rutearABodegaSatelite,
} from "@/lib/actions/ordenes-guia";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGuiaAsignacionService } from "@/lib/interfaces/services/IGuiaAsignacionService";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const getActor = (actor: Actor | null) => async (): Promise<Actor | null> => actor;

function fakeGuiaService(overrides: Partial<IGuiaAsignacionService> = {}): IGuiaAsignacionService {
  return {
    generarGuia: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    asignarDesdeBodega: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    rutearABodegaSatelite: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    ...overrides,
  };
}

describe("R14: sin sesion valida -> unauthenticated antes de tocar el service", () => {
  it("generarGuia", async () => {
    const service = fakeGuiaService();
    const r = await generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      { guiaService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.generarGuia).not.toHaveBeenCalled();
  });

  it("asignarDesdeBodega", async () => {
    const service = fakeGuiaService();
    const r = await asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { guiaService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.asignarDesdeBodega).not.toHaveBeenCalled();
  });

  it("listarMensajerosParaAsignacion", async () => {
    const ordenRepo = {
      findMensajerosByZona: vi.fn(),
      findMensajerosBloqueados: vi.fn(),
    };
    const zonaRepo = { findCentralZonaId: vi.fn() };
    const r = await listarMensajerosParaAsignacion({ ordenRepo, zonaRepo, getActor: getActor(null) });

    expect(r.status).toBe("unauthenticated");
    expect(zonaRepo.findCentralZonaId).not.toHaveBeenCalled();
    expect(ordenRepo.findMensajerosByZona).not.toHaveBeenCalled();
  });

  it("rutearABodegaSatelite", async () => {
    const service = fakeGuiaService();
    const r = await rutearABodegaSatelite(
      { ordenIds: ["o1"] },
      { guiaService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.rutearABodegaSatelite).not.toHaveBeenCalled();
  });

  it("listarCatalogoEstatus", async () => {
    const ordenRepo = { listOrderStatus: vi.fn() };
    const r = await listarCatalogoEstatus({ ordenRepo, getActor: getActor(null) });

    expect(r.status).toBe("unauthenticated");
    expect(ordenRepo.listOrderStatus).not.toHaveBeenCalled();
  });
});

describe("R12: admin en escritura -> forbidden (delegado al service, sin transformar)", () => {
  it("generarGuia", async () => {
    const service = fakeGuiaService({
      generarGuia: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const r = await generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      { guiaService: service, getActor: getActor(ADMIN) },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(service.generarGuia).toHaveBeenCalledWith(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      ADMIN,
    );
  });

  it("asignarDesdeBodega", async () => {
    const service = fakeGuiaService({
      asignarDesdeBodega: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const r = await asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { guiaService: service, getActor: getActor(ADMIN) },
    );

    expect(r).toEqual({ status: "forbidden" });
  });
});

describe("generarGuia — validacion de entrada (zod)", () => {
  it("input invalido -> validation_error sin llamar al service", async () => {
    const service = fakeGuiaService();
    const r = await generarGuia({ decisiones: "no-es-array" }, { guiaService: service, getActor: getActor(MAESTRO) });

    expect(r.status).toBe("validation_error");
    expect(service.generarGuia).not.toHaveBeenCalled();
  });

  it("mensajeroId ausente (undefined) es invalido; null si es valido", async () => {
    const service = fakeGuiaService();
    const r = await generarGuia(
      { decisiones: [{ ordenId: "o1" }] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
  });
});

describe("generarGuia — camino ok delega al service con el actor resuelto", () => {
  it("llama al service y devuelve su resultado tal cual", async () => {
    const service = fakeGuiaService({
      generarGuia: vi.fn().mockResolvedValue({
        status: "ok",
        resultados: [{ ordenId: "o1", numGuia: 10, estado: "en_bodega" }],
      }),
    });

    const r = await generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: null }] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r).toEqual({
      status: "ok",
      resultados: [{ ordenId: "o1", numGuia: 10, estado: "en_bodega" }],
    });
  });
});

describe("Feature 30/R5: listarMensajerosParaAsignacion devuelve SOLO mensajeros de la zona GAM", () => {
  it("maestro: resuelve gamZonaId y llama findMensajerosByZona con esa zona", async () => {
    const findCentralZonaId = vi.fn().mockResolvedValue("z-gam");
    const findMensajerosByZona = vi.fn().mockResolvedValue([
      { id: "m1", nombre: "Ana" },
      { id: "m2", nombre: "Beto" },
    ]);
    // Ajuste maestro: m2 tiene un cierre abierto -> viaja en bloqueadosIds.
    const findMensajerosBloqueados = vi
      .fn()
      .mockResolvedValue(new Set(["m2"]));
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: { findMensajerosByZona, findMensajerosBloqueados },
      zonaRepo: { findCentralZonaId },
      getActor: getActor(MAESTRO),
    });

    expect(r).toEqual({
      status: "ok",
      mensajeros: [
        { id: "m1", nombre: "Ana" },
        { id: "m2", nombre: "Beto" },
      ],
      bloqueadosIds: ["m2"],
    });
    expect(findMensajerosByZona).toHaveBeenCalledWith("z-gam"); // R5: filtrado por zona GAM
    expect(findMensajerosBloqueados).toHaveBeenCalledWith(["m1", "m2"]);
  });

  it("R5: sin zona GAM configurada -> lista vacia, sin consultar mensajeros", async () => {
    const findCentralZonaId = vi.fn().mockResolvedValue(null);
    const findMensajerosByZona = vi.fn();
    const findMensajerosBloqueados = vi.fn();
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: { findMensajerosByZona, findMensajerosBloqueados },
      zonaRepo: { findCentralZonaId },
      getActor: getActor(MAESTRO),
    });

    expect(r).toEqual({ status: "ok", mensajeros: [] });
    expect(findMensajerosByZona).not.toHaveBeenCalled();
  });

  it("admin (solo-lectura del modulo) tambien puede listar", async () => {
    const findCentralZonaId = vi.fn().mockResolvedValue("z-gam");
    const findMensajerosByZona = vi.fn().mockResolvedValue([]);
    const findMensajerosBloqueados = vi.fn().mockResolvedValue(new Set());
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: { findMensajerosByZona, findMensajerosBloqueados },
      zonaRepo: { findCentralZonaId },
      getActor: getActor(ADMIN),
    });

    expect(r.status).toBe("ok");
  });

  it("mensajero/adminTienda -> forbidden", async () => {
    const findCentralZonaId = vi.fn();
    const findMensajerosByZona = vi.fn();
    const findMensajerosBloqueados = vi.fn();
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: { findMensajerosByZona, findMensajerosBloqueados },
      zonaRepo: { findCentralZonaId },
      getActor: getActor({ usuarioId: "u-msg", rol: "mensajero" }),
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(findCentralZonaId).not.toHaveBeenCalled();
    expect(findMensajerosByZona).not.toHaveBeenCalled();
  });
});

describe("Feature 30/R13/R16: rutearABodegaSatelite (server action)", () => {
  it("input invalido -> validation_error sin llamar al service", async () => {
    const service = fakeGuiaService();
    const r = await rutearABodegaSatelite(
      { ordenIds: "no-es-array" },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    expect(service.rutearABodegaSatelite).not.toHaveBeenCalled();
  });

  it("camino ok delega al service con el actor resuelto y devuelve su resultado", async () => {
    const service = fakeGuiaService({
      rutearABodegaSatelite: vi.fn().mockResolvedValue({
        status: "ok",
        resultados: [{ ordenId: "o1", estado: "en_ruta_bodega_satelite" }],
      }),
    });
    const r = await rutearABodegaSatelite(
      { ordenIds: ["o1"] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r).toEqual({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "en_ruta_bodega_satelite" }],
    });
    expect(service.rutearABodegaSatelite).toHaveBeenCalledWith({ ordenIds: ["o1"] }, MAESTRO);
  });
});

describe("R15/R16: listarCatalogoEstatus devuelve el catalogo order_status (id, value)", () => {
  it("maestro: repo.listOrderStatus resuelve el catalogo completo", async () => {
    const listOrderStatus = vi.fn().mockResolvedValue([
      { id: "os-1", value: "en_fulfillment" },
      { id: "os-2", value: "en_preparacion" },
      { id: "os-3", value: "en_espera_aceptacion" },
      { id: "os-4", value: "en_bodega" },
    ]);
    const r = await listarCatalogoEstatus({
      ordenRepo: { listOrderStatus },
      getActor: getActor(MAESTRO),
    });

    expect(r).toEqual({
      status: "ok",
      estatus: [
        { id: "os-1", value: "en_fulfillment" },
        { id: "os-2", value: "en_preparacion" },
        { id: "os-3", value: "en_espera_aceptacion" },
        { id: "os-4", value: "en_bodega" },
      ],
    });
    expect(listOrderStatus).toHaveBeenCalledWith();
  });

  it("admin (solo-lectura del modulo) tambien puede listar", async () => {
    const listOrderStatus = vi.fn().mockResolvedValue([]);
    const r = await listarCatalogoEstatus({
      ordenRepo: { listOrderStatus },
      getActor: getActor(ADMIN),
    });

    expect(r.status).toBe("ok");
  });

  it("mensajero/adminTienda -> forbidden", async () => {
    const listOrderStatus = vi.fn();
    const r = await listarCatalogoEstatus({
      ordenRepo: { listOrderStatus },
      getActor: getActor({ usuarioId: "u-msg", rol: "mensajero" }),
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(listOrderStatus).not.toHaveBeenCalled();
  });
});
