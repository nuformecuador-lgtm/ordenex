import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { UserRepository } from "@/lib/repositories/UserRepository";

type MockedUserPrisma = Pick<PrismaClient, "usuario" | "tipoIdentificacion" | "rol">;

function buildMockPrisma(findManyImpl?: ReturnType<typeof vi.fn>): MockedUserPrisma {
  return {
    usuario: {
      findMany: findManyImpl ?? vi.fn().mockResolvedValue([]),
    },
    tipoIdentificacion: { findUnique: vi.fn() },
    rol: { findUnique: vi.fn() },
  } as unknown as MockedUserPrisma;
}

describe("UserRepository.listMensajeros (R1, R2, R3)", () => {
  it("filtra rol.value=mensajero y estado=activo, proyecta solo id/nombre, ordena por nombre", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "msg-1", nombre: "Ana" },
      { id: "msg-2", nombre: "Beto" },
    ]);
    const prisma = buildMockPrisma(findMany);
    const repo = new UserRepository(prisma);

    const mensajeros = await repo.listMensajeros();

    expect(mensajeros).toEqual([
      { id: "msg-1", nombre: "Ana" },
      { id: "msg-2", nombre: "Beto" },
    ]);

    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      rol: { value: "mensajero" },
      estado: "activo",
    });
    expect(arg.select).toEqual({ id: true, nombre: true });
    expect(arg.orderBy).toEqual({ nombre: "asc" });
  });

  it("nunca proyecta email/telefono/cedula/passwordHash (R1)", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "msg-1", nombre: "Ana" }]);
    const prisma = buildMockPrisma(findMany);
    const repo = new UserRepository(prisma);

    await repo.listMensajeros();

    const arg = findMany.mock.calls[0][0];
    expect(arg.select).not.toHaveProperty("email");
    expect(arg.select).not.toHaveProperty("telefono");
    expect(arg.select).not.toHaveProperty("cedula");
    expect(arg.select).not.toHaveProperty("passwordHash");
  });

  it("consulta con where.estado=activo, excluyendo pendiente/inactivo/bloqueado por construccion de la query (R3)", async () => {
    // El mock simula que Postgres ya aplico el filtro where.estado=activo:
    // un mensajero inactivo no aparece en la respuesta simulada.
    const findMany = vi.fn().mockResolvedValue([{ id: "msg-1", nombre: "Ana" }]);
    const prisma = buildMockPrisma(findMany);
    const repo = new UserRepository(prisma);

    const mensajeros = await repo.listMensajeros();

    expect(mensajeros).not.toContainEqual({ id: "msg-inactivo", nombre: "Carlos" });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.estado).toBe("activo");
  });
});
