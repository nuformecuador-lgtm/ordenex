import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { CatalogoInvalidoError } from "@/lib/interfaces/repositories/IUserRepository";

function usuarioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "usr-1",
    nombre: "Ana Torres",
    email: "ana@example.com",
    telefono: "099",
    estado: "activo",
    cedula: "1710034065",
    tipoIdentificacionId: "tipo-1",
    rolId: "rol-1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "usr-1",
    nombre: "Ana Torres",
    email: "ana@example.com",
    estado: "activo",
    createdAt: new Date("2026-01-01"),
    rol: { value: "mensajero" },
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    usuario: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    tipoIdentificacion: {
      findUnique: vi.fn().mockResolvedValue({ id: "tipo-1", value: "cedula" }),
      findMany: vi.fn(),
    },
    rol: {
      findUnique: vi.fn().mockResolvedValue({ id: "rol-1", value: "mensajero" }),
      findMany: vi.fn(),
    },
    ...overrides,
  };
}

describe("UserRepository.list (R13/R14/R15/R24)", () => {
  it("list devuelve items paginados con rolValue y total, sin passwordHash (R13/R14/R24)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([listRow(), listRow({ id: "usr-2" })]);
    prisma.usuario.count.mockResolvedValue(2);
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({ skip: 0, take: 20 });

    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);
    expect(res.items[0].rolValue).toBe("mensajero");
    expect(res.items[0]).not.toHaveProperty("passwordHash");
    expect(res.items[0]).not.toHaveProperty("rol");

    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.select).not.toHaveProperty("passwordHash");
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(20);
  });

  it("list ordena por columna de lista blanca (R15)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([listRow()]);
    prisma.usuario.count.mockResolvedValue(1);
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    await repo.list({ skip: 0, take: 20, sortBy: "nombre", sortDir: "asc" });
    expect(prisma.usuario.findMany.mock.calls[0][0].orderBy).toEqual({ nombre: "asc" });
  });

  it("list ignora sortBy fuera de la lista blanca y cae a createdAt (R15)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([listRow()]);
    prisma.usuario.count.mockResolvedValue(1);
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    await repo.list({ skip: 0, take: 20, sortBy: "passwordHash", sortDir: "asc" });
    expect(prisma.usuario.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "asc" });
  });
});

describe("UserRepository.update (R16/R17/R18/R19)", () => {
  it("update aplica solo campos editables y retorna publico (R16/R19)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.updateMany.mockResolvedValue({ count: 1 });
    prisma.usuario.findUnique.mockResolvedValue(usuarioRow({ nombre: "Nuevo" }));
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    const dto = await repo.update("usr-1", { nombre: "Nuevo", telefono: "088" });

    const arg = prisma.usuario.updateMany.mock.calls[0][0];
    expect(arg.data).toEqual({ nombre: "Nuevo", telefono: "088" });
    expect(arg.data).not.toHaveProperty("email");
    expect(arg.data).not.toHaveProperty("cedula");
    expect(dto?.nombre).toBe("Nuevo");
    expect(dto).not.toHaveProperty("passwordHash");
  });

  it("update valida FK de catalogo (rolId) reusando el patron de create (R18)", async () => {
    const prisma = buildPrisma({
      usuario: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
      },
      rol: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    await expect(repo.update("usr-1", { rolId: "no-existe" })).rejects.toBeInstanceOf(
      CatalogoInvalidoError,
    );
    expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
  });

  it("update retorna null si el usuario no existe (R17)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.updateMany.mockResolvedValue({ count: 0 });
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    expect(await repo.update("x", { nombre: "Otro" })).toBeNull();
  });
});

describe("UserRepository.setEstado (R20/R21/R22)", () => {
  it("setEstado cambia a inactivo/activo y null si no existe (R20/R21/R22)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.updateMany.mockResolvedValue({ count: 1 });
    prisma.usuario.findUnique.mockResolvedValue(usuarioRow({ estado: "inactivo" }));
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    const dto = await repo.setEstado("usr-1", "inactivo");
    const arg = prisma.usuario.updateMany.mock.calls[0][0];
    expect(arg.data).toEqual({ estado: "inactivo" });
    expect(dto?.estado).toBe("inactivo");

    prisma.usuario.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.setEstado("x", "activo")).toBeNull();
  });
});

describe("UserRepository.listTiposIdentificacion (R29)", () => {
  it("listTiposIdentificacion devuelve id/value del catalogo (R29)", async () => {
    const prisma = buildPrisma();
    prisma.tipoIdentificacion.findMany.mockResolvedValue([
      { id: "tipo-1", value: "cedula" },
      { id: "tipo-2", value: "ruc" },
    ]);
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    const tipos = await repo.listTiposIdentificacion();
    expect(tipos).toEqual([
      { id: "tipo-1", value: "cedula" },
      { id: "tipo-2", value: "ruc" },
    ]);
    expect(prisma.tipoIdentificacion.findMany.mock.calls[0][0].select).toEqual({
      id: true,
      value: true,
    });
  });
});

describe("UserRepository.listRoles", () => {
  it("listRoles devuelve id/value del catalogo rol ordenado por value", async () => {
    const prisma = buildPrisma();
    prisma.rol.findMany.mockResolvedValue([
      { id: "rol-1", value: "admin" },
      { id: "rol-2", value: "maestro" },
    ]);
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    const roles = await repo.listRoles();
    expect(roles).toEqual([
      { id: "rol-1", value: "admin" },
      { id: "rol-2", value: "maestro" },
    ]);
    const arg = prisma.rol.findMany.mock.calls[0][0];
    expect(arg.select).toEqual({ id: true, value: true });
    expect(arg.orderBy).toEqual({ value: "asc" });
  });
});
