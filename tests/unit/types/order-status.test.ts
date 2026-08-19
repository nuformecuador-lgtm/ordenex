import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { seedOrderStatus } from "@/scripts/seed-catalogos";

// R1/R5/R12: valores canonicos tras el rename de nomenclatura (feature 135). Seis
// values se renombraron conservando su POSICION en la tupla (indices 8/10/13, y el
// 2/5/6): por_recoger (feature 17), en_reparto (feature 36), en_bodega_central,
// en_ruta_bodega_central, devolviendo_a_tienda y devuelta_a_tienda. Los otros 9 no
// cambian (en_ruta_bodega_satelite feature 30, en_bodega_satelite feature 33, etc.).
describe("ORDER_STATUS_SEED (R1/R5/R12 · 135 rename · 139 devolucion · 154 v2 · 155 retiro)", () => {
  it("contiene exactamente los 21 valores esperados", () => {
    expect([...ORDER_STATUS_SEED].sort()).toEqual(
      [
        "devuelta",
        "devolviendo_a_tienda",
        "en_bodega_central",
        "en_preparacion",
        "por_recoger",
        "en_ruta_bodega_central",
        "en_ruta_bodega_satelite",
        "en_reparto",
        "rechazada",
        "entregada",
        "reprogramada",
        "en_bodega_satelite",
        "devuelta_a_tienda",
        "sin_gestionar",
        // feature 139: los 3 estados del flujo de devolucion de rechazadas
        "por_devolver",
        "devolviendo_a_bodega_central",
        "por_devolver_a_tienda",
        // feature 154: los 2 estados del flujo v2
        "por_recolectar_en_tienda",
        "recolectando", // feature 157 (ampliacion)
        "incidente",
        // Feature 239 (2026-08-19): el PRE-ESTADO de la devolucion. El mensajero la gestiono y
        // la bodega aun no la confirmo al aprobar el cierre; hasta entonces no la ve la tienda
        // ni corre su ventana de SLA.
        "devolucion_por_confirmar",
      ].sort(),
    );
  });

  // Feature 154/R1/R2 + 155/R27: los dos values del flujo v2 siguen siendo los DOS ULTIMOS.
  // Sus indices bajan de 18/19 a 17/18 porque la 155 retiro un value ANTERIOR a ellos; el
  // ORDEN RELATIVO del catalogo no cambia.
  it("feature 154/R1/R2: por_recolectar_en_tienda e incidente conservan su posicion", () => {
    expect(ORDER_STATUS_SEED[17]).toBe("por_recolectar_en_tienda");
    expect(ORDER_STATUS_SEED[18]).toBe("incidente");
    // La 157 apendio `recolectando` DESPUES y la 239 `devolucion_por_confirmar`, sin mover a
    // los dos de la 154 (las dos son aditivas puras).
    expect(ORDER_STATUS_SEED.slice(-4)).toEqual([
      "por_recolectar_en_tienda",
      "incidente",
      "recolectando",
      "devolucion_por_confirmar", // feature 239 (2026-08-19)
    ]);
  });

  // Feature 155/R27: el UNICO cambio sobre el catalogo de la 154 es la BAJA del estado de
  // fulfillment (que ocupaba el indice 4). Ni un rename, ni un reorden, ni otra baja.
  it("feature 155/R27: los 17 values previos siguen intactos y en su orden relativo", () => {
    const PREVIOS_17 = [
      "entregada",
      "devuelta",
      "devolviendo_a_tienda",
      "reprogramada",
      "en_ruta_bodega_central",
      "en_bodega_central",
      "en_preparacion",
      "por_recoger",
      "en_ruta_bodega_satelite",
      "en_reparto",
      "rechazada",
      "en_bodega_satelite",
      "devuelta_a_tienda",
      "sin_gestionar",
      "por_devolver",
      "devolviendo_a_bodega_central",
      "por_devolver_a_tienda",
    ];
    expect(ORDER_STATUS_SEED.slice(0, 17)).toEqual(PREVIOS_17);
    expect(ORDER_STATUS_SEED).toHaveLength(21); // 2026-08-19 (239): +devolucion_por_confirmar
  });

  // Feature 155/R27: el value retirado ya no esta. Se construye por concatenacion para no
  // dejar el literal en el arbol (censo de la 155) y porque el tipo ya no lo admite.
  it("feature 155/R27: el estado de fulfillment ya NO esta en el seed", () => {
    const retirado = ["en", "fulfillment"].join("_");
    expect(ORDER_STATUS_SEED as readonly string[]).not.toContain(retirado);
  });

  it("feature 139/R1: incluye los 3 estados del flujo de devolucion (indices 14/15/16 tras la 155)", () => {
    // Se APENDIERON al final; la 155 los corre UNA posicion al retirar un value previo.
    expect(ORDER_STATUS_SEED[14]).toBe("por_devolver");
    expect(ORDER_STATUS_SEED[15]).toBe("devolviendo_a_bodega_central");
    expect(ORDER_STATUS_SEED[16]).toBe("por_devolver_a_tienda");
    // El set completo incluye los 3 nuevos.
    const set = new Set(ORDER_STATUS_SEED);
    expect(set.has("por_devolver")).toBe(true);
    expect(set.has("devolviendo_a_bodega_central")).toBe(true);
    expect(set.has("por_devolver_a_tienda")).toBe(true);
  });

  it("incluye en_preparacion (default de creacion GLOBAL, feature 15/R7/R8)", () => {
    expect(ORDER_STATUS_SEED).toContain("en_preparacion");
  });

  // Los indices de aqui abajo bajaron UNO tras la 155 (el value retirado ocupaba el 4).
  it("R5/R12: por_recoger conserva su lugar relativo (indice 7 tras la 155, feature 17)", () => {
    expect(ORDER_STATUS_SEED).toContain("por_recoger");
    expect(ORDER_STATUS_SEED[7]).toBe("por_recoger");
  });

  it("R1: incluye en_ruta_bodega_satelite (indice 8 tras la 155, feature 30)", () => {
    expect(ORDER_STATUS_SEED).toContain("en_ruta_bodega_satelite");
    expect(ORDER_STATUS_SEED[8]).toBe("en_ruta_bodega_satelite");
  });

  it("R5/R12: en_reparto y rechazada (indices 9 y 10 tras la 155, feature 36)", () => {
    expect(ORDER_STATUS_SEED[9]).toBe("en_reparto");
    expect(ORDER_STATUS_SEED[10]).toBe("rechazada");
  });

  it("R1: incluye en_bodega_satelite (indice 11 tras la 155, feature 33)", () => {
    expect(ORDER_STATUS_SEED).toContain("en_bodega_satelite");
    expect(ORDER_STATUS_SEED[11]).toBe("en_bodega_satelite");
  });

  it("R5/R12: devuelta_a_tienda (indice 12 tras la 155, cierre de devolucion)", () => {
    expect(ORDER_STATUS_SEED).toContain("devuelta_a_tienda");
    expect(ORDER_STATUS_SEED[12]).toBe("devuelta_a_tienda");
  });

  it("feature 109/R1: incluye sin_gestionar (indice 13 tras la 155)", () => {
    expect(ORDER_STATUS_SEED).toContain("sin_gestionar");
    expect(ORDER_STATUS_SEED[13]).toBe("sin_gestionar");
  });

  it("no tiene valores duplicados", () => {
    expect(new Set(ORDER_STATUS_SEED).size).toBe(ORDER_STATUS_SEED.length);
    expect(ORDER_STATUS_SEED).toHaveLength(21); // 2026-08-19 (239)
  });
});

