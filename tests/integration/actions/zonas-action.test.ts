import { describe, it, expect, vi } from "vitest";
import {
  crearZona,
  obtenerZona,
  listarZonas,
  actualizarZona,
  marcarZonaGam,
  listarZonasLight,
  listarProvincias,
  listarCantones,
  listarDistritos,
} from "@/lib/actions/zonas";
import type { Actor, IZonaService } from "@/lib/interfaces/services/IZonaService";
import type { ZonaDTO } from "@/lib/types/zona";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const getActor = (a: Actor) => async (): Promise<Actor | null> => a;
const noActor = async (): Promise<Actor | null> => null;

function dto(over: Partial<ZonaDTO> = {}): ZonaDTO {
  return {
    id: "z1",
    nombre: "Zona Sur",
    pagoEntrega: 1000,
    pagoRechazo: 500,
    esGam: false,
    distritosCount: 2,
    ...over,
  };
}

function fakeService(over: Partial<IZonaService> = {}): IZonaService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", zona: dto() }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", zona: dto() }),
    listar: vi.fn().mockResolvedValue({ status: "ok", items: [dto()], page: 1, pageSize: 25, total: 1 }),
    actualizar: vi.fn().mockResolvedValue({ status: "ok", zona: dto() }),
    marcarGam: vi.fn().mockResolvedValue({ status: "ok" }),
    listarLight: vi.fn().mockResolvedValue({ status: "ok", items: [{ id: "z1", nombre: "Zona Sur", esGam: false }] }),
    listarProvincias: vi.fn().mockResolvedValue({ status: "ok", items: [{ id: "p1", nombre: "San Jose" }] }),
    listarCantones: vi.fn().mockResolvedValue({ status: "ok", items: [{ id: "c1", nombre: "Central" }] }),
    listarDistritos: vi
      .fn()
      .mockResolvedValue({ status: "ok", items: [{ id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null }] }),
    ...over,
  };
}

const validCrear = {
  nombre: "Zona Sur",
  pagoEntrega: 1000,
  pagoRechazo: 500,
  esGam: false,
  distritoIds: ["d1"],
};

describe("R13: sin sesion -> unauthenticated sin tocar el service", () => {
  it("todas las acciones rechazan sin sesion", async () => {
    const service = fakeService();
    const deps = { zonaService: service, getActor: noActor };
    expect((await crearZona(validCrear, deps)).status).toBe("unauthenticated");
    expect((await obtenerZona("z1", deps)).status).toBe("unauthenticated");
    expect((await listarZonas({}, deps)).status).toBe("unauthenticated");
    expect((await actualizarZona({ id: "z1" }, deps)).status).toBe("unauthenticated");
    expect((await marcarZonaGam("z1", deps)).status).toBe("unauthenticated");
    expect((await listarZonasLight(deps)).status).toBe("unauthenticated");
    expect((await listarProvincias(deps)).status).toBe("unauthenticated");
    expect((await listarCantones("p1", deps)).status).toBe("unauthenticated");
    expect((await listarDistritos("c1", deps)).status).toBe("unauthenticated");
    expect(service.crear).not.toHaveBeenCalled();
    expect(service.listar).not.toHaveBeenCalled();
    expect(service.listarProvincias).not.toHaveBeenCalled();
  });
});

describe("R19/R25: validation_error del schema sin llamar al service", () => {
  it("crear con nombre vacio -> validation_error", async () => {
    const service = fakeService();
    const r = await crearZona({ ...validCrear, nombre: "" }, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con distritoIds vacio -> validation_error", async () => {
    const service = fakeService();
    const r = await crearZona({ ...validCrear, distritoIds: [] }, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
  });
});

describe("R25: contrato discriminado por status (pass-through del service)", () => {
  it("forbidden se propaga", async () => {
    const service = fakeService({ crear: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await crearZona(validCrear, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("forbidden");
  });

  it("conflict(nombre) se propaga con su reason", async () => {
    const service = fakeService({
      crear: vi.fn().mockResolvedValue({ status: "conflict", reason: "nombre" }),
    });
    const r = await crearZona(validCrear, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.reason).toBe("nombre");
  });

  it("conflict(distrito) se propaga con los distritoIds", async () => {
    const service = fakeService({
      crear: vi.fn().mockResolvedValue({ status: "conflict", reason: "distrito", distritoIds: ["d2"] }),
    });
    const r = await crearZona(validCrear, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.distritoIds).toEqual(["d2"]);
  });

  it("not_found en actualizar se propaga", async () => {
    const service = fakeService({ actualizar: vi.fn().mockResolvedValue({ status: "not_found" }) });
    const r = await actualizarZona({ id: "zX", nombre: "N" }, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("not_found");
  });
});

describe("R26: DTO con montos number, sin campos internos", () => {
  it("crear ok expone solo status/zona y montos como number", async () => {
    const service = fakeService();
    const r = await crearZona(validCrear, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(Object.keys(r)).toEqual(["status", "zona"]);
      expect(typeof r.zona.pagoEntrega).toBe("number");
      expect(r.zona).not.toHaveProperty("deletedAt");
    }
  });
});

describe("R15: listarZonasLight", () => {
  it("devuelve items {id,nombre,esGam}", async () => {
    const service = fakeService();
    const r = await listarZonasLight({ zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items[0]).toEqual({ id: "z1", nombre: "Zona Sur", esGam: false });
  });
});

describe("R14: catalogo geografico via acciones", () => {
  it("listarProvincias/Cantones/Distritos -> ok", async () => {
    const service = fakeService();
    const deps = { zonaService: service, getActor: getActor(MAESTRO) };
    expect((await listarProvincias(deps)).status).toBe("ok");
    expect((await listarCantones("p1", deps)).status).toBe("ok");
    const d = await listarDistritos("c1", deps);
    expect(d.status).toBe("ok");
    if (d.status === "ok") expect(d.items[0]).toHaveProperty("zonaNombre");
  });
});
