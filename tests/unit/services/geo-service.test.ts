import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { GeoService } from "@/lib/services/GeoService";
import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type { Actor } from "@/lib/interfaces/services/IGeoService";
import type {
  CantonLightDTO,
  DistritoCatalogoDTO,
  ProvinciaLightDTO,
} from "@/lib/types/zona";

// Feature 55/R10: GeoService delgado sobre IGeoRepository, con gate maestro.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "x", rol: "mensajero" };
const TIENDA: Actor = { usuarioId: "t", rol: "adminTienda" };
const DESCONOCIDO: Actor = { usuarioId: "z", rol: "invitado" as RolValue };
const NO_MAESTROS = [ADMIN, MENSAJERO, TIENDA, DESCONOCIDO];

const PROVINCIAS: ProvinciaLightDTO[] = [{ id: "p1", nombre: "San Jose" }];
const CANTONES: CantonLightDTO[] = [{ id: "c1", nombre: "Central" }];
const DISTRITOS: DistritoCatalogoDTO[] = [
  { id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null },
  { id: "d2", nombre: "Merced", zonaId: "zOtra", zonaNombre: "Zona Norte" },
];

function buildRepo(overrides: Partial<IGeoRepository> = {}): IGeoRepository {
  return {
    listProvincias: vi.fn().mockResolvedValue(PROVINCIAS),
    listCantones: vi.fn().mockResolvedValue(CANTONES),
    listDistritos: vi.fn().mockResolvedValue(DISTRITOS),
    ...overrides,
  };
}

describe("GeoService — gate maestro (R1/R10)", () => {
  it.each(NO_MAESTROS)("listarProvincias: rol %o -> forbidden sin tocar el repo", async (actor) => {
    const repo = buildRepo();
    const r = await new GeoService(repo).listarProvincias(actor);
    expect(r.status).toBe("forbidden");
    expect(repo.listProvincias).not.toHaveBeenCalled();
  });

  it.each(NO_MAESTROS)("listarCantones: rol %o -> forbidden", async (actor) => {
    const repo = buildRepo();
    const r = await new GeoService(repo).listarCantones("p1", actor);
    expect(r.status).toBe("forbidden");
    expect(repo.listCantones).not.toHaveBeenCalled();
  });

  it.each(NO_MAESTROS)("listarDistritos: rol %o -> forbidden", async (actor) => {
    const repo = buildRepo();
    const r = await new GeoService(repo).listarDistritos("c1", actor);
    expect(r.status).toBe("forbidden");
    expect(repo.listDistritos).not.toHaveBeenCalled();
  });
});

describe("GeoService — maestro obtiene items del repo (R10)", () => {
  it("listarProvincias devuelve las provincias del repo", async () => {
    const repo = buildRepo();
    const r = await new GeoService(repo).listarProvincias(MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toEqual(PROVINCIAS);
  });

  it("listarCantones pasa el provinciaId al repo y devuelve los cantones", async () => {
    const repo = buildRepo();
    const r = await new GeoService(repo).listarCantones("p1", MAESTRO);
    expect(repo.listCantones).toHaveBeenCalledWith("p1");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toEqual(CANTONES);
  });

  it("listarDistritos propaga zonaId/zonaNombre de OTRA zona tal cual (para deshabilitar en UI)", async () => {
    const repo = buildRepo();
    const r = await new GeoService(repo).listarDistritos("c1", MAESTRO);
    expect(repo.listDistritos).toHaveBeenCalledWith("c1");
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      const ocupado = r.items.find((d) => d.id === "d2");
      expect(ocupado).toEqual({ id: "d2", nombre: "Merced", zonaId: "zOtra", zonaNombre: "Zona Norte" });
      const libre = r.items.find((d) => d.id === "d1");
      expect(libre?.zonaId).toBeNull();
    }
  });
});
