import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 42 — tests unit del WalletMovimientoRepository (mockea Prisma, sin DB real).
// Cubre R2 (persiste tipo/categoria/monto/origen/fecha), R6/R13 (idempotencia por
// skipDuplicates -> ON CONFLICT DO NOTHING), R14 (egresos polimorficos), R20 (filtros en
// el WHERE), R24 (orderBy fecha desc, balance agregado STRING).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    walletMovimiento: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    ...overrides,
  };
}

describe("crearMovimientos (R2/R6/R13/R14)", () => {
  it("R2: mapea monto STRING -> Prisma.Decimal y persiste todos los campos", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 1 });
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const movs: CrearMovimientoInput[] = [
      {
        tipo: "ingreso",
        categoria: "ingreso_flete",
        monto: "1000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
      },
    ];
    const n = await repo.crearMovimientos(prisma as never, movs);

    expect(n).toBe(1);
    const arg = prisma.walletMovimiento.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true); // R6/R13: ON CONFLICT DO NOTHING
    expect(arg.data[0]).toMatchObject({
      tipo: "ingreso",
      categoria: "ingreso_flete",
      origenTipo: "cierre_dia",
      origenId: "c1",
      descripcion: null,
      registradoPor: null,
    });
    expect(arg.data[0].monto).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data[0].monto.toFixed(2)).toBe("1000.00");
  });

  it("R14: acepta egresos con categoria/origen polimorfico y registradoPor", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 1 });
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(prisma as never, [
      {
        tipo: "egreso",
        categoria: "egreso_ajuste",
        monto: "50.00",
        origenTipo: "manual",
        origenId: null,
        descripcion: "ajuste manual",
        registradoPor: "u-maestro",
      },
    ]);

    const arg = prisma.walletMovimiento.createMany.mock.calls[0][0];
    expect(arg.data[0]).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_ajuste",
      origenTipo: "manual",
      origenId: null,
      descripcion: "ajuste manual",
      registradoPor: "u-maestro",
    });
  });

  // Feature 173 (T A.3, design §2.3) — la fecha REAL del hecho, opcional.
  it("R20/R25: cuando el llamador NO pasa fechaMovimiento, la clave NO viaja (la base pone CURRENT_TIMESTAMP)", async () => {
    // Es la mitad que hace la ampliacion de coste CERO: los cinco escritores existentes no
    // la pasan y tienen que seguir cayendo en el DEFAULT de la columna. Si la clave viajara
    // como `undefined`, seguiria funcionando; si viajara como `null`, la insercion fallaria.
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 1 });
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(prisma as never, [
      { tipo: "ingreso", categoria: "ingreso_flete", monto: "1.00", origenTipo: "cierre_dia", origenId: "c1" },
    ]);

    const arg = prisma.walletMovimiento.createMany.mock.calls[0][0];
    expect(Object.keys(arg.data[0])).not.toContain("fechaMovimiento");
  });

  it("R20/R25: cuando el llamador SI pasa fechaMovimiento, viaja tal cual a la insercion", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 1 });
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const fechaDelPago = new Date("2026-07-14T06:00:00.000Z");
    await repo.crearMovimientos(prisma as never, [
      {
        tipo: "egreso",
        categoria: "egreso_pago_tienda",
        monto: "4000.00",
        origenTipo: "pago_tienda",
        origenId: "p1",
        fechaMovimiento: fechaDelPago,
      },
    ]);

    const arg = prisma.walletMovimiento.createMany.mock.calls[0][0];
    expect(arg.data[0].fechaMovimiento).toEqual(fechaDelPago);
  });

  it("R6: lista vacia -> no llama createMany, devuelve 0", async () => {
    const prisma = buildPrisma();
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);
    const n = await repo.crearMovimientos(prisma as never, []);
    expect(n).toBe(0);
    expect(prisma.walletMovimiento.createMany).not.toHaveBeenCalled();
  });

  it("R6/R13: cuando el constraint deduplica, count refleja solo lo insertado (no error)", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 0 }); // todo ya existia
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);
    const n = await repo.crearMovimientos(prisma as never, [
      { tipo: "ingreso", categoria: "ingreso_flete", monto: "1.00", origenTipo: "cierre_dia", origenId: "c1" },
    ]);
    expect(n).toBe(0);
  });
});

describe("listar (R20/R24)", () => {
  it("R20: aplica filtros tipo/categoria/rango en el WHERE; orderBy fecha desc; paginado", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.findMany.mockResolvedValue([]);
    prisma.walletMovimiento.count.mockResolvedValue(0);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const desde = new Date("2026-07-01T00:00:00.000Z");
    const hasta = new Date("2026-07-31T00:00:00.000Z");
    await repo.listar({ page: 2, pageSize: 20, tipo: "ingreso", categoria: "ingreso_flete", desde, hasta });

    const arg = prisma.walletMovimiento.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      tipo: "ingreso",
      categoria: "ingreso_flete",
      fechaMovimiento: { gte: desde, lte: hasta },
    });
    expect(arg.orderBy).toEqual({ fechaMovimiento: "desc" });
    expect(arg.skip).toBe(20); // (page 2 - 1) * 20
    expect(arg.take).toBe(20);
  });

  it("sin filtros -> WHERE vacio; mapea filas a DTO con monto STRING y fecha ISO", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.findMany.mockResolvedValue([
      {
        id: "w1",
        tipo: "ingreso",
        categoria: "ingreso_flete",
        monto: new Prisma.Decimal("1000"),
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        registradoPor: null,
        fechaMovimiento: new Date("2026-07-12T10:00:00.000Z"),
        createdAt: new Date("2026-07-12T10:00:00.000Z"),
      },
    ]);
    prisma.walletMovimiento.count.mockResolvedValue(1);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const r = await repo.listar({ page: 1, pageSize: 20 });

    expect(prisma.walletMovimiento.findMany.mock.calls[0][0].where).toEqual({});
    expect(r.total).toBe(1);
    expect(r.movimientos[0]).toEqual({
      id: "w1",
      tipo: "ingreso",
      categoria: "ingreso_flete",
      monto: "1000.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
      descripcion: null,
      registradoPor: null,
      fechaMovimiento: "2026-07-12T10:00:00.000Z",
    });
    expect(typeof r.movimientos[0].monto).toBe("string");
  });
});

