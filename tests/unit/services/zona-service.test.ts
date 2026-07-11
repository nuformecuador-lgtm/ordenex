import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { ZonaService } from "@/lib/services/ZonaService";
import {
  DistritosInexistentesError,
  DistritosYaAsignadosError,
  type IZonaRepository,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type { Actor } from "@/lib/interfaces/services/IZonaService";
import type { ZonaDTO } from "@/lib/types/zona";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

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

function buildRepo(over: Partial<IZonaRepository> = {}): IZonaRepository {
  return {
    create: vi.fn().mockResolvedValue(dto()),
    findById: vi.fn().mockResolvedValue(dto()),
    findByNombreKey: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ items: [dto()], total: 1 }),
    update: vi.fn().mockResolvedValue(dto()),
    setGam: vi.fn().mockResolvedValue(true),
    listLight: vi.fn().mockResolvedValue([{ id: "z1", nombre: "Zona Sur", esGam: false }]),
    findGamZonaId: vi.fn().mockResolvedValue(null),
    ...over,
  };
}

function buildGeo(over: Partial<IGeoRepository> = {}): IGeoRepository {
  return {
    listProvincias: vi.fn().mockResolvedValue([{ id: "p1", nombre: "San Jose" }]),
    listCantones: vi.fn().mockResolvedValue([{ id: "c1", nombre: "Central" }]),
    listDistritos: vi
      .fn()
      .mockResolvedValue([{ id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null }]),
    ...over,
  };
}

const crearInput = {
  nombre: "Zona Sur",
  pagoEntrega: 1000,
  pagoRechazo: 500,
  esGam: false,
  distritoIds: ["d1", "d2"],
};

describe("ZonaService — autorizacion (R16)", () => {
  it("mensajero/desconocido -> forbidden en escritura y lectura", async () => {
    const svc = new ZonaService(buildRepo(), buildGeo());
    for (const actor of [MENSAJERO, DESCONOCIDO]) {
      expect((await svc.crear(crearInput, actor)).status).toBe("forbidden");
      expect((await svc.actualizar({ id: "z1", nombre: "N" }, actor)).status).toBe("forbidden");
      expect((await svc.marcarGam("z1", actor)).status).toBe("forbidden");
      expect((await svc.listar({ page: 1, pageSize: 25 }, actor)).status).toBe("forbidden");
      expect((await svc.listarProvincias(actor)).status).toBe("forbidden");
    }
  });

  it("admin lee (listar/catalogo/light) pero NO escribe (crear/actualizar/marcarGam)", async () => {
    const svc = new ZonaService(buildRepo(), buildGeo());
    expect((await svc.listar({ page: 1, pageSize: 25 }, ADMIN)).status).toBe("ok");
    expect((await svc.listarLight(ADMIN)).status).toBe("ok");
    expect((await svc.listarProvincias(ADMIN)).status).toBe("ok");
    expect((await svc.listarDistritos("c1", ADMIN)).status).toBe("ok");
    expect((await svc.crear(crearInput, ADMIN)).status).toBe("forbidden");
    expect((await svc.actualizar({ id: "z1", nombre: "N" }, ADMIN)).status).toBe("forbidden");
    expect((await svc.marcarGam("z1", ADMIN)).status).toBe("forbidden");
  });
});

