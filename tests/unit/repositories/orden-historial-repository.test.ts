import { describe, it, expect, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";

// Feature 49 — tests unit del OrdenHistorialRepository (mockea Prisma, sin DB real, patron
// wallet-movimiento-repository.test.ts). Cubre R6 (choke point centralizado), R7 (escribe
// en el `tx` recibido), R24 (conteo por destino con el indice del destino), R27
// (existeActuacionDe filtra por actor), y el mapeo a DTO legible (R26).

function buildPrisma() {
  return {
    ordenHistorialEstado: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("registrarCambioEstado (R6/R7)", () => {
  it("R7: hace createMany en el `tx` recibido (no en el prisma del constructor)", async () => {
    const prisma = buildPrisma(); // cliente de lectura del constructor
    const tx = buildPrisma(); // transaccion en curso
    tx.ordenHistorialEstado.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.registrarCambioEstado(tx as never, [
      {
        ordenId: "o1",
        estatusOrigenId: "s-origen",
        estatusDestinoId: "s-destino",
        actorUsuarioId: "u1",
        origenTipo: "gestion",
        motivo: "cliente ausente",
        gestionOrdenId: "g1",
      },
    ]);

    // El append va al `tx`, nunca al prisma del constructor (atomicidad R7).
    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("creacion (origen null) y sistema (actor null) se persisten como null; motivo/tipo/gestion correctos", async () => {
    const tx = buildPrisma();
    tx.ordenHistorialEstado.createMany.mockResolvedValue({ count: 2 });
    const repo = new OrdenHistorialRepository(buildPrisma() as unknown as PrismaClient);

    const entradas: CambioEstadoEntrada[] = [
      {
        ordenId: "o1",
        estatusOrigenId: null, // R1/R20: creacion
        estatusDestinoId: "s-inicial",
        actorUsuarioId: "u-tienda",
        origenTipo: "carga_masiva",
        // sin motivo ni gestionOrdenId
      },
      {
        ordenId: "o2",
        estatusOrigenId: "s-reprogramada",
        estatusDestinoId: "s-bodega",
        actorUsuarioId: null, // R21: sistema/cron
        origenTipo: "liberacion_reprogramada",
      },
    ];
    await repo.registrarCambioEstado(tx as never, entradas);

    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data[0]).toEqual({
      ordenId: "o1",
      estatusOrigenId: null,
      estatusDestinoId: "s-inicial",
      actorUsuarioId: "u-tienda",
      origenTipo: "carga_masiva",
      motivo: null, // defaulteado a null cuando no viene
      gestionOrdenId: null,
    });
    expect(arg.data[1]).toEqual({
      ordenId: "o2",
      estatusOrigenId: "s-reprogramada",
      estatusDestinoId: "s-bodega",
      actorUsuarioId: null,
      origenTipo: "liberacion_reprogramada",
      motivo: null,
      gestionOrdenId: null,
    });
  });

  it("lista vacia -> no llama createMany (no-op)", async () => {
    const tx = buildPrisma();
    const repo = new OrdenHistorialRepository(buildPrisma() as unknown as PrismaClient);
    await repo.registrarCambioEstado(tx as never, []);
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("findHistorialByOrden (R26/R5)", () => {
  it("ordena cronologicamente (created_at asc), incluye value/nombre y mapea a DTO legible", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findMany.mockResolvedValue([
      {
        id: "h1",
        ordenId: "o1",
        estatusOrigenId: null,
        estatusDestinoId: "s-inicial",
        actorUsuarioId: "u-tienda",
        origenTipo: "carga_masiva",
        motivo: null,
        gestionOrdenId: null,
        createdAt: new Date("2026-07-13T10:00:00.000Z"),
        estatusOrigen: null, // creacion
        estatusDestino: { value: "en_preparacion" },
        actor: { nombre: "Tienda X" },
      },
      {
        id: "h2",
        ordenId: "o1",
        estatusOrigenId: "s-reparto",
        estatusDestinoId: "s-devuelta",
        actorUsuarioId: null, // sistema
        origenTipo: "gestion",
        motivo: "cliente ausente",
        gestionOrdenId: "g1",
        createdAt: new Date("2026-07-13T12:00:00.000Z"),
        estatusOrigen: { value: "en_reparto" },
        estatusDestino: { value: "devuelta" },
        actor: null,
      },
    ]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const r = await repo.findHistorialByOrden("o1");

    const arg = prisma.ordenHistorialEstado.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ ordenId: "o1" });
    expect(arg.orderBy).toEqual({ createdAt: "asc" }); // R26 cronologico
    expect(arg.include).toEqual({
      estatusOrigen: { select: { value: true } },
      estatusDestino: { select: { value: true } },
      actor: { select: { nombre: true } },
    });

    expect(r).toEqual([
      {
        estatusOrigenValue: null, // creacion (R1/R20)
        estatusDestinoValue: "en_preparacion",
        origenTipo: "carga_masiva",
        actorNombre: "Tienda X",
        motivo: null,
        createdAt: new Date("2026-07-13T10:00:00.000Z"),
      },
      {
        estatusOrigenValue: "en_reparto",
        estatusDestinoValue: "devuelta",
        origenTipo: "gestion",
        actorNombre: null, // sistema (R21)
        motivo: "cliente ausente",
        createdAt: new Date("2026-07-13T12:00:00.000Z"),
      },
    ]);
  });
});

describe("contarPorDestino (R24)", () => {
  it("cuenta filtrando por ordenId + estatusDestinoId", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(3);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const n = await repo.contarPorDestino("o1", "s-devuelta");

    expect(n).toBe(3);
    expect(prisma.ordenHistorialEstado.count).toHaveBeenCalledWith({
      where: { ordenId: "o1", estatusDestinoId: "s-devuelta" },
    });
  });
});

describe("existeActuacionDe (R27)", () => {
  it("true si hay una transicion actuada por el usuario", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findFirst.mockResolvedValue({ id: "h1" });
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const r = await repo.existeActuacionDe("o1", "m1");

    expect(r).toBe(true);
    expect(prisma.ordenHistorialEstado.findFirst).toHaveBeenCalledWith({
      where: { ordenId: "o1", actorUsuarioId: "m1" },
      select: { id: true },
    });
  });

  it("false si el usuario nunca actuo la orden", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findFirst.mockResolvedValue(null);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
    expect(await repo.existeActuacionDe("o1", "m2")).toBe(false);
  });
});
