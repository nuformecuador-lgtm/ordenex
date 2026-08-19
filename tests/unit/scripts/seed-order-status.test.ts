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

// Feature 17/R9 + feature 30/R1 + feature 33/R1 + PR #75: ORDER_STATUS_SEED paso
// de 8 a 9 (por_recoger), de 9 a 10 (en_ruta_bodega_satelite), de 12 a
// 13 (en_bodega_satelite) y de 13 a 14 (devuelta_a_tienda). Feature 109 -> 15
// (sin_gestionar). Feature 139 -> 18 (por_devolver, devolviendo_a_bodega_central,
// por_devolver_a_tienda). Feature 154 -> 20 (por_recolectar_en_tienda, incidente).
// Feature 155/R27 -> 19: PRIMERA BAJA del catalogo (el estado de fulfillment). El sembrado
// idempotente deja de incluirlo; las ordenes que estuvieran ahi las reasigna la migracion.
// Feature 157 -> 20 (recolectando). Feature 239 (2026-08-19) -> 21 (devolucion_por_confirmar,
// el pre-estado de la devolucion).
describe("seedOrderStatus siembra los 21 estatus por value (R2/R5/R9 · 30 · 33 · PR #75 · 109 · 139 · 154 · 155 · 157 · 239)", () => {
  it("crea una fila por cada valor de ORDER_STATUS_SEED", async () => {
    const fake = createFakeOrderStatus();
    await seedOrderStatus({ orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >);

    expect(fake.upsert).toHaveBeenCalledTimes(21); // 2026-08-19 (239)
    const valores = [...fake.rows.values()].map((r) => r.value).sort();
    expect(valores).toEqual([...ORDER_STATUS_SEED].sort());
  });

  // Feature 154/R1/R2: el seed idempotente en TS siembra tambien los dos values del flujo v2,
  // igual que la migracion A los inserta en la tabla catalogo.
  it("feature 154/R1/R2: siembra por_recolectar_en_tienda e incidente", async () => {
    const fake = createFakeOrderStatus();
    await seedOrderStatus({ orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >);

    expect(fake.rows.has("por_recolectar_en_tienda")).toBe(true);
    expect(fake.rows.has("incidente")).toBe(true);
  });

  it("feature 139/R1: siembra los 3 estados del flujo de devolucion de rechazadas", async () => {
    const fake = createFakeOrderStatus();
    await seedOrderStatus({ orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >);

    expect(fake.rows.has("por_devolver")).toBe(true);
    expect(fake.rows.has("devolviendo_a_bodega_central")).toBe(true);
    expect(fake.rows.has("por_devolver_a_tienda")).toBe(true);
  });

  // Feature 155/R27: la BAJA tambien se afirma, no solo el conteo. El literal se construye por
  // concatenacion: ya no pertenece al tipo y no debe quedar en el arbol.
  it("feature 155/R27: NO siembra el estado de fulfillment retirado", async () => {
    const fake = createFakeOrderStatus();
    await seedOrderStatus({ orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >);

    expect(fake.rows.has(["en", "fulfillment"].join("_"))).toBe(false);
  });
});

describe("seedOrderStatus es idempotente (R3)", () => {
  it("dos ejecuciones dejan 21 filas, sin duplicar y con id estable", async () => {
    const fake = createFakeOrderStatus();
    const client = { orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >;

    await seedOrderStatus(client);
    expect(fake.rows.size).toBe(21); // 2026-08-19 (239)
    const idsPrimera = new Map([...fake.rows.entries()].map(([k, v]) => [k, v.id]));

    await seedOrderStatus(client);
    expect(fake.rows.size).toBe(21); // no crece

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
