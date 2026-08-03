import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaCodFeedService } from "@/lib/services/CajaCodFeedService";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

/**
 * Feature 173 / T B.4 (R14, R48 — parte cierre) — la idempotencia del contra-entrega, contra
 * **Postgres de verdad**.
 *
 * Por que no vale un doble aqui: lo que esta task promete es que la barrera es el **indice
 * unico parcial** `(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`, no un `if`
 * del servicio. Un doble en memoria demuestra que el codigo *dice* `skipDuplicates`; solo el
 * motor demuestra que existe el indice, que cubre la categoria nueva y que un segundo intento
 * sin `ON CONFLICT` **revienta**. De paso, esto es la primera prueba de que el valor de enum
 * `ingreso_cod_recaudado` de `T A.1` esta aplicado en la base.
 *
 * Aislamiento: todo corre dentro de una transaccion que SIEMPRE se revierte (patron de la 169).
 * Si el test pasa, si falla o si el runner muere, no queda ni una fila de dinero inventada.
 * Sin base alcanzable, la suite se SALTA (no falla).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const feed = new CajaCodFeedService();

describeSiHayBase("173/T B.4 — idempotencia del contra-entrega contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * DOS tiendas que ya existan: `wallet_tienda_movimiento.tienda_id` es FK a usuario, y el
   * ledger tiene su propio indice unico parcial `(origen_tipo, origen_id, tienda_id,
   * categoria)` — dos creditos de contra-entrega del MISMO cierre solo pueden ser de tiendas
   * distintas, que es exactamente como los emite el feed de la 43 (agrega por tienda).
   */
  async function dosUsuarios(
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  ): Promise<[string, string] | null> {
    const us = await tx.usuario.findMany({ take: 2, select: { id: true } });
    return us.length === 2 ? [us[0].id, us[1].id] : null;
  }

  it("R14/R48: aprobar DOS veces el mismo cierre inserta UNA fila de contra-entrega", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const tiendas = await dosUsuarios(tx);
      if (tiendas === null) return null; // base sin usuarios: nada que probar
      const [t1, t2] = tiendas;
      const cierreId = randomUUID();
      const repo = new WalletMovimientoRepository(tx as unknown as PrismaClient);

      // El LEDGER de ese cierre, como lo dejaria la 43: dos tiendas con contra-entrega, un
      // DEBITO (flete: lo que Ordenex se queda, y que ya entro en la caja por su concepto de
      // la 42) y un CREDITO de otra categoria (un ajuste manual a favor de la tienda). Los
      // cuatro comparten tabla y origen a proposito: si al WHERE del feed le faltara
      // `categoria` o `tipo`, alguno se colaria en la caja y el contra-entrega diria de mas.
      await tx.walletTiendaMovimiento.createMany({
        data: [
          { tiendaId: t1, tipo: "credito", categoria: "cod_recaudado", monto: new Prisma.Decimal("12500.75"), origenTipo: "cierre_dia", origenId: cierreId },
          { tiendaId: t2, tipo: "credito", categoria: "cod_recaudado", monto: new Prisma.Decimal("300.25"), origenTipo: "cierre_dia", origenId: cierreId },
          { tiendaId: t1, tipo: "debito", categoria: "flete", monto: new Prisma.Decimal("1000.00"), origenTipo: "cierre_dia", origenId: cierreId },
          { tiendaId: t1, tipo: "credito", categoria: "ajuste_credito", monto: new Prisma.Decimal("999.00"), origenTipo: "cierre_dia", origenId: cierreId },
        ],
      });

      // PRIMERA aprobacion: el feed REAL lee el ledger REAL y el repo REAL inserta.
      const movs = await feed.construirIngresoCod(cierreId, tx);
      const insertadasPrimera = await repo.crearMovimientos(tx, movs);
      // SEGUNDA aprobacion (reintento, doble submit, carrera): mismo camino, sin ningun `if`.
      const movsOtraVez = await feed.construirIngresoCod(cierreId, tx);
      const insertadasSegunda = await repo.crearMovimientos(tx, movsOtraVez);

      const filas = await tx.walletMovimiento.findMany({
        where: { origenTipo: "cierre_dia", origenId: cierreId },
        select: { tipo: true, categoria: true, monto: true, origenId: true },
      });
      return { movs, insertadasPrimera, insertadasSegunda, filas };
    });

    if (resultado === null) return; // sin usuarios en la base
    const { movs, insertadasPrimera, insertadasSegunda, filas } = resultado;

    // El feed emitio UN movimiento con la suma exacta de los CREDITOS (el debito no cuenta).
    expect(movs).toHaveLength(1);
    expect(movs[0].monto).toBe("12801.00");
    expect(movs[0].categoria).toBe("ingreso_cod_recaudado");

    // R14: la segunda pasada es un NO-OP. Postgres devuelve 0 filas insertadas, sin error.
    expect(insertadasPrimera).toBe(1);
    expect(insertadasSegunda).toBe(0);

    // Y en la tabla queda UNA fila, con su monto intacto.
    expect(filas).toHaveLength(1);
    expect(filas[0].categoria).toBe("ingreso_cod_recaudado");
    expect(filas[0].tipo).toBe("ingreso");
    expect(filas[0].monto.toFixed(2)).toBe("12801.00");
  });

  it("R48: la barrera es el INDICE — el mismo insert sin `ON CONFLICT` revienta con 23505", async () => {
    // Esta es la contraprueba de que la idempotencia NO la da el `skipDuplicates` del codigo
    // por buena voluntad, sino una restriccion de datos: si alguien quitara `skipDuplicates`,
    // la aprobacion no duplicaria — fallaria en alto.
    const error = await enTransaccionRevertida(prisma, async (tx) => {
      const cierreId = randomUUID();
      const repo = new WalletMovimientoRepository(tx as unknown as PrismaClient);
      await repo.crearMovimientos(tx, [
        {
          tipo: "ingreso",
          categoria: "ingreso_cod_recaudado",
          monto: "12801.00",
          origenTipo: "cierre_dia",
          origenId: cierreId,
        },
      ]);
      try {
        await tx.walletMovimiento.create({
          data: {
            tipo: "ingreso",
            categoria: "ingreso_cod_recaudado",
            monto: new Prisma.Decimal("999999.00"),
            origenTipo: "cierre_dia",
            origenId: cierreId,
          },
        });
        return "NO FALLO";
      } catch (e) {
        return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
    });

    expect(error).not.toBe("NO FALLO");
    expect(error).toMatch(/23505|duplicate key|Unique constraint|P2002/i);
  });

  it("R13: un cierre sin creditos de contra-entrega no produce ninguna fila", async () => {
    const insertadas = await enTransaccionRevertida(prisma, async (tx) => {
      const cierreId = randomUUID(); // sin nada en el ledger
      const movs = await feed.construirIngresoCod(cierreId, tx);
      expect(movs).toEqual([]);
      return new WalletMovimientoRepository(tx as unknown as PrismaClient).crearMovimientos(
        tx,
        movs,
      );
    });

    expect(insertadas).toBe(0);
  });

  it("dos cierres DISTINTOS no se deduplican entre si (la clave lleva el origen)", async () => {
    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      const repo = new WalletMovimientoRepository(tx as unknown as PrismaClient);
      const a = randomUUID();
      const b = randomUUID();
      const mov = (origenId: string, monto: string) => ({
        tipo: "ingreso" as const,
        categoria: "ingreso_cod_recaudado" as const,
        monto,
        origenTipo: "cierre_dia" as const,
        origenId,
      });
      await repo.crearMovimientos(tx, [mov(a, "100.00"), mov(b, "200.00")]);
      return tx.walletMovimiento.findMany({
        where: { origenTipo: "cierre_dia", origenId: { in: [a, b] } },
        select: { monto: true },
      });
    });

    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.monto.toFixed(2)).sort()).toEqual(["100.00", "200.00"]);
  });
});