describe("ZonaService.crear (R17/R19/R20/R21)", () => {
  it("R17: crea con nombre valido -> ok con la zona", async () => {
    const repo = buildRepo();
    const svc = new ZonaService(repo, buildGeo());
    const r = await svc.crear(crearInput, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.zona.nombre).toBe("Zona Sur");
    // el nombre se persiste en forma canonica
    expect((repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0].nombre).toBe("Zona Sur");
  });

  it("R21: nombre duplicado por clave normalizada -> conflict(nombre)", async () => {
    const repo = buildRepo({ findByNombreKey: vi.fn().mockResolvedValue({ id: "otra" }) });
    const svc = new ZonaService(repo, buildGeo());
    const r = await svc.crear({ ...crearInput, nombre: "ZONA SUR" }, MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.reason).toBe("nombre");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R20: distrito ya asignado a otra zona -> conflict(distrito) con los ids", async () => {
    const repo = buildRepo({
      create: vi.fn().mockRejectedValue(new DistritosYaAsignadosError(["d2"])),
    });
    const svc = new ZonaService(repo, buildGeo());
    const r = await svc.crear(crearInput, MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.reason).toBe("distrito");
      expect(r.distritoIds).toEqual(["d2"]);
    }
  });

  it("R19: distrito inexistente -> validation_error", async () => {
    const repo = buildRepo({
      create: vi.fn().mockRejectedValue(new DistritosInexistentesError(["d9"])),
    });
    const svc = new ZonaService(repo, buildGeo());
    const r = await svc.crear(crearInput, MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("distritoIds");
  });
});

describe("ZonaService.actualizar (R22)", () => {
  it("edita una zona existente -> ok", async () => {
    const svc = new ZonaService(buildRepo(), buildGeo());
    const r = await svc.actualizar({ id: "z1", pagoEntrega: 2000 }, MAESTRO);
    expect(r.status).toBe("ok");
  });

  it("zona inexistente -> not_found", async () => {
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    const svc = new ZonaService(repo, buildGeo());
    const r = await svc.actualizar({ id: "zX", nombre: "N" }, MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("R21: renombrar a un nombre ya usado -> conflict(nombre)", async () => {
    const repo = buildRepo({ findByNombreKey: vi.fn().mockResolvedValue({ id: "otra" }) });
    const svc = new ZonaService(repo, buildGeo());
    const r = await svc.actualizar({ id: "z1", nombre: "GAM" }, MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.reason).toBe("nombre");
  });
});

describe("ZonaService.marcarGam (R23)", () => {
  it("marca la zona -> ok", async () => {
    const repo = buildRepo();
    const svc = new ZonaService(repo, buildGeo());
    const r = await svc.marcarGam("z1", MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.setGam).toHaveBeenCalledWith("z1");
  });

  it("zona inexistente -> not_found", async () => {
    const repo = buildRepo({ setGam: vi.fn().mockResolvedValue(false) });
    const svc = new ZonaService(repo, buildGeo());
    expect((await svc.marcarGam("zX", MAESTRO)).status).toBe("not_found");
  });
});

describe("ZonaService.listar (R24) y catalogo (R14/R15)", () => {
  it("R24: listar paginado -> items + total + page/pageSize", async () => {
    const svc = new ZonaService(buildRepo(), buildGeo());
    const r = await svc.listar({ page: 2, pageSize: 10 }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.total).toBe(1);
      expect(r.page).toBe(2);
      expect(r.items[0].distritosCount).toBe(2);
    }
  });

  it("R24: calcula skip = (page-1)*pageSize", async () => {
    const repo = buildRepo();
    const svc = new ZonaService(repo, buildGeo());
    await svc.listar({ page: 3, pageSize: 20 }, MAESTRO);
    expect((repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ skip: 40, take: 20 });
  });

  it("R14: catalogo geografico (provincias/cantones/distritos) -> ok", async () => {
    const geo = buildGeo();
    const svc = new ZonaService(buildRepo(), geo);
    expect((await svc.listarCantones("p1", MAESTRO)).status).toBe("ok");
    expect(geo.listCantones).toHaveBeenCalledWith("p1");
    const d = await svc.listarDistritos("c1", MAESTRO);
    expect(d.status).toBe("ok");
    if (d.status === "ok") expect(d.items[0]).toHaveProperty("zonaId");
  });

  it("R15: listado ligero -> id/nombre/esGam", async () => {
    const svc = new ZonaService(buildRepo(), buildGeo());
    const r = await svc.listarLight(MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items[0]).toEqual({ id: "z1", nombre: "Zona Sur", esGam: false });
  });
});
