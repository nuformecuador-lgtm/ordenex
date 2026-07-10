import { describe, it, expect, vi } from "vitest";
import type { PrismaClient, VehiculoValue } from "@prisma/client";
import { seedVehiculos } from "@/scripts/seed-catalogos";
import { VEHICULOS_SEED } from "@/lib/types/vehiculos";

// Fake in-memory del cliente Prisma que replica la semantica del upsert por
// `name` (indice unico vehiculos_name_key), como el fake de seedOrderStatus. La
// verificacion contra Postgres real queda DIFERIDA (sin DB), deuda de despliegue.
// OJO: la clave es `name`, NO `value`.
interface VehiculoRow {
  id: string;
  name: VehiculoValue;
}

function createFakeVehiculo() {
  const rows = new Map<string, VehiculoRow>();
  let idSeq = 0;
  const upsert = vi.fn(
    async (args: {
      where: { name: VehiculoValue };
      update: Record<string, unknown>;
      create: { name: VehiculoValue };
    }): Promise<VehiculoRow> => {
      const existing = rows.get(args.where.name);
      if (existing) return existing; // update no-op: conserva id (R8)
      const row: VehiculoRow = { id: `veh-${++idSeq}`, name: args.create.name };
      rows.set(args.where.name, row);
      return row;
    },
  );
  return { rows, upsert };
}

describe("seedVehiculos siembra los 3 tipos por name (R7)", () => {
  it("crea una fila por cada valor de VEHICULOS_SEED", async () => {
    const fake = createFakeVehiculo();
    await seedVehiculos({ vehiculo: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "vehiculo"
    >);

    expect(fake.upsert).toHaveBeenCalledTimes(3);
    const nombres = [...fake.rows.values()].map((r) => r.name).sort();
    expect(nombres).toEqual([...VEHICULOS_SEED].sort());
    expect(nombres).toEqual(["camion", "carro", "moto"]);
  });

  it("hace upsert por `name` (NO por `value`)", async () => {
    const fake = createFakeVehiculo();
    await seedVehiculos({ vehiculo: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "vehiculo"
    >);
    for (const call of fake.upsert.mock.calls) {
      expect(call[0].where).toHaveProperty("name");
      expect(call[0].where).not.toHaveProperty("value");
      expect(call[0].create).toHaveProperty("name");
    }
  });
});

describe("seedVehiculos es idempotente (R8)", () => {
  it("dos ejecuciones dejan 3 filas, sin duplicar y con id estable", async () => {
    const fake = createFakeVehiculo();
    const client = { vehiculo: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "vehiculo"
    >;

    await seedVehiculos(client);
    expect(fake.rows.size).toBe(3);
    const idsPrimera = new Map([...fake.rows.entries()].map(([k, v]) => [k, v.id]));

    await seedVehiculos(client);
    expect(fake.rows.size).toBe(3); // no crece

    for (const [k, v] of fake.rows.entries()) {
      expect(v.id).toBe(idsPrimera.get(k)); // id conservado (R8)
    }
  });
});

describe("seedVehiculos propaga el fallo del upsert", () => {
  it("si un upsert rechaza, seedVehiculos rechaza", async () => {
    const failing = {
      vehiculo: {
        upsert: vi.fn(async () => {
          throw new Error("conexion caida");
        }),
      },
    } as unknown as Pick<PrismaClient, "vehiculo">;

    await expect(seedVehiculos(failing)).rejects.toThrow("conexion caida");
  });
});