// ── Feature 173 (T D.1, R8 parte datos / R47) — agregado por (categoria, tipo) ──
//
// Reemplaza al describe del agregado por `tipo` a secas que traia la 42. No es un refactor de
// estilo: con la caja en modo tesoreria la naturaleza del dinero (propio / de terceros) es de
// la CATEGORIA, asi que un agregado sin categoria NO PUEDE dar las dos cifras. El metodo viejo
// se elimino en esta misma tanda al quedarse sin consumidores (conventions: nada de codigo
// muerto), y por eso este bloque lo SUSTITUYE en vez de convivir con el.

describe("agregarPorCategoriaYTipo (R8/R47)", () => {
  it("R8: groupBy por (categoria, tipo) con SUM(monto) y los MISMOS filtros del listado", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.groupBy.mockResolvedValue([
      { categoria: "ingreso_flete", tipo: "ingreso", _sum: { monto: new Prisma.Decimal("1500.50") } },
      { categoria: "egreso_gasto", tipo: "egreso", _sum: { monto: new Prisma.Decimal("300.25") } },
    ]);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const desde = new Date("2026-07-01T00:00:00.000Z");
    const hasta = new Date("2026-07-31T00:00:00.000Z");
    const r = await repo.agregarPorCategoriaYTipo({ tipo: "ingreso", categoria: "ingreso_flete", desde, hasta });

    const arg = prisma.walletMovimiento.groupBy.mock.calls[0][0];
    // La CATEGORIA en el `by` es lo que hace derivable la particion por naturaleza: sin ella,
    // «dinero en caja» y «ganancia de Ordenex» serian el mismo numero para siempre.
    expect(arg.by).toEqual(["categoria", "tipo"]);
    // El MISMO `where` que construye `listar` (mismo `buildWhere`): la cabecera y su propio
    // listado no pueden dejar de cuadrar.
    expect(arg.where).toEqual({
      tipo: "ingreso",
      categoria: "ingreso_flete",
      fechaMovimiento: { gte: desde, lte: hasta },
    });
    expect(arg._sum).toEqual({ monto: true });
    expect(r).toEqual([
      { categoria: "ingreso_flete", tipo: "ingreso", total: "1500.50" },
      { categoria: "egreso_gasto", tipo: "egreso", total: "300.25" },
    ]);
  });

  it("R8: los totales salen como STRING escala 2 — ni un `number` cruza la frontera", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.groupBy.mockResolvedValue([
      { categoria: "ingreso_cod_recaudado", tipo: "ingreso", _sum: { monto: new Prisma.Decimal("800") } },
      // 0.1 + 0.2 en coma flotante da 0.30000000000000004; con Decimal, "0.30".
      { categoria: "egreso_gasto", tipo: "egreso", _sum: { monto: new Prisma.Decimal("0.1").add("0.2") } },
    ]);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const r = await repo.agregarPorCategoriaYTipo({});

    expect(r.map((f) => f.total)).toEqual(["800.00", "0.30"]);
    for (const fila of r) expect(typeof fila.total).toBe("string");
  });

  it("un grupo sin suma (SUM NULL) vale 0.00, no revienta ni devuelve null", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.groupBy.mockResolvedValue([
      { categoria: "ingreso_ajuste", tipo: "ingreso", _sum: { monto: null } },
    ]);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);
    expect(await repo.agregarPorCategoriaYTipo({})).toEqual([
      { categoria: "ingreso_ajuste", tipo: "ingreso", total: "0.00" },
    ]);
  });

  it("libro vacio -> lista vacia (y `derivarCaja` sabra que eso son dos ceros)", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.groupBy.mockResolvedValue([]);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);
    expect(await repo.agregarPorCategoriaYTipo({})).toEqual([]);
  });

  it("sin filtros -> WHERE vacio (el conjunto es el libro entero)", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.groupBy.mockResolvedValue([]);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);
    await repo.agregarPorCategoriaYTipo({});
    expect(prisma.walletMovimiento.groupBy.mock.calls[0][0].where).toEqual({});
  });

  it("R47: la superficie del repositorio son CINCO metodos — ni update, ni delete, ni el viejo", () => {
    const metodos = Object.getOwnPropertyNames(WalletMovimientoRepository.prototype)
      .filter((m) => m !== "constructor")
      .sort();

    // El libro es APPEND-ONLY: una correccion es un movimiento compensatorio, no una edicion.
    // Se afirma sobre la lista COMPLETA y CERRADA, no con cuatro `toBeUndefined()`: asi caen
    // igual un `actualizarMonto` futuro (que no se llama «update») y el agregado por `tipo` a
    // secas si alguien lo resucitara.
    expect(metodos).toEqual([
      "agregarPorCategoria",
      "agregarPorCategoriaYTipo",
      "crearMovimientos",
      "listar",
      "obtenerPorId",
    ]);
    expect(metodos.some((m) => /update|delete|actualizar|eliminar|borrar/i.test(m))).toBe(false);
  });
});
