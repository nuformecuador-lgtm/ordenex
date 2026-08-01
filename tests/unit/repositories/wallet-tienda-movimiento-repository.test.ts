import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";

// Feature 43/T6 — tests unit del WalletTiendaMovimientoRepository (mockea Prisma, sin DB).
// Cubre R2 (persiste todos los campos), R6 (createMany skipDuplicates), R16 (agrega saldo),
// R19 (acotado por tienda_id SIEMPRE en el WHERE), R22 (filtros cierre/categoria/fecha en el
// WHERE), R20 (una fila por tienda con nombre para el maestro).

function movRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    tiendaId: "t1",
    tipo: "credito",
    categoria: "cod_recaudado",
    monto: new Prisma.Decimal("10000.00"),
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: new Date("2026-07-12T10:00:00.000Z"),
    createdAt: new Date("2026-07-12T10:00:00.000Z"),
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    walletTiendaMovimiento: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    usuario: { findMany: vi.fn() },
    ...overrides,
  };
}

describe("WalletTiendaMovimientoRepository.crearMovimientos (R2/R6)", () => {
  it("R6: inserta con createMany skipDuplicates y mapea monto STRING -> Decimal", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.createMany.mockResolvedValue({ count: 2 });
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    const movs: CrearMovimientoTiendaInput[] = [
      { tiendaId: "t1", tipo: "credito", categoria: "cod_recaudado", monto: "10000.00", origenTipo: "cierre_dia", origenId: "c1" },
      { tiendaId: "t1", tipo: "debito", categoria: "flete", monto: "1000.00", origenTipo: "cierre_dia", origenId: "c1" },
    ];
    const n = await repo.crearMovimientos(
      { walletTiendaMovimiento: prisma.walletTiendaMovimiento } as never,
      movs,
    );

    expect(n).toBe(2);
    const arg = prisma.walletTiendaMovimiento.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    // R2: persiste tienda_id/tipo/categoria/monto/origen; monto es Prisma.Decimal.
    expect(arg.data[0]).toMatchObject({ tiendaId: "t1", tipo: "credito", categoria: "cod_recaudado", origenTipo: "cierre_dia", origenId: "c1" });
    expect(arg.data[0].monto).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data[0].monto.toFixed(2)).toBe("10000.00");
    expect(arg.data[0].descripcion).toBeNull();
    expect(arg.data[0].registradoPor).toBeNull();
  });

  it("lista vacia -> no llama createMany, devuelve 0", async () => {
    const prisma = buildPrisma();
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);
    const n = await repo.crearMovimientos({ walletTiendaMovimiento: prisma.walletTiendaMovimiento } as never, []);
    expect(n).toBe(0);
    expect(prisma.walletTiendaMovimiento.createMany).not.toHaveBeenCalled();
  });
});

describe("WalletTiendaMovimientoRepository.listarPorTienda (R19/R22)", () => {
  it("R19: acota tienda_id SIEMPRE en el WHERE; orderBy fecha desc; pagina", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.findMany.mockResolvedValue([movRow()]);
    prisma.walletTiendaMovimiento.count.mockResolvedValue(1);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    const r = await repo.listarPorTienda({ tiendaId: "t1", page: 2, pageSize: 10 });

    const arg = prisma.walletTiendaMovimiento.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ tiendaId: "t1" });
    expect(arg.orderBy).toEqual({ fechaMovimiento: "desc" });
    expect(arg.skip).toBe(10); // (page-1)*pageSize
    expect(arg.take).toBe(10);
    expect(r.total).toBe(1);
    expect(r.movimientos[0].monto).toBe("10000.00"); // STRING money-safe
    expect(typeof r.movimientos[0].monto).toBe("string");
  });

  it("R22: cierreId -> origen_tipo=cierre_dia + origen_id; categoria y rango de fechas en el WHERE", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.findMany.mockResolvedValue([]);
    prisma.walletTiendaMovimiento.count.mockResolvedValue(0);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    const desde = new Date("2026-07-01T00:00:00.000Z");
    const hasta = new Date("2026-07-31T00:00:00.000Z");
    await repo.listarPorTienda({
      tiendaId: "t1",
      page: 1,
      pageSize: 20,
      cierreId: "c1",
      categoria: "flete",
      desde,
      hasta,
    });

    const arg = prisma.walletTiendaMovimiento.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      tiendaId: "t1",
      categoria: "flete",
      origenTipo: "cierre_dia",
      origenId: "c1",
      fechaMovimiento: { gte: desde, lte: hasta },
    });
  });
});

describe("WalletTiendaMovimientoRepository.agregarSaldoPorTienda (R16/R19)", () => {
  it("R16/R19: groupBy tipo acotado a tienda_id -> creditos/debitos STRING", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([
      { tipo: "credito", _sum: { monto: new Prisma.Decimal("10000.00") } },
      { tipo: "debito", _sum: { monto: new Prisma.Decimal("1452.00") } },
    ]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    const r = await repo.agregarSaldoPorTienda("t1", { categoria: undefined });

    const arg = prisma.walletTiendaMovimiento.groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(["tipo"]);
    expect(arg.where).toEqual({ tiendaId: "t1" }); // R19: acotado en el WHERE
    expect(r).toEqual({ creditos: "10000.00", debitos: "1452.00" });
    expect(typeof r.creditos).toBe("string");
  });

  it("sin movimientos -> creditos/debitos 0.00", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);
    const r = await repo.agregarSaldoPorTienda("t1", {});
    expect(r).toEqual({ creditos: "0.00", debitos: "0.00" });
  });
});

