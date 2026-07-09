import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RolPermisoRepository } from "@/lib/repositories/RolPermisoRepository";

// Prisma MOCKEADO. Verifica el comportamiento code-level de la pivote N:M.

type MockedPrisma = Pick<PrismaClient, "rolPermiso">;

describe("RolPermisoRepository", () => {
  it("asocia un rol con un permiso en la pivote rol_permiso (R7)", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ rolId: "rol-1", permisoId: "perm-1", createdAt: new Date() });
    const prisma = { rolPermiso: { create } } as unknown as MockedPrisma;
    const repo = new RolPermisoRepository(prisma);

    const asociacion = await repo.asociar({ rolId: "rol-1", permisoId: "perm-1" });

    expect(create).toHaveBeenCalledWith({
      data: { rolId: "rol-1", permisoId: "perm-1" },
    });
    expect(asociacion.rolId).toBe("rol-1");
    expect(asociacion.permisoId).toBe("perm-1");
  });

  it("permite leer ambos lados de la relacion N:M: por rol y por permiso (R7)", async () => {
    // Un rol con varios permisos.
    const permisosDelRol = [
      { rolId: "rol-1", permisoId: "perm-1", createdAt: new Date() },
      { rolId: "rol-1", permisoId: "perm-2", createdAt: new Date() },
    ];
    // Un permiso compartido por varios roles.
    const rolesDelPermiso = [
      { rolId: "rol-1", permisoId: "perm-1", createdAt: new Date() },
      { rolId: "rol-2", permisoId: "perm-1", createdAt: new Date() },
    ];
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(permisosDelRol)
      .mockResolvedValueOnce(rolesDelPermiso);
    const prisma = { rolPermiso: { findMany } } as unknown as MockedPrisma;
    const repo = new RolPermisoRepository(prisma);

    const porRol = await repo.listarPorRol("rol-1");
    expect(porRol).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith({ where: { rolId: "rol-1" } });

    const porPermiso = await repo.listarPorPermiso("perm-1");
    expect(porPermiso).toHaveLength(2);
    expect(findMany).toHaveBeenLastCalledWith({ where: { permisoId: "perm-1" } });
  });

  it("contar devuelve el numero de asociaciones; 0 tras migrar sin seed (R11)", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const prisma = { rolPermiso: { count } } as unknown as MockedPrisma;
    const repo = new RolPermisoRepository(prisma);

    await expect(repo.contar()).resolves.toBe(0);
    expect(count).toHaveBeenCalledOnce();
  });
});
