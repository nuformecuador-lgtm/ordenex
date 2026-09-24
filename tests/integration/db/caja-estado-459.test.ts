import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { enTransaccionRevertida459 } from "./_fixtures/caja-459";

/**
 * FICHA 459 / T A.4 — el `MIN` y el `WHERE` de `primerDiaDeLaCaja`, contra Postgres (R15/R71).
 *
 * Los tests de servicio usan dobles y no ven el SQL. Aqui se siembran dos movimientos MAS VIEJOS
 * que todo el libro local y se afirma el dia CR exacto que devuelve el repositorio real, en una
 * transaccion que siempre se revierte. La frontera CR se prueba con un instante de las 05:00Z,
 * que en Costa Rica (UTC−6) es TODAVIA el dia anterior.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("459/A.4 — el primer dia de la caja, contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R15: `MIN(fecha_movimiento)` en dia de Costa Rica, sin filtros", async () => {
    const medido = await enTransaccionRevertida459(prisma, async (tx) => {
      const repo = new WalletMovimientoRepository(tx as unknown as PrismaClient);
      const antes = await repo.primerDiaDeLaCaja();
      await tx.walletMovimiento.createMany({
        data: [
          {
            tipo: "egreso",
            categoria: "egreso_sueldo",
            monto: new Prisma.Decimal("1.00"),
            origenTipo: "manual",
            origenId: null,
            // 2020-01-02 05:00Z = 2020-01-01 23:00 en Costa Rica.
            fechaMovimiento: new Date("2020-01-02T05:00:00.000Z"),
          },
          {
            tipo: "ingreso",
            categoria: "ingreso_ajuste",
            monto: new Prisma.Decimal("1.00"),
            origenTipo: "manual",
            origenId: null,
            fechaMovimiento: new Date("2020-06-01T12:00:00.000Z"),
          },
        ],
      });
      return { antes, despues: await repo.primerDiaDeLaCaja() };
    });

    // Anti-vacuidad: el libro local no empezaba antes de 2020.
    expect(medido.antes === null || medido.antes > "2020-01-01").toBe(true);
    expect(medido.despues).toBe("2020-01-01");
  });
});
