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

// ── Feature 184 — Tanda G (R5/R15/R16) — el CONJUNTO del que sale el archivo de «Saldos de
// tiendas» (listado 12 del Anexo A) ──
//
// Aqui no hay metodo de repositorio nuevo, y el que se reusa no es un `findMany`: cada fila es
// una AGREGACION de todo el ledger de esa tienda. Lo que estos casos cierran es el hueco que el
// test de servicio no puede ver, porque alli el repositorio es un doble:
//
//   - que la agregacion del conjunto sea EXACTAMENTE la misma que la de la pagina (R16), y
//   - que el ORDEN por el que sale el archivo lo ponga el repositorio y no el planificador (R5).
//
// El segundo es el defecto que esta tanda corrige: `listarSaldosTodasTiendas` devuelve las filas
// como se las da el `groupBy`, y el archivo salia asi. La 170 declaro esa divergencia como
// desviacion consciente porque ese conjunto no sostenia ningun archivo; desde esta tanda si.

describe("WalletTiendaMovimientoRepository — el conjunto del archivo (feature 184, T G.1)", () => {
  /** Cinco tiendas con nombres DISTINTOS y en desorden: es lo unico que hace visible el orden. */
  function prismaConCincoTiendas() {
    const prisma = buildPrisma();
    prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([
      { tiendaId: "t-3", tipo: "credito", _sum: { monto: new Prisma.Decimal("1000.00") } },
      { tiendaId: "t-1", tipo: "credito", _sum: { monto: new Prisma.Decimal("500.00") } },
      { tiendaId: "t-5", tipo: "debito", _sum: { monto: new Prisma.Decimal("80.00") } },
      { tiendaId: "t-2", tipo: "credito", _sum: { monto: new Prisma.Decimal("300.00") } },
      { tiendaId: "t-4", tipo: "credito", _sum: { monto: new Prisma.Decimal("10.00") } },
    ]);
    prisma.usuario.findMany.mockResolvedValue([
      { id: "t-1", nombre: "Ana" },
      { id: "t-2", nombre: "Beto" },
      { id: "t-3", nombre: "Carlos" },
      { id: "t-4", nombre: "Dora" },
      { id: "t-5", nombre: "Elena" },
    ]);
    return prisma;
  }

  it("el conjunto del archivo y la pagina salen de la MISMA agregacion, sin where ni recorte (R15/R16)", async () => {
    const conjunto = prismaConCincoTiendas();
    await new WalletTiendaMovimientoRepository(
      conjunto as unknown as PrismaClient,
    ).listarSaldosTiendasPaginado({ skip: 0, take: 5001 }); // el conjunto: tope + 1

    const pagina = prismaConCincoTiendas();
    await new WalletTiendaMovimientoRepository(
      pagina as unknown as PrismaClient,
    ).listarSaldosTiendasPaginado({ skip: 2, take: 2 }); // una pagina cualquiera

    const argsConjunto = conjunto.walletTiendaMovimiento.groupBy.mock.calls[0][0];
    const argsPagina = pagina.walletTiendaMovimiento.groupBy.mock.calls[0][0];

    // La agregacion es la MISMA, literalmente: si divergieran, el archivo sumaria un ledger y la
    // tabla otro, y las dos cifras pasarian por buenas.
    expect(argsConjunto).toEqual(argsPagina);
    expect(argsConjunto.by).toEqual(["tiendaId", "tipo"]);
    expect(argsConjunto._sum).toEqual({ monto: true });
    // Sin `where`: este listado no acota nada —quien lo ve lo decide el ROL, en el servicio— y
    // un `where` aqui recortaria el conjunto del archivo sin que ninguna pantalla lo dijera.
    expect(argsConjunto.where).toBeUndefined();
    // El recorte NO viaja a la base: no puede, porque el saldo de una tienda no se calcula con
    // una pagina de movimientos. Lo que se recorta es el resultado ya agregado (R15).
    expect(argsConjunto.skip).toBeUndefined();
    expect(argsConjunto.take).toBeUndefined();

    // Y son DOS consultas en los dos caminos: la agregacion y los nombres. Ni una mas.
    for (const [nombre, p] of [["conjunto", conjunto], ["pagina", pagina]] as const) {
      expect(p.walletTiendaMovimiento.groupBy, nombre).toHaveBeenCalledTimes(1);
      expect(p.usuario.findMany, nombre).toHaveBeenCalledTimes(1);
      expect(p.walletTiendaMovimiento.findMany, nombre).not.toHaveBeenCalled();
      expect(p.walletTiendaMovimiento.count, nombre).not.toHaveBeenCalled();
    }
  });

  it("el conjunto sale ORDENADO por nombre y la pagina es su segmento exacto (R5)", async () => {
    const repoConjunto = new WalletTiendaMovimientoRepository(
      prismaConCincoTiendas() as unknown as PrismaClient,
    );
    const { items, total } = await repoConjunto.listarSaldosTiendasPaginado({ skip: 0, take: 5001 });

    // El `groupBy` las devolvio en otro orden (Carlos, Ana, Elena, Beto, Dora): si el conjunto
    // saliera como llega —que es lo que hacia `listarSaldosTodasTiendas`— este caso se pone rojo.
    expect(items.map((r) => r.tiendaNombre)).toEqual(["Ana", "Beto", "Carlos", "Dora", "Elena"]);
    expect(total).toBe(5);

    // Y la pagina N es el segmento N de ese mismo conjunto, en el mismo orden.
    const recorrido: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const repoPagina = new WalletTiendaMovimientoRepository(
        prismaConCincoTiendas() as unknown as PrismaClient,
      );
      const p = await repoPagina.listarSaldosTiendasPaginado({ skip: (page - 1) * 2, take: 2 });
      recorrido.push(...p.items.map((r) => r.tiendaNombre));
      expect(p.total).toBe(5); // R41: el del CONJUNTO, no el de la pagina
    }
    expect(recorrido).toEqual(items.map((r) => r.tiendaNombre));
  });

  it("dos tiendas con el MISMO nombre no se solapan entre paginas: el orden es TOTAL (R5)", async () => {
    // Sin desempate por id el orden no seria total, y una de las dos podria aparecer en dos
    // paginas del archivo (o en ninguna).
    function prismaHomonimas() {
      const prisma = buildPrisma();
      prisma.walletTiendaMovimiento.groupBy.mockResolvedValue([
        { tiendaId: "t-b", tipo: "credito", _sum: { monto: new Prisma.Decimal("2.00") } },
        { tiendaId: "t-a", tipo: "credito", _sum: { monto: new Prisma.Decimal("1.00") } },
        { tiendaId: "t-c", tipo: "credito", _sum: { monto: new Prisma.Decimal("3.00") } },
      ]);
      prisma.usuario.findMany.mockResolvedValue([
        { id: "t-a", nombre: "Repetida" },
        { id: "t-b", nombre: "Repetida" },
        { id: "t-c", nombre: "Zeta" },
      ]);
      return prisma;
    }

    const conjunto = await new WalletTiendaMovimientoRepository(
      prismaHomonimas() as unknown as PrismaClient,
    ).listarSaldosTiendasPaginado({ skip: 0, take: 5001 });
    expect(conjunto.items.map((r) => r.tiendaId)).toEqual(["t-a", "t-b", "t-c"]);

    const recorrido: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const p = await new WalletTiendaMovimientoRepository(
        prismaHomonimas() as unknown as PrismaClient,
      ).listarSaldosTiendasPaginado({ skip: page - 1, take: 1 });
      recorrido.push(...p.items.map((r) => r.tiendaId));
    }
    expect(recorrido).toEqual(["t-a", "t-b", "t-c"]);
    expect(new Set(recorrido).size).toBe(3);
  });
});
