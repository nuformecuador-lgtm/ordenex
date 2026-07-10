import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { AprobacionPostulacionRepository } from "@/lib/repositories/AprobacionPostulacionRepository";

// Feature 22 — solo Prisma. Cubre R6, R7, R8, R11, R12, R14/R18 (count).

type MockedPrisma = Pick<PrismaClient, "usuario">;

const usuarioRow = {
  id: "usr-1",
  nombre: "Ana",
  primerApellido: "Perez",
  segundoApellido: null,
  email: "ana@example.com",
  telefono: "0991234567",
  cedula: "1710034065",
  placa: "ABC123",
  tipoIdentificacion: { value: "cedula" },
  vehiculo: { name: "moto" },
  documentos: [
    { id: "d1", usuarioId: "usr-1", tipo: "foto_rostro", storagePath: "usr-1/foto_rostro.jpg", contentType: "image/jpeg" },
  ],
};

function buildPrisma(over: Partial<Record<"findMany" | "count" | "findFirst" | "updateMany", ReturnType<typeof vi.fn>>> = {}) {
  const findMany = over.findMany ?? vi.fn().mockResolvedValue([usuarioRow]);
  const count = over.count ?? vi.fn().mockResolvedValue(1);
  const findFirst = over.findFirst ?? vi.fn().mockResolvedValue({ id: "usr-1", estado: "pendiente" });
  const updateMany = over.updateMany ?? vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { usuario: { findMany, count, findFirst, updateMany } } as unknown as MockedPrisma;
  return { prisma, findMany, count, findFirst, updateMany };
}

describe("AprobacionPostulacionRepository", () => {
  it("R6/R7/R8: listPendientes filtra rol mensajero + estado pendiente e incluye catalogos/documentos", async () => {
    const { prisma, findMany, count } = buildPrisma();
    const repo = new AprobacionPostulacionRepository(prisma);

    const r = await repo.listPendientes({ skip: 0, take: 20 });

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ estado: "pendiente", rol: { value: "mensajero" } });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(args.select.tipoIdentificacion).toBeDefined();
    expect(args.select.vehiculo).toBeDefined();
    expect(args.select.documentos).toBeDefined();
    expect(count).toHaveBeenCalledWith({ where: { estado: "pendiente", rol: { value: "mensajero" } } });

    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({
      usuarioId: "usr-1",
      tipoIdentificacion: "cedula",
      vehiculo: "moto",
    });
    expect(r.items[0]!.documentos).toHaveLength(1);
  });

  it("R7: mapea vehiculo null cuando el usuario no tiene vehiculo", async () => {
    const { prisma } = buildPrisma({
      findMany: vi.fn().mockResolvedValue([{ ...usuarioRow, vehiculo: null }]),
    });
    const repo = new AprobacionPostulacionRepository(prisma);
    const r = await repo.listPendientes({ skip: 0, take: 20 });
    expect(r.items[0]!.vehiculo).toBeNull();
  });

  it("R11: sin pendientes devuelve items vacios y total 0", async () => {
    const { prisma } = buildPrisma({
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    });
    const repo = new AprobacionPostulacionRepository(prisma);
    const r = await repo.listPendientes({ skip: 0, take: 20 });
    expect(r).toEqual({ items: [], total: 0 });
  });

  it("R12/R14/R18: actualizarEstadoSiPendiente usa updateMany condicional y devuelve count", async () => {
    const { prisma, updateMany } = buildPrisma();
    const repo = new AprobacionPostulacionRepository(prisma);

    const count = await repo.actualizarEstadoSiPendiente("usr-1", "activo");

    expect(count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "usr-1", estado: "pendiente", rol: { value: "mensajero" } },
      data: { estado: "activo" },
    });
  });

  it("R14/R18: count 0 cuando el update condicional no afecta filas", async () => {
    const { prisma } = buildPrisma({ updateMany: vi.fn().mockResolvedValue({ count: 0 }) });
    const repo = new AprobacionPostulacionRepository(prisma);
    expect(await repo.actualizarEstadoSiPendiente("usr-1", "inactivo")).toBe(0);
  });

  it("R13/R17: findMensajeroById filtra por rol mensajero y devuelve estado o null", async () => {
    const { prisma, findFirst } = buildPrisma();
    const repo = new AprobacionPostulacionRepository(prisma);

    const found = await repo.findMensajeroById("usr-1");
    expect(found).toEqual({ id: "usr-1", estado: "pendiente" });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: "usr-1", rol: { value: "mensajero" } });

    const { prisma: prisma2 } = buildPrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const repo2 = new AprobacionPostulacionRepository(prisma2);
    expect(await repo2.findMensajeroById("nope")).toBeNull();
  });
});
