import { describe, it, expect, vi } from "vitest";
import {
  generarGuia,
  asignarDesdeBodega,
  listarMensajerosParaAsignacion,
  listarCatalogoEstatus,
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
    const ordenRepo = { findAllMensajeros: vi.fn() };
    const r = await listarMensajerosParaAsignacion({ ordenRepo, getActor: getActor(null) });

    expect(r.status).toBe("unauthenticated");
    expect(ordenRepo.findAllMensajeros).not.toHaveBeenCalled();
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

describe("R28: listarMensajerosParaAsignacion devuelve la lista SIN filtro de zona", () => {
  it("maestro: repo.findAllMensajeros sin argumentos (no recibe zonaId)", async () => {
    const findAllMensajeros = vi.fn().mockResolvedValue([
      { id: "m1", nombre: "Ana" },
      { id: "m2", nombre: "Beto" },
    ]);
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: { findAllMensajeros },
      getActor: getActor(MAESTRO),
    });

    expect(r).toEqual({
      status: "ok",
      mensajeros: [
        { id: "m1", nombre: "Ana" },
        { id: "m2", nombre: "Beto" },
      ],
    });
    expect(findAllMensajeros).toHaveBeenCalledWith(); // sin parametros: sin filtro de zona
  });

  it("admin (solo-lectura del modulo) tambien puede listar", async () => {
    const findAllMensajeros = vi.fn().mockResolvedValue([]);
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: { findAllMensajeros },
      getActor: getActor(ADMIN),
    });

    expect(r.status).toBe("ok");
  });

  it("mensajero/adminTienda -> forbidden", async () => {
    const findAllMensajeros = vi.fn();
    const r = await listarMensajerosParaAsignacion({
      ordenRepo: { findAllMensajeros },
      getActor: getActor({ usuarioId: "u-msg", rol: "mensajero" }),
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(findAllMensajeros).not.toHaveBeenCalled();
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
