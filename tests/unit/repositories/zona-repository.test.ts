import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";

// tx mock que reciben las operaciones dentro de $transaction.
function buildTx() {
  return {
    zona: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    zonaDistrito: { createMany: vi.fn(), deleteMany: vi.fn() },
    tarifaZonaMensajero: { createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  };
}

function buildPrisma(tx: ReturnType<typeof buildTx>, overrides: Record<string, unknown> = {}) {
  return {
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    zona: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    tarifaZonaMensajero: { findMany: vi.fn() },
    distrito: { count: vi.fn() },
    vehiculo: { count: vi.fn() },
    ...overrides,
  };
}

function repoOf(prisma: unknown) {
  return new ZonaRepository(prisma as unknown as PrismaClient);
}

describe("ZonaRepository.create", () => {
  it("crea zona + N:M + tarifas en transaccion y devuelve el DTO", async () => {
    const tx = buildTx();
    tx.zona.create.mockResolvedValue({ id: "z1", nombre: "GAM", cobroVehiculo: false, esCentral: false });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    const dto = await repoOf(prisma).create({
      nombre: "GAM",
      cobroVehiculo: false,
      esCentral: false,
      distritoIds: ["d1", "d2"],
      tarifas: [],
    });

    expect(tx.zona.create).toHaveBeenCalledWith({
      data: { nombre: "GAM", cobroVehiculo: false, esCentral: false },
    });
    expect(tx.zonaDistrito.createMany).toHaveBeenCalledWith({
      data: [
        { zonaId: "z1", distritoId: "d1" },
        { zonaId: "z1", distritoId: "d2" },
      ],
    });
    expect(dto.distritosCount).toBe(2);
    expect(dto.tarifas).toEqual([]);
  });

  it("persiste tarifas con Decimal y vehiculoId", async () => {
    const tx = buildTx();
    tx.zona.create.mockResolvedValue({ id: "z1", nombre: "GAM", cobroVehiculo: true, esCentral: false });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([
      {
        id: "t1",
        cobroEntregado: new Prisma.Decimal("10.00"),
        cobroRechazado: new Prisma.Decimal("5.00"),
        vehiculoId: "v1",
      },
    ]);
    const prisma = buildPrisma(tx);

    const dto = await repoOf(prisma).create({
      nombre: "GAM",
      cobroVehiculo: true,
      esCentral: false,
      distritoIds: ["d1"],
      tarifas: [{ cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" }],
    });

    const arg = tx.tarifaZonaMensajero.createMany.mock.calls[0][0];
    expect(arg.data[0].cobroEntregado).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data[0].vehiculoId).toBe("v1");
    expect(dto.tarifas).toEqual([
      { id: "t1", cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" },
    ]);
  });
});

describe("ZonaRepository.hardDelete", () => {
  it("borra tarifas + N:M + zona y devuelve ok", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
    const prisma = buildPrisma(tx);
    const res = await repoOf(prisma).hardDelete("z1");
    expect(res).toBe("ok");
    expect(tx.tarifaZonaMensajero.deleteMany).toHaveBeenCalledWith({ where: { zonaId: "z1" } });
    expect(tx.zona.delete).toHaveBeenCalledWith({ where: { id: "z1" } });
  });

  it("zona inexistente -> not_found", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue(null);
    const prisma = buildPrisma(tx);
    expect(await repoOf(prisma).hardDelete("zX")).toBe("not_found");
    expect(tx.zona.delete).not.toHaveBeenCalled();
  });

  it("FK RESTRICT (P2003) -> referenced", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
    tx.zona.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "x" }),
    );
    const prisma = buildPrisma(tx);
    expect(await repoOf(prisma).hardDelete("z1")).toBe("referenced");
  });
});

describe("ZonaRepository.arbol", () => {
  it("indexa por nombre normalizado con id + value", async () => {
    const tx = buildTx();
    const prisma = buildPrisma(tx, {
      zona: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "z1",
            nombre: "GUANACASTE",
            distritos: [
              {
                distrito: {
                  id: "d1",
                  nombre: "Liberia",
                  canton: { id: "c1", nombre: "Liberia" },
                },
              },
              {
                distrito: {
                  id: "d2",
                  nombre: "Cañas Dulces",
                  canton: { id: "c1", nombre: "Liberia" },
                },
              },
            ],
          },
        ]),
      },
    });

    const arbol = await repoOf(prisma).arbol();
    expect(Object.keys(arbol)).toEqual(["guanacaste"]);
    expect(arbol["guanacaste"].value).toBe("GUANACASTE");
    const liberia = arbol["guanacaste"].cantones["liberia"];
    expect(liberia.id).toBe("c1");
    expect(Object.keys(liberia.distritos).sort()).toEqual(["canas dulces", "liberia"]);
    expect(liberia.distritos["liberia"]).toEqual({ id: "d1", value: "Liberia" });
  });
});

describe("ZonaRepository.list", () => {
  it("mapea distritosCount y NO incluye tarifas sin include", async () => {
    const tx = buildTx();
    const prisma = buildPrisma(tx, {
      zona: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "z1", nombre: "GAM", cobroVehiculo: false, esCentral: true, _count: { distritos: 3 } },
          ]),
        count: vi.fn().mockResolvedValue(1),
      },
    });
    const { items, total } = await repoOf(prisma).list({ skip: 0, take: 25, includeTarifas: false });
    expect(total).toBe(1);
    expect(items[0].distritosCount).toBe(3);
    expect(items[0].esCentral).toBe(true);
    expect(items[0].tarifas).toBeUndefined();
  });

  it("con includeTarifas agrupa tarifas por zona", async () => {
    const tx = buildTx();
    const prisma = buildPrisma(tx, {
      zona: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "z1", nombre: "GAM", cobroVehiculo: true, esCentral: false, _count: { distritos: 1 } },
          ]),
        count: vi.fn().mockResolvedValue(1),
      },
      tarifaZonaMensajero: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "t1",
            zonaId: "z1",
            cobroEntregado: new Prisma.Decimal("10"),
            cobroRechazado: new Prisma.Decimal("5"),
            vehiculoId: "v1",
          },
        ]),
      },
    });
    const { items } = await repoOf(prisma).list({ skip: 0, take: 25, includeTarifas: true });
    expect(items[0].tarifas).toEqual([
      { id: "t1", cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" },
    ]);
  });
});

describe("ZonaRepository.findCentralZonaId (feature 54)", () => {
  it("devuelve el id de la zona con esCentral=true", async () => {
    const tx = buildTx();
    const findFirst = vi.fn().mockResolvedValue({ id: "z-central" });
    const prisma = buildPrisma(tx, {
      zona: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), findFirst },
    });
    const res = await repoOf(prisma).findCentralZonaId();
    expect(res).toBe("z-central");
    expect(findFirst).toHaveBeenCalledWith({ where: { esCentral: true }, select: { id: true } });
  });

  it("devuelve null cuando ninguna zona es central", async () => {
    const tx = buildTx();
    const prisma = buildPrisma(tx, {
      zona: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    });
    expect(await repoOf(prisma).findCentralZonaId()).toBeNull();
  });
});
