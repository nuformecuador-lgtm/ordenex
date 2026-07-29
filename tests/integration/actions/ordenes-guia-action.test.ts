import { describe, it, expect, vi } from "vitest";
import {
  generarGuia,
  asignarDesdeBodega,
  listarMensajerosParaAsignacion,
  listarCatalogoEstatus,
  listarZonasBloqueadasPorCierre,
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
      { ordenIds: ["o1"] },
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

describe("feature 94: admin en escritura -> permitido (delegado al service con el actor, sin transformar)", () => {
  it("generarGuia", async () => {
    const service = fakeGuiaService({
      generarGuia: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    });
    const r = await generarGuia(
      { ordenIds: ["o1"] },
      { guiaService: service, getActor: getActor(ADMIN) },
    );

    expect(r).toEqual({ status: "ok", resultados: [] });
    expect(service.generarGuia).toHaveBeenCalledWith({ ordenIds: ["o1"] }, ADMIN);
  });

  it("asignarDesdeBodega", async () => {
    const service = fakeGuiaService({
      asignarDesdeBodega: vi.fn().mockResolvedValue({ status: "ok", resultados: [] }),
    });
    const r = await asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { guiaService: service, getActor: getActor(ADMIN) },
    );

    expect(r).toEqual({ status: "ok", resultados: [] });
    expect(service.asignarDesdeBodega).toHaveBeenCalledWith(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      ADMIN,
    );
  });
});

// Feature 156/R14 — la entrada de generar guia es un LOTE DE IDS y nada mas. El contrato
// previo (`decisiones: [{ ordenId, mensajeroId }]`) ya no valida, y ningun dato de mensajero
// llega al service.
describe("generarGuia — validacion de entrada (zod, 156/R14)", () => {
  it("input invalido -> validation_error sin llamar al service", async () => {
    const service = fakeGuiaService();
    const r = await generarGuia(
      { ordenIds: "no-es-array" },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    expect(service.generarGuia).not.toHaveBeenCalled();
  });

  it("156/R14: el contrato viejo con decisiones/mensajeroId -> validation_error, sin llamar al service", async () => {
    const service = fakeGuiaService();
    const r = await generarGuia(
      { decisiones: [{ ordenId: "o1", mensajeroId: "m1" }] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.ordenIds).toBeDefined(); // el motivo es la falta de `ordenIds`
    expect(service.generarGuia).not.toHaveBeenCalled();
  });

  it("156/R14: un mensajeroId colado junto a ordenIds NO llega al service", async () => {
    const service = fakeGuiaService();
    await generarGuia(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    // zod descarta lo no declarado: el service recibe EXACTAMENTE el lote de ids.
    expect(service.generarGuia).toHaveBeenCalledWith({ ordenIds: ["o1"] }, MAESTRO);
  });

  it("ordenIds vacio es valido (lote vacio); un id vacio no lo es", async () => {
    const service = fakeGuiaService();
    const rVacio = await generarGuia(
      { ordenIds: [] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );
    expect(rVacio.status).toBe("ok");

    const rIdVacio = await generarGuia(
      { ordenIds: [""] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );
    expect(rIdVacio.status).toBe("validation_error");
  });
});

describe("generarGuia — camino ok delega al service con el actor resuelto", () => {
  it("llama al service y devuelve su resultado tal cual", async () => {
    const service = fakeGuiaService({
      generarGuia: vi.fn().mockResolvedValue({
        status: "ok",
        resultados: [{ ordenId: "o1", numGuia: 10, estado: "en_bodega_central" }],
      }),
    });

    const r = await generarGuia(
      { ordenIds: ["o1"] },
      { guiaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r).toEqual({
      status: "ok",
      resultados: [{ ordenId: "o1", numGuia: 10, estado: "en_bodega_central" }],
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

  it("feature 94: admin (paridad con maestro) tambien puede listar", async () => {
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
      { id: "os-3", value: "por_recoger" },
      { id: "os-4", value: "en_bodega_central" },
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
        { id: "os-3", value: "por_recoger" },
        { id: "os-4", value: "en_bodega_central" },
      ],
    });
    expect(listOrderStatus).toHaveBeenCalledWith();
  });

  it("feature 94: admin (paridad con maestro) tambien puede listar", async () => {
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

// Gate de seleccion del maestro (decision del humano 2026-07-16): la UI deshabilita el
// checkbox de las ordenes cuya zona tenga >=1 mensajero con cierre abierto. Cubre TODAS
// las zonas (central GAM y satelites) con la misma regla que la guarda de escritura.
describe("listarZonasBloqueadasPorCierre — zonas con >=1 mensajero en cierre", () => {
  it("devuelve las zonasBloqueadasIds del repo (central y satelite por igual)", async () => {
    const findZonasConMensajeroBloqueado = vi
      .fn()
      .mockResolvedValue(new Set(["z-gam", "z-limon"]));
    const r = await listarZonasBloqueadasPorCierre({
      ordenRepo: { findZonasConMensajeroBloqueado },
      getActor: getActor(MAESTRO),
    });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(new Set(r.zonasBloqueadasIds)).toEqual(new Set(["z-gam", "z-limon"]));
  });

  it("ninguna zona con cierre abierto -> lista vacia (nada se deshabilita)", async () => {
    const r = await listarZonasBloqueadasPorCierre({
      ordenRepo: { findZonasConMensajeroBloqueado: vi.fn().mockResolvedValue(new Set()) },
      getActor: getActor(MAESTRO),
    });

    expect(r).toEqual({ status: "ok", zonasBloqueadasIds: [] });
  });

  it("feature 94: admin (paridad con maestro) tambien puede leer", async () => {
    const r = await listarZonasBloqueadasPorCierre({
      ordenRepo: { findZonasConMensajeroBloqueado: vi.fn().mockResolvedValue(new Set(["z1"])) },
      getActor: getActor(ADMIN),
    });

    expect(r).toEqual({ status: "ok", zonasBloqueadasIds: ["z1"] });
  });

  it("mensajero/adminTienda -> forbidden, sin consultar", async () => {
    const findZonasConMensajeroBloqueado = vi.fn();
    const r = await listarZonasBloqueadasPorCierre({
      ordenRepo: { findZonasConMensajeroBloqueado },
      getActor: getActor({ usuarioId: "u-msg", rol: "mensajero" }),
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(findZonasConMensajeroBloqueado).not.toHaveBeenCalled();
  });

  it("sin sesion -> unauthenticated, sin consultar", async () => {
    const findZonasConMensajeroBloqueado = vi.fn();
    const r = await listarZonasBloqueadasPorCierre({
      ordenRepo: { findZonasConMensajeroBloqueado },
      getActor: getActor(null),
    });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(findZonasConMensajeroBloqueado).not.toHaveBeenCalled();
  });
});
