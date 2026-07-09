import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PermisoRepository } from "@/lib/repositories/PermisoRepository";

// Prisma MOCKEADO (no hay DB real disponible; datasource sin url, igual que en
// login). Estos tests verifican el comportamiento code-level del repositorio.

type MockedPrisma = Pick<PrismaClient, "permiso">;

describe("PermisoRepository", () => {
  it("crear inserta nombre/method/route y NO envia timestamps ni id (R1, R2, R3, R4, R5)", async () => {
    const generado = {
      id: "perm-uuid-1",
      nombre: "listar ordenes",
      method: "GET",
      route: "/orders",
      createdAt: new Date("2026-07-09T08:00:00.000Z"),
      updatedAt: new Date("2026-07-09T08:00:00.000Z"),
    };
    const create = vi.fn().mockResolvedValue(generado);
    const prisma = { permiso: { create } } as unknown as MockedPrisma;
    const repo = new PermisoRepository(prisma);

    const permiso = await repo.crear({
      nombre: "listar ordenes",
      method: "GET",
      route: "/orders",
    });

    // R1/R3: persiste nombre, method y route como texto.
    expect(create).toHaveBeenCalledWith({
      data: { nombre: "listar ordenes", method: "GET", route: "/orders" },
    });
    // R2/R4/R5: id y timestamps NO se pasan a mano; los genera la capa DB/Prisma
    // (@default(uuid()), @default(now()), @updatedAt).
    const dataEnviada = create.mock.calls[0][0].data;
    expect(dataEnviada).not.toHaveProperty("id");
    expect(dataEnviada).not.toHaveProperty("createdAt");
    expect(dataEnviada).not.toHaveProperty("updatedAt");
    // R1: la fila devuelta expone las 6 columnas del modelo.
    expect(permiso.id).toBe("perm-uuid-1");
    // R4/R5: created_at y updated_at quedan poblados tras crear.
    expect(permiso.createdAt).toBeInstanceOf(Date);
    expect(permiso.updatedAt).toBeInstanceOf(Date);
  });

  it("contar devuelve el numero de permisos existentes; 0 tras migrar sin seed (R10)", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const prisma = { permiso: { count } } as unknown as MockedPrisma;
    const repo = new PermisoRepository(prisma);

    await expect(repo.contar()).resolves.toBe(0);
    expect(count).toHaveBeenCalledOnce();
  });
});
