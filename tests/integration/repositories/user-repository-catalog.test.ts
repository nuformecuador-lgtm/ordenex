import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { CatalogoInvalidoError } from "@/lib/interfaces/repositories/IUserRepository";

// T017: valida la FK de tipo_identificacion_id/rol_id en el flujo de creacion
// de usuario (R10), fuera del login en si pero requerido para la consistencia
// del modelo de datos.

type MockedPrisma = Pick<PrismaClient, "usuario" | "tipoIdentificacion" | "rol">;

const INPUT = {
  nombre: "Luis Perez",
  email: "luis@example.com",
  telefono: "0987654321",
  passwordHash: "hash-simulado",
  cedula: "0102030405",
  tipoIdentificacionId: "tipo-inexistente",
  rolId: "rol-inexistente",
};

describe("Creacion de usuario con catalogos inexistentes (T017, R10)", () => {
  it("rechaza la creacion cuando tipo_identificacion_id no existe en el catalogo", async () => {
    const prisma = {
      usuario: { create: vi.fn() },
      tipoIdentificacion: { findUnique: vi.fn().mockResolvedValue(null) },
      rol: { findUnique: vi.fn().mockResolvedValue({ id: "rol-1", value: "usuario" }) },
    } as unknown as MockedPrisma;
    const repo = new UserRepository(prisma);

    await expect(repo.create(INPUT)).rejects.toBeInstanceOf(CatalogoInvalidoError);
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });

  it("rechaza la creacion cuando rol_id no existe en el catalogo", async () => {
    const prisma = {
      usuario: { create: vi.fn() },
      tipoIdentificacion: { findUnique: vi.fn().mockResolvedValue({ id: "tipo-1", value: "cedula" }) },
      rol: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as MockedPrisma;
    const repo = new UserRepository(prisma);

    await expect(repo.create(INPUT)).rejects.toBeInstanceOf(CatalogoInvalidoError);
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });

  it("permite la creacion cuando ambos catalogos existen", async () => {
    const usuarioCreate = vi.fn().mockResolvedValue({
      id: "usr-1",
      ...INPUT,
      tipoIdentificacionId: "tipo-1",
      rolId: "rol-1",
      estado: "pendiente",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const prisma = {
      usuario: { create: usuarioCreate },
      tipoIdentificacion: { findUnique: vi.fn().mockResolvedValue({ id: "tipo-1", value: "cedula" }) },
      rol: { findUnique: vi.fn().mockResolvedValue({ id: "rol-1", value: "usuario" }) },
    } as unknown as MockedPrisma;
    const repo = new UserRepository(prisma);

    const usuario = await repo.create({ ...INPUT, tipoIdentificacionId: "tipo-1", rolId: "rol-1" });
    expect(usuario.id).toBe("usr-1");
  });
});
