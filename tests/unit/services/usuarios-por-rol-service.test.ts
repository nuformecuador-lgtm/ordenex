import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { UsuariosPorRolService } from "@/lib/services/UsuariosPorRolService";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function buildUserRepo(overrides: Partial<IUserRepository> = {}): IUserRepository {
  return {
    findByEmailWithHash: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    listByRol: vi.fn().mockResolvedValue([{ id: "u-1", nombre: "Ada" }]),
    listMensajeros: vi.fn().mockResolvedValue([]),
    listAdminTiendas: vi.fn().mockResolvedValue([{ id: "t-1", nombre: "Tienda Uno" }]),
    updatePasswordHash: vi.fn(),
    list: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    setEstado: vi.fn(),
    listTiposIdentificacion: vi.fn(),
    listRoles: vi.fn(),
    ...overrides,
  };
}

describe("UsuariosPorRolService.listarPorRol", () => {
  it("adminTienda/maestro/admin -> ok con la proyeccion del repo", async () => {
    for (const actor of [TIENDA, MAESTRO, ADMIN]) {
      const repo = buildUserRepo();
      const service = new UsuariosPorRolService(repo);
      const r = await service.listarPorRol("mensajero", actor);
      expect(r.status).toBe("ok");
      if (r.status === "ok") expect(r.usuarios).toEqual([{ id: "u-1", nombre: "Ada" }]);
      expect(repo.listByRol).toHaveBeenCalledWith("mensajero");
    }
  });

  it("rol no autorizado -> forbidden sin tocar el repo", async () => {
    for (const actor of [MENSAJERO, DESCONOCIDO]) {
      const repo = buildUserRepo();
      const service = new UsuariosPorRolService(repo);
      const r = await service.listarPorRol("adminTienda", actor);
      expect(r.status).toBe("forbidden");
      expect(repo.listByRol).not.toHaveBeenCalled();
    }
  });
});

describe("UsuariosPorRolService.listarAdminTiendas", () => {
  it("delega en listarPorRol('adminTienda') -> userRepo.listByRol('adminTienda')", async () => {
    const repo = buildUserRepo();
    const service = new UsuariosPorRolService(repo);
    const r = await service.listarAdminTiendas(MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.usuarios).toEqual([{ id: "u-1", nombre: "Ada" }]);
    expect(repo.listByRol).toHaveBeenCalledWith("adminTienda");
  });

  it("hereda la autorizacion -> forbidden para roles no permitidos", async () => {
    const repo = buildUserRepo();
    const service = new UsuariosPorRolService(repo);
    const r = await service.listarAdminTiendas(MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.listByRol).not.toHaveBeenCalled();
  });
});
