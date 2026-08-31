import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";
import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";

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

  // Ficha 334 (T B.1, design §5) — el `id` generado ARRIBA, con la MISMA forma opcional que
  // `fechaMovimiento`: es lo que permite releer EXACTAMENTE la fila recien creada sin abrir un
  // metodo nuevo en el repositorio ni partir el `createMany` en dos.
  it("R28: cuando el llamador NO pasa id, la clave NO viaja (manda el @default(uuid()) de la columna)", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 1 });
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(prisma as never, [
      { tipo: "ingreso", categoria: "ingreso_flete", monto: "1.00", origenTipo: "cierre_dia", origenId: "c1" },
    ]);

    const arg = prisma.walletMovimiento.createMany.mock.calls[0][0];
    expect(Object.keys(arg.data[0])).not.toContain("id");
  });

  it("R28: cuando el llamador SI pasa id, viaja tal cual a la insercion", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 1 });
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(prisma as never, [
      {
        id: "11111111-1111-4111-8111-111111111111",
        tipo: "egreso",
        categoria: "egreso_gasto_variable",
        monto: "300.00",
        origenTipo: "gasto",
        origenId: null,
        descripcion: "Papeleria",
        registradoPor: "u-maestro",
      },
    ]);

    const arg = prisma.walletMovimiento.createMany.mock.calls[0][0];
    expect(arg.data[0].id).toBe("11111111-1111-4111-8111-111111111111");
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
    // Ficha 334 (R26, design §4): el orden es TOTAL. Este literal ES el contrato del libro —se
    // reescribe entero con el array nuevo, NO se relaja a `expect.anything()` ni se deriva de
    // la propia fuente—: es lo unico que impide que alguien vuelva a una sola columna y
    // reintroduzca la paginacion que repite u omite filas.
    expect(arg.orderBy).toEqual([
      { fechaMovimiento: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(arg.skip).toBe(20); // (page 2 - 1) * 20
    expect(arg.take).toBe(20);
  });

  // Ficha 334 (R26) — el desempate, dicho aparte de la consulta de filtros para que un fallo
  // nombre la propiedad que se rompio.
  it("R26: el orden del libro desempata por creacion y por id — orden TOTAL, no solo por fecha", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.findMany.mockResolvedValue([]);
    prisma.walletMovimiento.count.mockResolvedValue(0);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.listar({ page: 1, pageSize: 20 });

    const { orderBy } = prisma.walletMovimiento.findMany.mock.calls[0][0];
    // Es una LISTA, no un objeto: con `{ fechaMovimiento: "desc" }` a secas, dos filas con el
    // mismo instante quedan en orden indefinido y `skip`/`take` puede devolver la misma fila en
    // dos paginas o ninguna. Ya podia pasar con dos pagos a tienda del mismo dia.
    expect(Array.isArray(orderBy)).toBe(true);
    expect(orderBy.map((o: Record<string, string>) => Object.keys(o)[0])).toEqual([
      "fechaMovimiento",
      "createdAt",
      "id",
    ]);
    // Y las tres van en el MISMO sentido: un desempate ascendente pondria la fila mas vieja
    // primero dentro de su dia, que no es lo que el libro promete.
    for (const criterio of orderBy) expect(Object.values(criterio)).toEqual(["desc"]);
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
      // Feature 231 (R31): el dueño lo pone el SERVIDOR, en el unico punto de proyeccion.
      dueno: "propio",
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

  it("R47: la superficie del repositorio son SEIS metodos — ni update, ni delete, ni el viejo", () => {
    const metodos = Object.getOwnPropertyNames(WalletMovimientoRepository.prototype)
      .filter((m) => m !== "constructor")
      .sort();

    // El libro es APPEND-ONLY: una correccion es un movimiento compensatorio, no una edicion.
    // Se afirma sobre la lista COMPLETA y CERRADA, no con cuatro `toBeUndefined()`: asi caen
    // igual un `actualizarMonto` futuro (que no se llama «update») y el agregado por `tipo` a
    // secas si alguien lo resucitara.
    // Ficha 333 (C2): entra `obtenerPorOrigen`, y es una LECTURA por la clave
    // `(origen_tipo, origen_id, categoria)`. El libro no gana ninguna mutacion: la asercion de
    // abajo lo sigue afirmando, y esta lista sigue siendo CERRADA.
    expect(metodos).toEqual([
      "agregarPorCategoria",
      "agregarPorCategoriaYTipo",
      "crearMovimientos",
      "listar",
      "obtenerPorId",
      "obtenerPorOrigen",
    ]);
    expect(metodos.some((m) => /update|delete|actualizar|eliminar|borrar/i.test(m))).toBe(false);
  });
});


// ── Feature 231 (T2.1/T2.4, design §3.3) — la columna «Dueño» nace en `toDTO` ──
//
// `dueno` no es una regla de negocio nueva: es una busqueda TOTAL en `NATURALEZA_POR_CATEGORIA`
// durante la proyeccion a DTO. Vive en `toDTO` —y no en el servicio— porque por ahi pasan los
// CUATRO consumidores del DTO (listado paginado, descarga completa, `obtenerPorId` y el egreso
// recien creado): mapear en el servicio significaria repetir el `map` en cada uno y abrir la
// puerta a que la tabla y el archivo digan cosas distintas.

