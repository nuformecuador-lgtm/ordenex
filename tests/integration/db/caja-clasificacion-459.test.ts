import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { TIPO_POR_CATEGORIA_TIENDA } from "@/lib/utils/invariante-tiendas";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 459 / T A.5 — afirmacion 5 de la guardia de la invariante (design §12.3): el TIPO que
 * `TIPO_POR_CATEGORIA_TIENDA` declara para cada concepto del libro de la tienda es EXACTAMENTE el
 * que admite el CHECK `wallet_tienda_movimiento_tipo_categoria_check` de la base.
 *
 * Se mide por COMPORTAMIENTO y no leyendo el texto del CHECK: por cada concepto se intenta insertar
 * la fila con los DOS tipos, cada intento en su savepoint, y se anota cual acepta Postgres. Asi la
 * afirmacion no depende de como `pg_get_constraintdef` formatee la lista. La guardia unitaria usa
 * esta tabla para derivar el signo de cada concepto en el saldo; si la tabla mintiera sobre el
 * tipo, la guardia estaria comprobando otra invariante.
 *
 * Todo en una transaccion que SIEMPRE se revierte. Sin base se SALTA; con base y sin catalogo
 * falla RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("459/T A.5 — el tipo de cada concepto de la tienda = el CHECK de la base", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R9/R90: Postgres acepta cada concepto SOLO con el tipo que declara la tabla", async () => {
    const aceptados = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const rol = await tx.rol.findUnique({ where: { value: "adminTienda" }, select: { id: true } });
      const tipo = await tx.tipoIdentificacion.findUnique({
        where: { value: "cedula" },
        select: { id: true },
      });
      if (rol === null || tipo === null) {
        throw new Error("faltan `rol.adminTienda` o `cedula`: corre `pnpm run db:seed`.");
      }
      const clave = randomUUID().slice(0, 8);
      const tienda = await tx.usuario.create({
        data: {
          nombre: `Tienda 459 check ${clave}`,
          email: `tienda459-check-${clave}@example.test`,
          telefono: "88880000",
          passwordHash: "x",
          cedula: `459-CHECK-${clave}`,
          tipoIdentificacionId: tipo.id,
          rolId: rol.id,
        },
        select: { id: true },
      });

      const resultado: Record<string, string[]> = {};
      for (const categoria of WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED) {
        resultado[categoria] = [];
        for (const t of ["credito", "debito"] as const) {
          const punto = `sp459_${categoria}_${t}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
          try {
            await tx.walletTiendaMovimiento.create({
              data: {
                tiendaId: tienda.id,
                tipo: t,
                categoria,
                monto: new Prisma.Decimal("1.00"),
                origenTipo: "manual",
                origenId: null,
              },
            });
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
            resultado[categoria].push(t);
          } catch {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
          }
        }
      }
      return resultado;
    });

    // Anti-vacuidad: se probaron TODOS los conceptos y cada uno entro con algun tipo.
    expect(Object.keys(aceptados).sort()).toEqual([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort());
    const esperado = Object.fromEntries(
      WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.map((c) => [c, [TIPO_POR_CATEGORIA_TIENDA[c]]]),
    );
    expect(aceptados).toEqual(esperado);
  }, 120_000);
});
