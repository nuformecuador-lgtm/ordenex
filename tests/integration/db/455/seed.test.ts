import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

import { CODIGO_VIGENTE_DE_ANTERIOR, ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { seedOrderStatus } from "@/scripts/seed-catalogos";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "../_postgres-real";

/**
 * FICHA 455 (T1.5, design §3.3; R20) — el sembrado del catalogo NO crea una segunda fila para un
 * estado: si la base todavia tiene un codigo ANTERIOR (no se migro), falla con el codigo en el
 * mensaje y sin insertar nada. Contra Postgres real, en una transaccion revertida: se aplica el
 * `down.sql` de M1 dentro de ella para tener una base «sin migrar».
 */

const RAIZ = path.resolve(__dirname, "..", "..", "..", "..");
const M1_DOWN = fs.readFileSync(
  path.join(RAIZ, "db", "migrations", "20260924120000_order_status_nombre_unico", "down.sql"),
  "utf8",
);
const ANTERIORES = Object.keys(CODIGO_VIGENTE_DE_ANTERIOR);

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("455/R20 — el sembrado falla ante un codigo anterior, sin insertar", () => {
  let prisma: PrismaClient;
  let r: { error: string; antes: number; despues: number; anteriorEnBase: string[] };
  let control: { error: string | null; antes: number; despues: number };

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    r = await enTransaccionRevertida(prisma, async (tx) => {
      await tx.$executeRawUnsafe(M1_DOWN);
      const anteriorEnBase = (
        await tx.orderStatus.findMany({ where: { value: { in: ANTERIORES } }, select: { value: true } })
      ).map((x) => x.value);
      const antes = await tx.orderStatus.count();
      let error = "sin error";
      try {
        await seedOrderStatus(tx as unknown as Pick<PrismaClient, "orderStatus">);
      } catch (e) {
        error = (e as Error).message;
      }
      return { error, antes, despues: await tx.orderStatus.count(), anteriorEnBase };
    });
    control = await enTransaccionRevertida(prisma, async (tx) => {
      const antes = await tx.orderStatus.count();
      let error: string | null = null;
      try {
        await seedOrderStatus(tx as unknown as Pick<PrismaClient, "orderStatus">);
      } catch (e) {
        error = (e as Error).message;
      }
      return { error, antes, despues: await tx.orderStatus.count() };
    });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("PRECONDICION: la base «sin migrar» tiene los 7 codigos anteriores", () => {
    expect(r.anteriorEnBase.sort()).toEqual([...ANTERIORES].sort());
  });

  it("falla con un mensaje que NOMBRA el codigo anterior y manda a migrar", () => {
    expect(r.error).toMatch(/^order_status: la base tiene el código anterior '([a-z_]+)'; aplica la migración 455 antes de sembrar$/);
    const nombrado = /'([a-z_]+)'/.exec(r.error)![1];
    expect(ANTERIORES).toContain(nombrado);
  });

  it("NO inserta ninguna fila (no nace una segunda fila para el mismo estado)", () => {
    expect(r.despues).toBe(r.antes);
  });

  it("CONTROL: sobre la base migrada siembra sin error y sin duplicar (los 20 ya estan)", () => {
    expect(control.error).toBeNull();
    expect(control.despues).toBe(control.antes);
    expect(ORDER_STATUS_SEED).toHaveLength(20);
  });
});