// R9: seedOrderStatus (upsert por value) siembra los values canonicos de forma
// idempotente, sin duplicar ni alterar los existentes.
describe("seedOrderStatus siembra los values renombrados de forma idempotente (R9)", () => {
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

  it("agrega por_recoger sin duplicar tras dos ejecuciones", async () => {
    const fake = createFakeOrderStatus();
    const client = { orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >;

    await seedOrderStatus(client);
    expect(fake.rows.has("por_recoger")).toBe(true);
    expect(fake.rows.has("en_ruta_bodega_satelite")).toBe(true); // feature 30/R1
    expect(fake.rows.has("en_reparto")).toBe(true); // feature 36/R1
    expect(fake.rows.has("rechazada")).toBe(true); // feature 36/R3
    expect(fake.rows.has("en_bodega_satelite")).toBe(true); // feature 33/R1
    expect(fake.rows.has("devuelta_a_tienda")).toBe(true); // cierre de devolucion
    expect(fake.rows.has("sin_gestionar")).toBe(true); // feature 109
    expect(fake.rows.has("por_devolver")).toBe(true); // feature 139
    expect(fake.rows.has("devolviendo_a_bodega_central")).toBe(true); // feature 139
    expect(fake.rows.has("por_devolver_a_tienda")).toBe(true); // feature 139
    expect(fake.rows.has("por_recolectar_en_tienda")).toBe(true); // feature 154
    expect(fake.rows.has("incidente")).toBe(true); // feature 154
    // Feature 155/R27: el sembrado idempotente DEJA DE INCLUIR el estado retirado. Es la
    // mitad "codigo" del retiro; la mitad "datos" es la migracion con su backfill.
    expect(fake.rows.has(["en", "fulfillment"].join("_"))).toBe(false);
    expect(fake.rows.has("devolucion_por_confirmar")).toBe(true); // feature 239
    expect(fake.rows.size).toBe(21); // 2026-08-19 (239)
    const idPrimera = fake.rows.get("por_recoger")?.id;

    await seedOrderStatus(client); // segunda ejecucion: idempotente
    expect(fake.rows.size).toBe(21); // no crece
    expect(fake.rows.get("por_recoger")?.id).toBe(idPrimera); // id conservado
  });

  // Feature 154/R4: reaplicar el alta sobre un catalogo que YA tiene los dos values lo deja con
  // 19 (20 antes de la 155) y sin duplicados. Es la contraparte en TS del
  // `INSERT ... WHERE NOT EXISTS` de la migracion A (idempotencia en tests/integration/db).
  it("feature 154/R4: el alta de los dos values nuevos es idempotente (19 filas, sin duplicar)", async () => {
    const fake = createFakeOrderStatus();
    const client = { orderStatus: { upsert: fake.upsert } } as unknown as Pick<
      PrismaClient,
      "orderStatus"
    >;

    await seedOrderStatus(client);
    const idIncidente = fake.rows.get("incidente")?.id;
    const idRecolectar = fake.rows.get("por_recolectar_en_tienda")?.id;

    await seedOrderStatus(client);
    await seedOrderStatus(client);

    expect(fake.rows.size).toBe(21); // 2026-08-19 (239)
    expect(fake.rows.get("incidente")?.id).toBe(idIncidente);
    expect(fake.rows.get("por_recolectar_en_tienda")?.id).toBe(idRecolectar);
  });
});
