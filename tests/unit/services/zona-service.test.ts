import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { ZonaService } from "@/lib/services/ZonaService";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IZonaService";
import type { CrearZonaInput, ZonaDTO } from "@/lib/types/zona";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "x", rol: "mensajero" };
const TIENDA: Actor = { usuarioId: "t", rol: "adminTienda" };
const DESCONOCIDO: Actor = { usuarioId: "z", rol: "invitado" as RolValue };
const NO_MAESTROS = [ADMIN, MENSAJERO, TIENDA, DESCONOCIDO];

function dto(overrides: Partial<ZonaDTO> = {}): ZonaDTO {
  return { id: "z1", nombre: "GAM", cobroVehiculo: false, esGam: false, distritosCount: 1, ...overrides };
}

function buildRepo(overrides: Partial<IZonaRepository> = {}): IZonaRepository {
  return {
    create: vi.fn().mockResolvedValue(dto()),
    findById: vi.fn().mockResolvedValue(dto()),
    list: vi.fn().mockResolvedValue({ items: [dto()], total: 1 }),
    update: vi.fn().mockResolvedValue(dto()),
    marcarGam: vi.fn().mockResolvedValue(dto({ esGam: true })),
    hardDelete: vi.fn().mockResolvedValue("ok"),
    arbol: vi.fn().mockResolvedValue({}),
    // por defecto: todos los ids existen.
    countExistingDistritos: vi.fn(async (ids: string[]) => ids.length),
    countExistingVehiculos: vi.fn(async (ids: string[]) => ids.length),
    ...overrides,
  };
}

function crearInput(overrides: Partial<CrearZonaInput> = {}): CrearZonaInput {
  return {
    nombre: "GAM",
    cobroVehiculo: false,
    esGam: false,
    distritoIds: ["d1"],
    tarifas: [],
    ...overrides,
  };
}

let repo: IZonaRepository;
let service: ZonaService;

beforeEach(() => {
  repo = buildRepo();
  service = new ZonaService(repo);
});

describe("autorizacion — solo maestro (feature 24)", () => {
  it("crear: maestro OK", async () => {
    const r = await service.crear(crearInput(), MAESTRO);
    expect(r.status).toBe("ok");
  });

  it.each(NO_MAESTROS)("crear: rol %o -> forbidden y no persiste", async (actor) => {
    const r = await service.crear(crearInput(), actor);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("listar/obtener/actualizar/borrar/arbol: no-maestro -> forbidden", async () => {
    expect((await service.listar({ page: 1, pageSize: 25 }, ADMIN)).status).toBe("forbidden");
    expect((await service.obtener("z1", ADMIN)).status).toBe("forbidden");
    expect((await service.actualizar("z1", crearInput(), ADMIN)).status).toBe("forbidden");
    expect((await service.borrar("z1", ADMIN)).status).toBe("forbidden");
    expect((await service.arbol(ADMIN)).status).toBe("forbidden");
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });
});

describe("crear — validacion de existencia", () => {
  it("distritoId inexistente -> validation_error", async () => {
    repo = buildRepo({ countExistingDistritos: vi.fn().mockResolvedValue(0) });
    service = new ZonaService(repo);
    const r = await service.crear(crearInput({ distritoIds: ["dX"] }), MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("distritoIds");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("vehiculoId inexistente -> validation_error", async () => {
    repo = buildRepo({ countExistingVehiculos: vi.fn().mockResolvedValue(0) });
    service = new ZonaService(repo);
    const input = crearInput({
      cobroVehiculo: true,
      tarifas: [{ cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "vX" }],
    });
    const r = await service.crear(input, MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("tarifas");
  });

  it("deduplica distritoIds antes de crear", async () => {
    await service.crear(crearInput({ distritoIds: ["d1", "d1", "d2"] }), MAESTRO);
    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.distritoIds).toEqual(["d1", "d2"]);
  });

  it("mapea vehiculoId undefined -> null hacia el repo", async () => {
    await service.crear(crearInput({ cobroVehiculo: false, tarifas: [{ cobroEntregado: 1, cobroRechazado: 2 }] }), MAESTRO);
    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.tarifas[0].vehiculoId).toBeNull();
  });
});

describe("borrar", () => {
  it("hardDelete ok -> ok", async () => {
    expect((await service.borrar("z1", MAESTRO)).status).toBe("ok");
  });
  it("hardDelete not_found -> not_found", async () => {
    repo = buildRepo({ hardDelete: vi.fn().mockResolvedValue("not_found") });
    service = new ZonaService(repo);
    expect((await service.borrar("zX", MAESTRO)).status).toBe("not_found");
  });
  it("hardDelete referenced -> conflict", async () => {
    repo = buildRepo({ hardDelete: vi.fn().mockResolvedValue("referenced") });
    service = new ZonaService(repo);
    expect((await service.borrar("z1", MAESTRO)).status).toBe("conflict");
  });
});

describe("listar — include", () => {
  it("include ['tarifas'] -> pide includeTarifas=true al repo", async () => {
    await service.listar({ page: 1, pageSize: 25, include: ["tarifas"] }, MAESTRO);
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.includeTarifas).toBe(true);
  });
  it("sin include -> includeTarifas=false", async () => {
    await service.listar({ page: 1, pageSize: 25 }, MAESTRO);
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.includeTarifas).toBe(false);
  });
});

describe("actualizar", () => {
  it("update devuelve null -> not_found", async () => {
    repo = buildRepo({ update: vi.fn().mockResolvedValue(null) });
    service = new ZonaService(repo);
    expect((await service.actualizar("zX", crearInput(), MAESTRO)).status).toBe("not_found");
  });
});

describe("marcarGam (feature 24/R3)", () => {
  it("maestro -> ok y delega en repo.marcarGam", async () => {
    const r = await service.marcarGam("z1", true, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.zona.esGam).toBe(true);
    expect(repo.marcarGam).toHaveBeenCalledWith("z1", true);
  });

  it.each(NO_MAESTROS)("rol %o -> forbidden sin tocar el repo", async (actor) => {
    const r = await service.marcarGam("z1", true, actor);
    expect(r.status).toBe("forbidden");
    expect(repo.marcarGam).not.toHaveBeenCalled();
  });

  it("zona inexistente -> not_found", async () => {
    repo = buildRepo({ marcarGam: vi.fn().mockResolvedValue(null) });
    service = new ZonaService(repo);
    expect((await service.marcarGam("zX", true, MAESTRO)).status).toBe("not_found");
  });
});
