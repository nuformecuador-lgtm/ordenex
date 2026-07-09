import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { UserRepository } from "@/lib/repositories/UserRepository";
import {
  CatalogoInvalidoError,
  UsuarioDuplicadoError,
} from "@/lib/interfaces/repositories/IUserRepository";

type MockedUserPrisma = Pick<PrismaClient, "usuario" | "tipoIdentificacion" | "rol">;

function buildMockPrisma(overrides: Partial<{
  usuarioFindUnique: ReturnType<typeof vi.fn>;
  usuarioCreate: ReturnType<typeof vi.fn>;
  tipoIdentificacionFindUnique: ReturnType<typeof vi.fn>;
  rolFindUnique: ReturnType<typeof vi.fn>;
}> = {}): MockedUserPrisma {
  return {
    usuario: {
      findUnique: overrides.usuarioFindUnique ?? vi.fn(),
      create: overrides.usuarioCreate ?? vi.fn(),
    },
    tipoIdentificacion: {
      findUnique: overrides.tipoIdentificacionFindUnique ?? vi.fn().mockResolvedValue({ id: "tipo-1", value: "cedula" }),
    },
    rol: {
      findUnique: overrides.rolFindUnique ?? vi.fn().mockResolvedValue({ id: "rol-1", value: "usuario" }),
    },
  } as unknown as MockedUserPrisma;
}

const CREATE_INPUT = {
  nombre: "Ana Torres",
  email: "ana@example.com",
  telefono: "0991234567",
  passwordHash: "hash-simulado",
  cedula: "1710034065",
  tipoIdentificacionId: "tipo-1",
  rolId: "rol-1",
};

describe("UserRepository", () => {
  it("crea un usuario cuando los catalogos existen", async () => {
    const usuarioCreate = vi.fn().mockResolvedValue({
      id: "usr-1",
      nombre: CREATE_INPUT.nombre,
      email: CREATE_INPUT.email,
      telefono: CREATE_INPUT.telefono,
      estado: "pendiente",
      cedula: CREATE_INPUT.cedula,
      tipoIdentificacionId: CREATE_INPUT.tipoIdentificacionId,
      rolId: CREATE_INPUT.rolId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const prisma = buildMockPrisma({ usuarioCreate });
    const repo = new UserRepository(prisma);

    const usuario = await repo.create(CREATE_INPUT);

    expect(usuario.id).toBe("usr-1");
    expect(usuarioCreate).toHaveBeenCalledTimes(1);
    expect(usuario).not.toHaveProperty("passwordHash"); // R7
  });

  it("rechaza la creacion si tipo_identificacion_id no existe (R10)", async () => {
    const prisma = buildMockPrisma({
      tipoIdentificacionFindUnique: vi.fn().mockResolvedValue(null),
    });
    const repo = new UserRepository(prisma);

    await expect(repo.create(CREATE_INPUT)).rejects.toBeInstanceOf(CatalogoInvalidoError);
  });

  it("rechaza la creacion si rol_id no existe (R10)", async () => {
    const prisma = buildMockPrisma({
      rolFindUnique: vi.fn().mockResolvedValue(null),
    });
    const repo = new UserRepository(prisma);

    await expect(repo.create(CREATE_INPUT)).rejects.toBeInstanceOf(CatalogoInvalidoError);
  });

  it("traduce violacion de unicidad de email a UsuarioDuplicadoError (R4)", async () => {
    const usuarioCreate = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.8.0",
        meta: { target: ["email"] },
      }),
    );
    const prisma = buildMockPrisma({ usuarioCreate });
    const repo = new UserRepository(prisma);

    const error = await repo.create(CREATE_INPUT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsuarioDuplicadoError);
    expect((error as UsuarioDuplicadoError).campo).toBe("email");
  });

  it("traduce violacion de unicidad de cedula a UsuarioDuplicadoError (R5)", async () => {
    const usuarioCreate = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.8.0",
        meta: { target: ["cedula"] },
      }),
    );
    const prisma = buildMockPrisma({ usuarioCreate });
    const repo = new UserRepository(prisma);

    const error = await repo.create(CREATE_INPUT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsuarioDuplicadoError);
    expect((error as UsuarioDuplicadoError).campo).toBe("cedula");
  });

  it("findByEmailWithHash expone passwordHash (unico metodo autorizado)", async () => {
    const usuarioFindUnique = vi.fn().mockResolvedValue({
      id: "usr-1",
      nombre: "Ana",
      email: "ana@example.com",
      telefono: "099",
      passwordHash: "hash-secreto",
      estado: "activo",
      cedula: "123",
      tipoIdentificacionId: "tipo-1",
      rolId: "rol-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const prisma = buildMockPrisma({ usuarioFindUnique });
    const repo = new UserRepository(prisma);

    const usuario = await repo.findByEmailWithHash("ana@example.com");
    expect(usuario?.passwordHash).toBe("hash-secreto");
  });

  it("findByEmail no selecciona passwordHash (R7)", async () => {
    const usuarioFindUnique = vi.fn().mockResolvedValue({
      id: "usr-1",
      nombre: "Ana",
      email: "ana@example.com",
      telefono: "099",
      estado: "activo",
      cedula: "123",
      tipoIdentificacionId: "tipo-1",
      rolId: "rol-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const prisma = buildMockPrisma({ usuarioFindUnique });
    const repo = new UserRepository(prisma);

    await repo.findByEmail("ana@example.com");
    const selectArg = usuarioFindUnique.mock.calls[0][0];
    expect(selectArg.select).not.toHaveProperty("passwordHash");
  });
});
