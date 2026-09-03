import { conRegistroDeAcciones } from "../../fixtures/registro-de-acciones";
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
  // FICHA 362: las escrituras de esta clase corren en `$transaction` y registran su accion.
  return conRegistroDeAcciones({
    usuario: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
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
  });
}

describe("UserRepository.create — fulfillment (feature 27/R3/R8/R9/R14)", () => {
  it("create sin fulfillment persiste false (R3)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.create = vi.fn().mockResolvedValue(usuarioRow({ fulfillment: false }));
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create({
      nombre: "Ana",
      email: "ana@example.com",
      telefono: "099",
      passwordHash: "h",
      cedula: "1710034065",
      tipoIdentificacionId: "tipo-1",
      rolId: "rol-1",
    }, "actor-1");

    const arg = prisma.usuario.create.mock.calls[0][0];
    expect(arg.data.fulfillment).toBe(false); // R3: ausente -> false, no null
    expect(dto.fulfillment).toBe(false); // R14: expuesto en la forma publica
    expect(dto).not.toHaveProperty("passwordHash"); // R14
  });

  it("create con fulfillment true lo persiste (R8)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.create = vi.fn().mockResolvedValue(usuarioRow({ fulfillment: true }));
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create({
      nombre: "Tienda",
      email: "t@example.com",
      telefono: "099",
      passwordHash: "h",
      cedula: "1710034065",
      tipoIdentificacionId: "tipo-1",
      rolId: "rol-1",
      fulfillment: true,
    }, "actor-1");

    expect(prisma.usuario.create.mock.calls[0][0].data.fulfillment).toBe(true);
    expect(dto.fulfillment).toBe(true);
  });

  it("PUBLIC_SELECT incluye fulfillment y nunca passwordHash (R14)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.create = vi.fn().mockResolvedValue(usuarioRow({ fulfillment: false }));
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    await repo.create({
      nombre: "Ana",
      email: "ana@example.com",
      telefono: "099",
      passwordHash: "h",
      cedula: "1710034065",
      tipoIdentificacionId: "tipo-1",
      rolId: "rol-1",
    }, "actor-1");

    const select = prisma.usuario.create.mock.calls[0][0].select;
    expect(select.fulfillment).toBe(true);
    expect(select).not.toHaveProperty("passwordHash");
  });

  it("update aplica fulfillment como campo editable (R12)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.updateMany.mockResolvedValue({ count: 1 });
    prisma.usuario.findUnique.mockResolvedValue(usuarioRow({ fulfillment: true }));
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    const dto = await repo.update("usr-1", { fulfillment: true }, "actor-1");

    expect(prisma.usuario.updateMany.mock.calls[0][0].data).toEqual({ fulfillment: true });
    expect(dto?.fulfillment).toBe(true);
  });
});

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

    const dto = await repo.update("usr-1", { nombre: "Nuevo", telefono: "088" }, "actor-1");

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

    await expect(repo.update("usr-1", { rolId: "no-existe" }, "actor-1")).rejects.toBeInstanceOf(
      CatalogoInvalidoError,
    );
    expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
  });

  it("update retorna null si el usuario no existe (R17)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.updateMany.mockResolvedValue({ count: 0 });
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    expect(await repo.update("x", { nombre: "Otro" }, "actor-1")).toBeNull();
  });
});

describe("UserRepository.setEstado (R20/R21/R22)", () => {
  it("setEstado cambia a inactivo/activo y null si no existe (R20/R21/R22)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.updateMany.mockResolvedValue({ count: 1 });
    prisma.usuario.findUnique.mockResolvedValue(usuarioRow({ estado: "inactivo" }));
    const repo = new UserRepository(prisma as unknown as PrismaClient);

    const dto = await repo.setEstado("usr-1", "inactivo", "actor-1");
    const arg = prisma.usuario.updateMany.mock.calls[0][0];
    expect(arg.data).toEqual({ estado: "inactivo" });
    expect(dto?.estado).toBe("inactivo");

    prisma.usuario.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.setEstado("x", "activo", "actor-1")).toBeNull();
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