describe("173/T B.4 — R48: la idempotencia no es un `if` (estructural)", () => {
  /** Codigo sin comentarios: lo que se afirma es lo que se EJECUTA, no lo que se explica. */
  function codigoDe(ruta: string): string {
    return readFileSync(resolve(process.cwd(), ruta), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  it("el repositorio de la caja inserta con `skipDuplicates` y NO consulta antes de escribir", () => {
    const codigo = codigoDe("lib/repositories/WalletMovimientoRepository.ts");
    const crearMovimientos = codigo.slice(
      codigo.indexOf("async crearMovimientos"),
      codigo.indexOf("async listar"),
    );

    expect(crearMovimientos).toMatch(/skipDuplicates:\s*true/);
    // Check-then-insert seria un TOCTOU: entre la consulta y el insert cabe otra transaccion.
    expect(crearMovimientos).not.toMatch(/findFirst|findUnique|\.count\(/);
  });

  it("el enganche de la aprobacion no pregunta si el contra-entrega ya existe", () => {
    const codigo = codigoDe("lib/repositories/CierresAdminRepository.ts");
    const bloque = codigo.slice(
      codigo.indexOf("CAJA_COD_FEED.construirIngresoCod"),
      codigo.indexOf("construirMovimientosDePago"),
    );

    expect(bloque.length).toBeGreaterThan(0);
    expect(bloque).not.toMatch(/findFirst|findUnique|\.count\(|ya existe|existente/);
  });
});