describe("WalletTiendaMovimientoRepository.listarSaldosTodasTiendas (R20)", () => {
  it("una fila por tienda con nombre + totales credito/debito agregados", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([
      { tiendaId: "t1", tipo: "credito", _sum: { monto: new Prisma.Decimal("10000.00") } },
      { tiendaId: "t1", tipo: "debito", _sum: { monto: new Prisma.Decimal("1000.00") } },
      { tiendaId: "t2", tipo: "debito", _sum: { monto: new Prisma.Decimal("452.00") } },
    ]);
    prisma.usuario.findMany.mockResolvedValue([
      { id: "t1", nombre: "Tienda Uno" },
      { id: "t2", nombre: "Tienda Dos" },
    ]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    const rows = await repo.listarSaldosTodasTiendas();

    const byId = Object.fromEntries(rows.map((r) => [r.tiendaId, r]));
    expect(byId.t1).toEqual({ tiendaId: "t1", tiendaNombre: "Tienda Uno", creditos: "10000.00", debitos: "1000.00" });
    // t2 solo debitos -> creditos 0.00 (saldo negativo, lo deriva el service).
    expect(byId.t2).toEqual({ tiendaId: "t2", tiendaNombre: "Tienda Dos", creditos: "0.00", debitos: "452.00" });
    // solo consulta nombres de las tiendas con movimientos.
    expect(prisma.usuario.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["t1", "t2"] } });
  });

  it("sin movimientos -> [] sin consultar usuarios", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);
    const rows = await repo.listarSaldosTodasTiendas();
    expect(rows).toEqual([]);
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });
});

// ── Feature 171 / T1.3 — agregarDesglosePorTienda (R22/R24/R34/R43) ──

describe("WalletTiendaMovimientoRepository.agregarDesglosePorTienda (R24/R34)", () => {
  it("R24: agrupa por (tipo, categoria) con `tiendaId` SIEMPRE en el WHERE", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([
      { tipo: "credito", categoria: "cod_recaudado", _sum: { monto: new Prisma.Decimal("10000.00") } },
      { tipo: "debito", categoria: "flete", _sum: { monto: new Prisma.Decimal("1000.00") } },
    ]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    const rows = await repo.agregarDesglosePorTienda("t1", {});

    const arg = prisma.walletTiendaMovimiento.groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(["tipo", "categoria"]);
    expect(arg.where).toEqual({ tiendaId: "t1" }); // R24: acotado en el WHERE, no en memoria
    expect(arg._sum).toEqual({ monto: true });
    expect(rows).toEqual([
      { tipo: "credito", categoria: "cod_recaudado", total: "10000.00" },
      { tipo: "debito", categoria: "flete", total: "1000.00" },
    ]);
  });

  it("R24: los filtros del desglose van en el MISMO WHERE que el acotado por tienda", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    const desde = new Date("2026-07-01T00:00:00.000Z");
    const hasta = new Date("2026-07-31T00:00:00.000Z");
    await repo.agregarDesglosePorTienda("t1", {
      cierreId: "c1",
      categoria: "iva_flete",
      desde,
      hasta,
    });

    const arg = prisma.walletTiendaMovimiento.groupBy.mock.calls[0][0];
    expect(arg.where).toEqual({
      tiendaId: "t1",
      categoria: "iva_flete",
      origenTipo: "cierre_dia",
      origenId: "c1",
      fechaMovimiento: { gte: desde, lte: hasta },
    });
  });

  it("R34: UNA sola sentencia, sea cual sea el filtro (coste constante por apertura)", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.agregarDesglosePorTienda("t1", { categoria: "flete" });

    expect(prisma.walletTiendaMovimiento.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.walletTiendaMovimiento.findMany).not.toHaveBeenCalled();
    expect(prisma.walletTiendaMovimiento.count).not.toHaveBeenCalled();
    // R35: el desglose NO consulta el nombre de la tienda; baja por props desde la fila.
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });

  it("money-safe: los totales salen como STRING escala 2, tambien con _sum nulo", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([
      { tipo: "credito", categoria: "cod_recaudado", _sum: { monto: new Prisma.Decimal("7") } },
      { tipo: "debito", categoria: "flete", _sum: { monto: null } },
    ]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    const rows = await repo.agregarDesglosePorTienda("t1", {});

    expect(rows[0].total).toBe("7.00");
    expect(rows[1].total).toBe("0.00");
    for (const r of rows) expect(typeof r.total).toBe("string");
  });

  it("R43: una fila `pago_tienda` del ledger llega TAL CUAL, con su categoria real", async () => {
    // Hoy ningun flujo emite `pago_tienda` (lo hara la 172). El repositorio no lo sabe ni le
    // importa: lee lo que hay. Este test siembra la fila que la 172 insertara y comprueba que
    // el repositorio la propaga sin filtrarla ni reclasificarla.
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([
      { tipo: "credito", categoria: "cod_recaudado", _sum: { monto: new Prisma.Decimal("10000.00") } },
      { tipo: "debito", categoria: "flete", _sum: { monto: new Prisma.Decimal("1000.00") } },
      { tipo: "debito", categoria: "pago_tienda", _sum: { monto: new Prisma.Decimal("4000.00") } },
    ]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    const rows = await repo.agregarDesglosePorTienda("t1", {});

    expect(rows).toContainEqual({ tipo: "debito", categoria: "pago_tienda", total: "4000.00" });
    // Y el WHERE no excluye ninguna categoria: si lo hiciera, el pago no llegaria nunca.
    expect(prisma.walletTiendaMovimiento.groupBy.mock.calls[0][0].where).toEqual({ tiendaId: "t1" });
  });

  it("sin movimientos -> [] (la derivacion lo traduce a los cuatro importes en 0.00)", async () => {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([]);
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);
    expect(await repo.agregarDesglosePorTienda("t1", {})).toEqual([]);
  });
});
