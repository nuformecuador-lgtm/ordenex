import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { CreateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    orden: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    orderStatus: { findUnique: vi.fn() },
    zona: { findUnique: vi.fn() },
    provincia: { findUnique: vi.fn(), findMany: vi.fn() },
    canton: { findUnique: vi.fn(), findMany: vi.fn() },
    distrito: { findUnique: vi.fn(), findMany: vi.fn() },
    usuario: { findMany: vi.fn() },
    ...overrides,
  };
}

function baseCreateData(overrides: Partial<CreateOrdenData> = {}): CreateOrdenData {
  return {
    numRemision: "REM-1",
    estatusId: "os-preparacion",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    producto: "Caja",
    peso: null,
    ...overrides,
  };
}

describe("OrdenRepository.findExistingRemisiones (R25)", () => {
  it("mapea numRemision -> estatus.value y filtra deletedAt:null", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { numRemision: "REM-1", estatus: { value: "en_bodega" } },
      { numRemision: "REM-2", estatus: { value: "entregada" } },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findExistingRemisiones(["REM-1", "REM-2", "REM-3"]);

    expect(map.get("REM-1")).toBe("en_bodega");
    expect(map.get("REM-2")).toBe("entregada");
    expect(map.has("REM-3")).toBe(false);

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      numRemision: { in: ["REM-1", "REM-2", "REM-3"] },
      deletedAt: null,
    });
  });

  it("devuelve un Map vacio sin consultar cuando no hay remisiones", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findExistingRemisiones([]);

    expect(map.size).toBe(0);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.findMensajerosByIds (R22)", () => {
  it("devuelve solo los ids con rol mensajero", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([{ id: "msg-1" }, { id: "msg-2" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const set = await repo.findMensajerosByIds(["msg-1", "msg-2", "no-mensajero"]);

    expect(set.has("msg-1")).toBe(true);
    expect(set.has("msg-2")).toBe(true);
    expect(set.has("no-mensajero")).toBe(false);

    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      id: { in: ["msg-1", "msg-2", "no-mensajero"] },
      rol: { value: "mensajero" },
    });
  });
});

describe("OrdenRepository — resolucion geografica batch (R19)", () => {
  it("findProvinciasByNombres devuelve id/nombre", async () => {
    const prisma = buildPrisma();
    prisma.provincia.findMany.mockResolvedValue([{ id: "p1", nombre: "Pichincha" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findProvinciasByNombres(["Pichincha"]);

    expect(rows).toEqual([{ id: "p1", nombre: "Pichincha" }]);
    const arg = prisma.provincia.findMany.mock.calls[0][0];
    expect(arg.where.nombre).toMatchObject({ in: ["Pichincha"], mode: "insensitive" });
  });

  it("findCantonesByProvinciaIds filtra por provinciaId in", async () => {
    const prisma = buildPrisma();
    prisma.canton.findMany.mockResolvedValue([{ id: "c1", nombre: "Quito", provinciaId: "p1" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCantonesByProvinciaIds(["p1"]);

    expect(rows).toEqual([{ id: "c1", nombre: "Quito", provinciaId: "p1" }]);
    const arg = prisma.canton.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ provinciaId: { in: ["p1"] } });
  });

  it("findDistritosByCantonIds filtra por cantonId in", async () => {
    const prisma = buildPrisma();
    prisma.distrito.findMany.mockResolvedValue([
      { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1" },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDistritosByCantonIds(["c1"]);

    expect(rows).toEqual([{ id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1" }]);
    const arg = prisma.distrito.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ cantonId: { in: ["c1"] } });
  });
});

describe("OrdenRepository.createManyOrdenes (R27)", () => {
  it("trocea en lotes de batchSize y llama createMany con skipDuplicates:true", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const data = [
      baseCreateData({ numRemision: "REM-1" }),
      baseCreateData({ numRemision: "REM-2" }),
      baseCreateData({ numRemision: "REM-3" }),
    ];

    const total = await repo.createManyOrdenes(data, 2);

    expect(total).toBe(3);
    expect(prisma.orden.createMany).toHaveBeenCalledTimes(2);
    const firstCall = prisma.orden.createMany.mock.calls[0][0];
    expect(firstCall.skipDuplicates).toBe(true);
    expect(firstCall.data).toHaveLength(2);
    const secondCall = prisma.orden.createMany.mock.calls[1][0];
    expect(secondCall.data).toHaveLength(1);
  });

  it("mapea peso null a null y no revienta con montoCobrar/mensajeroSugeridoId ausentes", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenes([baseCreateData({ peso: null })], 500);

    const arg = prisma.orden.createMany.mock.calls[0][0];
    expect(arg.data[0].peso).toBeNull();
    expect(arg.data[0].montoCobrar).toBeNull();
    expect(arg.data[0].mensajeroSugeridoId).toBeNull();
  });

  // Feature 17/R2/R8: la carga masiva NUNCA fija num_guia (queda NULL, se asigna
  // en "Generar guia") ni mensajero_asignado_id (acto posterior del maestro).
  it("no envia num_guia ni mensajero_asignado_id (R2/R8)", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenes([baseCreateData()], 500);

    const arg = prisma.orden.createMany.mock.calls[0][0];
    expect(arg.data[0]).not.toHaveProperty("numGuia");
    expect(arg.data[0]).not.toHaveProperty("mensajeroAsignadoId");
  });
});
