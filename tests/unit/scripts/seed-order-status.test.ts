import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedOrderStatus } from "@/scripts/seed-catalogos";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Fake in-memory del cliente Prisma que replica la semantica del upsert por
// `value` (indice unico order_status_value_key), como el fake de seedRoles. La
// verificacion contra Postgres real queda DIFERIDA (sin DB), como login.
interface OrderStatusRow {
  id: string;
  value: string;
}

function createFakeOrderStatus() {
  const rows = new Map<string, OrderStatusRow>();
  let idSeq = 0;
  const upsert = vi.fn(
    async (args: {
      where: { value: string };
      update: Record<string, unknown>;
      create: { value: string };
    }): Promise<OrderStatusRow> => {
      const existing = rows.get(args.where.value);
      if (existing) return existing; // update no-op: conserva id (R3)
      const row: OrderStatusRow = { id: `os-${++idSeq}`, value: args.create.value };
      rows.set(args.where.value, row);
      return row;
    },
  );
  return { rows, upsert };
}

describe("seedOrderStatus siembra los 7 estatus por value (R2)", () => {
  it("crea una fila por cada valor de ORDER_STATUS_SEED", async () => {
    const fake = createFakeOrderStatus();
    await seedOrderStatus({ orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >);

    expect(fake.upsert).toHaveBeenCalledTimes(7);
    const valores = [...fake.rows.values()].map((r) => r.value).sort();
    expect(valores).toEqual([...ORDER_STATUS_SEED].sort());
  });
});

describe("seedOrderStatus es idempotente (R3)", () => {
  it("dos ejecuciones dejan 7 filas, sin duplicar y con id estable", async () => {
    const fake = createFakeOrderStatus();
    const client = { orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >;

    await seedOrderStatus(client);
    expect(fake.rows.size).toBe(7);
    const idsPrimera = new Map([...fake.rows.entries()].map(([k, v]) => [k, v.id]));

    await seedOrderStatus(client);
    expect(fake.rows.size).toBe(7); // no crece

    for (const [k, v] of fake.rows.entries()) {
      expect(v.id).toBe(idsPrimera.get(k)); // id conservado (R3)
    }
  });
});

describe("seedOrderStatus propaga el fallo del upsert", () => {
  it("si un upsert rechaza, seedOrderStatus rechaza", async () => {
    const failing = {
      orderStatus: {
        upsert: vi.fn(async () => {
          throw new Error("conexion caida");
        }),
      },
    } as unknown as Pick<PrismaClient, "orderStatus">;

    await expect(seedOrderStatus(failing)).rejects.toThrow("conexion caida");
  });
});