describe("dueno en el DTO (R31/R32)", () => {
  /** Un `walletMovimiento` de la base con la categoria que se pida. */
  function filaDeLaBase(categoria: string) {
    return {
      id: `w-${categoria}`,
      tipo: categoria.startsWith("ingreso_") ? "ingreso" : "egreso",
      categoria,
      monto: new Prisma.Decimal("10.00"),
      origenTipo: "manual",
      origenId: null,
      descripcion: null,
      registradoPor: null,
      fechaMovimiento: new Date("2026-07-12T10:00:00.000Z"),
      createdAt: new Date("2026-07-12T10:00:00.000Z"),
    };
  }

  it("R31/R32: cada categoria del SEED produce su `dueno`", async () => {
    // Se recorre el catalogo ENTERO en runtime, no tres categorias elegidas a mano: el dia que
    // el enum gane un valor, este caso lo mide sin que nadie lo amplie. Y la respuesta esperada
    // sale de `NATURALEZA_POR_CATEGORIA`, que es la unica clasificacion del arbol (R32) — si el
    // repositorio se inventara la suya, los dos dejarian de coincidir aqui.
    const prisma = buildPrisma();
    prisma.walletMovimiento.findMany.mockResolvedValue(
      WALLET_MOVIMIENTO_CATEGORIA_SEED.map(filaDeLaBase),
    );
    prisma.walletMovimiento.count.mockResolvedValue(WALLET_MOVIMIENTO_CATEGORIA_SEED.length);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const { movimientos } = await repo.listar({ page: 1, pageSize: 100 });

    // CONTROL DE NO-VACUIDAD: se han proyectado TODAS las filas, y el catalogo no esta vacio.
    expect(movimientos).toHaveLength(WALLET_MOVIMIENTO_CATEGORIA_SEED.length);
    expect(movimientos.length).toBeGreaterThan(10);

    for (const m of movimientos) {
      expect(m.dueno, m.categoria).toBe(NATURALEZA_POR_CATEGORIA[m.categoria]);
    }
    // Y las DOS naturalezas aparecen de verdad: un `dueno` fijado a "propio" pasaria el bucle
    // de arriba en casi todo el catalogo, pero no esta afirmacion.
    expect(new Set(movimientos.map((m) => m.dueno))).toEqual(new Set(["propio", "terceros"]));
    // Nombradas, para que el fallo diga cual: el contra-entrega y el pago a tienda son de las
    // tiendas; el flete y el sueldo, de Ordenex.
    const duenoDe = (categoria: string) =>
      movimientos.find((m) => m.categoria === categoria)?.dueno;
    expect(duenoDe("ingreso_cod_recaudado")).toBe("terceros");
    expect(duenoDe("egreso_pago_tienda")).toBe("terceros");
    expect(duenoDe("ingreso_reverso_pago_tienda")).toBe("terceros");
    expect(duenoDe("ingreso_flete")).toBe("propio");
    expect(duenoDe("egreso_sueldo")).toBe("propio");
    expect(duenoDe("egreso_pago_mensajero")).toBe("propio"); // devengo, no tesoreria
  });

  it("R31: `obtenerPorId` dice EXACTAMENTE lo mismo que el listado (un solo punto de proyeccion)", async () => {
    // Es la razon de que `dueno` se asigne en `toDTO` y no en el servicio: la tabla, la descarga
    // y la lectura por id no pueden divergir porque salen de la misma funcion.
    const fila = filaDeLaBase("ingreso_cod_recaudado");
    const prisma = {
      walletMovimiento: {
        findUnique: vi.fn().mockResolvedValue(fila),
        findMany: vi.fn().mockResolvedValue([fila]),
        count: vi.fn().mockResolvedValue(1),
      },
    };
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const porId = await repo.obtenerPorId("w-ingreso_cod_recaudado");
    const { movimientos } = await repo.listar({ page: 1, pageSize: 20 });

    expect(porId?.dueno).toBe("terceros");
    expect(porId).toEqual(movimientos[0]);
  });

  it("R31: el agregado por (categoria, tipo) NO gana el dueño — la particion la hace la derivacion", async () => {
    // `agregarPorCategoriaYTipo` se queda como estaba: el repositorio agrega y devuelve filas;
    // quien parte por naturaleza es `derivarCaja`, que es pura. Si el dueño se colara tambien
    // aqui habria DOS sitios diciendo de quien es el dinero.
    const prisma = buildPrisma();
    prisma.walletMovimiento.groupBy.mockResolvedValue([
      { categoria: "ingreso_cod_recaudado", tipo: "ingreso", _sum: { monto: new Prisma.Decimal("5.00") } },
    ]);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const filas = await repo.agregarPorCategoriaYTipo({});
    expect(filas).toEqual([
      { categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "5.00" },
    ]);
    expect(Object.keys(filas[0])).toEqual(["categoria", "tipo", "total"]);
  });
});
