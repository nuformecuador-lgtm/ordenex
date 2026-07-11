import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { seedOrderStatus } from "@/scripts/seed-catalogos";

// R2/R5/R9: exactamente 10 valores canonicos, incluido en_preparacion (feature 15),
// en_espera_aceptacion (feature 17) y en_ruta_bodega_satelite (feature 30/R1);
// en_bodega se conserva como valor historico.
describe("ORDER_STATUS_SEED (R2/R5/R9 · feature 30/R1)", () => {
  it("contiene exactamente los 10 valores esperados", () => {
    expect([...ORDER_STATUS_SEED].sort()).toEqual(
      [
        "devuelta",
        "devuelta_origen",
        "en_fulfillment",
        "en_bodega",
        "en_preparacion",
        "en_espera_aceptacion",
        "en_ruta_bodega_principal",
        "en_ruta_bodega_satelite",
        "entregada",
        "reprogramada",
      ].sort(),
    );
  });

  it("incluye en_preparacion (default de creacion GLOBAL, feature 15/R7/R8)", () => {
    expect(ORDER_STATUS_SEED).toContain("en_preparacion");
  });

  it("incluye en_espera_aceptacion como 9no valor (feature 17/R9)", () => {
    expect(ORDER_STATUS_SEED).toContain("en_espera_aceptacion");
    expect(ORDER_STATUS_SEED[8]).toBe("en_espera_aceptacion");
  });

  it("R1: incluye en_ruta_bodega_satelite como 10mo valor (feature 30)", () => {
    expect(ORDER_STATUS_SEED).toContain("en_ruta_bodega_satelite");
    expect(ORDER_STATUS_SEED[9]).toBe("en_ruta_bodega_satelite");
  });

  it("no tiene valores duplicados", () => {
    expect(new Set(ORDER_STATUS_SEED).size).toBe(ORDER_STATUS_SEED.length);
    expect(ORDER_STATUS_SEED).toHaveLength(10);
  });
});

// R9: seedOrderStatus (upsert por value) siembra el nuevo valor de forma
// idempotente, sin duplicar ni alterar los 8 valores existentes.
describe("seedOrderStatus siembra en_espera_aceptacion de forma idempotente (R9)", () => {
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
        if (existing) return existing;
        const row: OrderStatusRow = { id: `os-${++idSeq}`, value: args.create.value };
        rows.set(args.where.value, row);
        return row;
      },
    );
    return { rows, upsert };
  }

  it("agrega en_espera_aceptacion sin duplicar tras dos ejecuciones", async () => {
    const fake = createFakeOrderStatus();
    const client = { orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >;

    await seedOrderStatus(client);
    expect(fake.rows.has("en_espera_aceptacion")).toBe(true);
    expect(fake.rows.has("en_ruta_bodega_satelite")).toBe(true); // feature 30/R1
    expect(fake.rows.size).toBe(10);
    const idPrimera = fake.rows.get("en_espera_aceptacion")?.id;

    await seedOrderStatus(client); // segunda ejecucion: idempotente
    expect(fake.rows.size).toBe(10); // no crece
    expect(fake.rows.get("en_espera_aceptacion")?.id).toBe(idPrimera); // id conservado
  });
});
