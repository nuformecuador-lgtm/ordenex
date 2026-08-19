import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

// Feature 42/T9 — idempotencia + no-doble-conteo (R6/R13). Simula el constraint unico
// parcial (origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL con una tienda
// en memoria: createMany({ skipDuplicates: true }) NO reinserta pares ya presentes. Con eso
// demostramos que una DOBLE aprobacion del mismo cierre produce UN SOLO set de movimientos y
// que un reintento por par existente es un no-op (sin error, sin segundo movimiento).

// Store en memoria con la semantica del indice unico parcial (solo pares con origen_id).
function makeWalletStore() {
  const rows: Array<CrearMovimientoInput & { id: string }> = [];
  const key = (r: { origenTipo: string; origenId: string | null; categoria: string }) =>
    `${r.origenTipo}|${r.origenId}|${r.categoria}`;
  const seen = new Set<string>();
  let seq = 0;

  const walletMovimiento = {
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: CrearMovimientoInput[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const d of data) {
        // El indice unico parcial solo aplica cuando origen_id IS NOT NULL.
        if (d.origenId !== null) {
          const k = key(d);
          if (seen.has(k)) {
            if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
            throw new Error(`unique violation ${k}`);
          }
          seen.add(k);
        }
        rows.push({ ...d, id: `w${++seq}` });
        count += 1;
      }
      return { count };
    }),
  };
  return { rows, walletMovimiento };
}

// Store en memoria de `orden` para el updateMany POR RELACION que la rama `aprobado` corre
// desde el pedido humano del 2026-08-18: enciende `gestion_aprobada` en las ordenes cuya
// gestion de ESTE cierre fue `devuelta` (es la puerta que `OrdenRepository.novedadWhere` exige
// para listarlas en /novedades).
//
// POR QUE NO ES UN `vi.fn()` QUE DEVUELVE `{count: 0}`. Un doble mudo tapa el TypeError y deja
// la escritura sin nadie que la mire — que es exactamente el agujero que hay hoy: las dos
// suites que si tenian delegado (`cierres-admin-repository`, `…resolverCierre.devolucion`)
// FILTRAN esta llamada fuera (`.filter(c => c.where.id !== undefined)`) porque miden otra cosa.
// Este store honra el `where` como lo haria Postgres, asi que el `cierreId` del WHERE se
// comporta como la GUARDIA que dice ser: una gestion `devuelta` de OTRO cierre queda fuera.
function makeOrdenStore() {
  const ordenes = [
    { id: "o1", gestionAprobada: false, gestiones: [{ cierreId: "c1", resultado: "entregada" }] },
    { id: "o2", gestionAprobada: false, gestiones: [{ cierreId: "c1", resultado: "devuelta" }] },
    // La testigo: MISMO resultado `devuelta`, OTRO cierre. Solo el `cierreId` la separa, asi
    // que si la guardia desapareciera del WHERE, esta fila se encenderia sola.
    { id: "o3", gestionAprobada: false, gestiones: [{ cierreId: "c2", resultado: "devuelta" }] },
  ];
  type WhereRelacion = {
    gestiones?: { some?: { cierreId?: string; resultado?: string } };
  };
  const orden = {
    updateMany: vi.fn(
      async ({ where, data }: { where: WhereRelacion; data: Record<string, unknown> }) => {
        const some = where.gestiones?.some ?? {};
        let count = 0;
        for (const o of ordenes) {
          const casa = o.gestiones.some(
            (g) =>
              (some.cierreId === undefined || g.cierreId === some.cierreId) &&
              (some.resultado === undefined || g.resultado === some.resultado),
          );
          if (!casa) continue;
          Object.assign(o, data);
          count += 1;
        }
        return { count };
      },
    ),
  };
  return { ordenes, orden };
}

const TARIFA = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

// Feature 69: la misma tarifa, ya CONGELADA en la fila de `cierre_detail`.
const TARIFA_CONGELADA = {
  tarifaId: "ta1",
  tarifaValorFlete: new Prisma.Decimal(TARIFA.valorFlete),
  tarifaValorFleteGam: new Prisma.Decimal(TARIFA.valorFleteGam),
  tarifaValorFleteDevuelto: new Prisma.Decimal(TARIFA.valorFleteDevuelto),
  tarifaValorFleteDevueltoGam: new Prisma.Decimal(TARIFA.valorFleteDevueltoGam),
  tarifaComisionCod: new Prisma.Decimal(TARIFA.comisionCod),
  tarifaIvaFlete: new Prisma.Decimal(TARIFA.ivaFlete),
  tarifaIvaComisionCod: new Prisma.Decimal(TARIFA.ivaComisionCod),
};

// Prisma doble: gestiones del cierre + su detalle CONGELADO + la tienda de wallet +
// $transaction (tx === prisma). Feature 69: el feed deriva del snapshot, asi que el doble
// aporta `cierreDetail`; los importes (y por tanto los 6 conceptos) no cambian.
function buildPrisma(
  store: ReturnType<typeof makeWalletStore>,
  ordenStore: ReturnType<typeof makeOrdenStore> = makeOrdenStore(),
) {
  const gestiones = [
    { ordenId: "o1", resultado: "entregada" },
    { ordenId: "o2", resultado: "devuelta" },
  ];
  const detalle = [
    { ordenId: "o1", tiendaId: "t1", montoCobrar: new Prisma.Decimal("10000.00"), cobraComision: true, esCentral: false, ...TARIFA_CONGELADA },
    { ordenId: "o2", tiendaId: "t1", montoCobrar: null, cobraComision: true, esCentral: false, ...TARIFA_CONGELADA },
  ];
  const prisma = {
    cierreDia: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(1) },
    gestionOrden: { findMany: vi.fn().mockResolvedValue(gestiones) },
    cierreDetail: { findMany: vi.fn().mockResolvedValue(detalle) },
    walletMovimiento: store.walletMovimiento,
    orden: ordenStore.orden,
  };
  return {
    ...prisma,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
}

const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

/**
 * El repositorio bajo prueba con los dobles de las features vecinas. Extraido (era el cuerpo del
 * caso R6) para que el caso de `gestion_aprobada` de mas abajo monte EXACTAMENTE la misma
 * transaccion: si cada uno armara la suya, podrian dejar de medir el mismo camino sin que nada
 * lo delate.
 */
function makeRepo(prisma: ReturnType<typeof buildPrisma>) {
  return new CierresAdminRepository(
      prisma as unknown as PrismaClient,
      new WalletMovimientoRepository(prisma as unknown as PrismaClient),
      new WalletFeedService(),
      // Feature 43: dobles no-op del ledger por tienda (este test cubre SOLO la idempotencia
      // de la caja principal 42; el ledger por tienda tiene su propio test de idempotencia).
      { crearMovimientos: vi.fn().mockResolvedValue(0), listarPorTienda: vi.fn(), agregarSaldoPorTienda: vi.fn(), listarSaldosTodasTiendas: vi.fn(), listarSaldosTiendasPaginado: vi.fn(), agregarDesglosePorTienda: vi.fn() },
      { construirMovimientosPorTienda: vi.fn().mockResolvedValue([]) },
      // Feature 44: dobles no-op del libro del pago por mensajero (feed devuelve libro/egreso
      // vacios; el pago por mensajero tiene su propio test de idempotencia).
      { crearMovimientos: vi.fn().mockResolvedValue(0), listarPorMensajero: vi.fn(), agregarCuentaPorPagar: vi.fn(), listarCuentasPorPagarTodos: vi.fn(), listarCuentasPorPagarPaginado: vi.fn(), listarCuentasPorPagarCompleto: vi.fn(), obtenerNombreMensajero: vi.fn() },
      { construirMovimientosDePago: vi.fn().mockResolvedValue({ libro: [], egresoCaja: [] }) },
      // Feature 158/T1.14: doble del feed del egreso de indemnizacion. Este caso cubre la
      // idempotencia de los conceptos de INGRESO; la del egreso de indemnizacion tiene su
      // propio caso mas abajo, con el feed REAL.
      { construirEgresoIndemnizacion: vi.fn(async () => []) },
  );
}

describe("wallet idempotencia (R6/R13)", () => {
  it("R6: doble aprobacion del mismo cierre -> UN SOLO set de movimientos (skipDuplicates)", async () => {
    const store = makeWalletStore();
    const prisma = buildPrisma(store);
    const repo = makeRepo(prisma);

    const aprobar = () =>
      repo.resolverCierre({
        cierreId: "c1",
        alcance: ALCANCE,
        nuevoEstado: "aprobado",
        resueltoPor: "adm",
        motivoRechazo: null,
      });

    await aprobar();
    const trasPrimera = store.rows.length;
    await aprobar(); // segunda aprobacion: el constraint deduplica todos los pares.

    // El set de movimientos es EXACTAMENTE el mismo (no se duplico ningun concepto).
    expect(store.rows.length).toBe(trasPrimera);
    // Cada par (cierre_dia, c1, categoria) aparece una sola vez.
    const claves = store.rows.map((r) => `${r.origenTipo}|${r.origenId}|${r.categoria}`);
    expect(new Set(claves).size).toBe(claves.length);
    // El cierre solo-entregada+devuelta produce: flete, iva_flete, comision, iva_comision,
    // flete_devolucion, iva_flete_devolucion (6 conceptos, ninguno duplicado).
    expect(store.rows.length).toBe(6);
  });

  // Pedido humano 2026-08-18 — LA ESCRITURA QUE NADIE MIRABA. Aprobar el cierre enciende
  // `orden.gestion_aprobada` en las devoluciones de ESE cierre, y lo hace DENTRO de la misma
  // transaccion que mueve los cinco feeds de dinero. Es money-neutral, pero gobierna lo que la
  // tienda ve en /novedades, y hasta aqui no tenia ni una asercion: las dos suites que la
  // ejecutaban la filtran fuera a proposito (`.filter(c => c.where.id !== undefined)`) porque
  // miden los updateMany por ids de la liberacion y de la devolucion, no este.
  //
  // Va en ESTE archivo, y no en uno nuevo, por lo que mide: que la SEGUNDA aprobacion no
  // estropea lo que dejo la primera. Es el mismo enunciado que R6 —doble aprobacion, un solo
  // efecto— aplicado a la unica escritura de la tx que no pasa por el indice unico de la
  // wallet y que, por tanto, no queda protegida por `skipDuplicates` sino por ser idempotente.
  it("R6: aprobar enciende `gestion_aprobada` SOLO en las devoluciones de ESTE cierre, y re-aprobar no cambia nada", async () => {
    const store = makeWalletStore();
    const ordenStore = makeOrdenStore();
    const prisma = buildPrisma(store, ordenStore);
    const repo = makeRepo(prisma);

    const aprobar = () =>
      repo.resolverCierre({
        cierreId: "c1",
        alcance: ALCANCE,
        nuevoEstado: "aprobado",
        resueltoPor: "adm",
        motivoRechazo: null,
      });

    await aprobar();

    const estado = () =>
      Object.fromEntries(ordenStore.ordenes.map((o) => [o.id, o.gestionAprobada]));
    // o2 es la unica `devuelta` de c1. o1 entrego (no es novedad) y o3 se devolvio en OTRO
    // cierre: mientras ese cierre no se apruebe, su tienda no la ve.
    expect(estado()).toEqual({ o1: false, o2: true, o3: false });

    // El WHERE tal cual sale del repositorio: `cierreId` es GUARDIA, no filtro cosmetico, y
    // `resultado` acota a las devoluciones. Se mira el argumento porque es lo que separa
    // "escribio en las filas correctas por casualidad" de "pidio exactamente esas filas".
    expect(prisma.orden.updateMany).toHaveBeenCalledWith({
      where: { gestiones: { some: { cierreId: "c1", resultado: "devuelta" } } },
      data: { gestionAprobada: true },
    });

    await aprobar(); // segunda aprobacion del MISMO cierre
    // Idempotente: encuentra las filas ya en `true` y no mueve ninguna otra.
    expect(estado()).toEqual({ o1: false, o2: true, o3: false });
  });

  it("R13: reintento por par existente = no-op (sin error propagado, sin segundo movimiento)", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({ walletMovimiento: store.walletMovimiento } as unknown as PrismaClient);
    const mov: CrearMovimientoInput = {
      tipo: "ingreso",
      categoria: "ingreso_flete",
      monto: "1000.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
    };

    const n1 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [mov]);
    // Reintento del MISMO par: no lanza, no inserta.
    const n2 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [mov]);

    expect(n1).toBe(1);
    expect(n2).toBe(0); // no-op
    expect(store.rows.length).toBe(1);
  });

  // Feature 158 — EXTENSION A LOS DOS ORIGENES (design §12.5, R29/R53/R56/R64). Hasta el PR 1
  // este archivo solo conocia el egreso del cierre. El camino del ADMIN anade un segundo emisor
  // con `origen_tipo = orden_incidente`, y lo que hay que fijar es doble: que cada uno es
  // idempotente POR SU CUENTA y que los dos COEXISTEN sin que el indice unico parcial se trague
  // uno (mismo `categoria`, distinto `origen_tipo`/`origen_id`).
  it("158/R53: el egreso del INCIDENTE del admin es idempotente por (orden_incidente, id)", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({
      walletMovimiento: store.walletMovimiento,
    } as unknown as PrismaClient);
    const egreso: CrearMovimientoInput = {
      tipo: "egreso",
      categoria: "egreso_indemnizacion",
      monto: "2500.00",
      origenTipo: "orden_incidente",
      origenId: "inc-1",
    };

    const n1 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [
      egreso,
    ]);
    // Reintentar la aprobacion del MISMO incidente: no lanza, no inserta (R53).
    const n2 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [
      egreso,
    ]);

    expect(n1).toBe(1);
    expect(n2).toBe(0);
    expect(store.rows).toHaveLength(1);
    // El reintento NO altera el ya emitido. (El repo convierte STRING -> Decimal al escribir,
    // asi que la fila guardada trae un Decimal: se compara con escala 2 explicita.)
    expect(new Prisma.Decimal(store.rows[0].monto).toFixed(2)).toBe("2500.00");
  });

  it("158/R29/R64: los DOS egresos de indemnizacion coexisten (ninguno absorbe al otro)", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({
      walletMovimiento: store.walletMovimiento,
    } as unknown as PrismaClient);
    const tx = { walletMovimiento: store.walletMovimiento } as never;

    // Camino del MENSAJERO (agregado por cierre) y camino del ADMIN (por incidente).
    await repo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_indemnizacion",
        monto: "1000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
      },
    ]);
    await repo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_indemnizacion",
        monto: "2500.00",
        origenTipo: "orden_incidente",
        origenId: "inc-1",
      },
    ]);

    // DOS filas: misma categoria, origenes distintos -> claves distintas del indice parcial.
    expect(store.rows).toHaveLength(2);
    expect(store.rows.map((r) => r.origenTipo).sort()).toEqual(["cierre_dia", "orden_incidente"]);
    const claves = store.rows.map((r) => `${r.origenTipo}|${r.origenId}|${r.categoria}`);
    expect(new Set(claves).size).toBe(2);
    // Y cada uno conserva SU monto: ninguno reemplaza, absorbe ni anula al otro (R64).
    expect(store.rows.map((r) => new Prisma.Decimal(r.monto).toFixed(2)).sort()).toEqual([
      "1000.00",
      "2500.00",
    ]);
  });

  it("158/R56: dos incidentes de admin DISTINTOS no se deduplican entre si", async () => {
    // El grano del camino del admin es el incidente, no la orden: dos incidentes (de ordenes
    // distintas, o el mismo caso re-reportado tras un rechazo) son movimientos distintos. Lo que
    // impide pagar DOS VECES la misma orden no es este indice, es el indice unico parcial de
    // `orden_incidente` (a lo sumo uno vivo) + que un `rechazado` nunca persistio monto.
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({
      walletMovimiento: store.walletMovimiento,
    } as unknown as PrismaClient);
    const tx = { walletMovimiento: store.walletMovimiento } as never;
    const egreso = (origenId: string, monto: string): CrearMovimientoInput => ({
      tipo: "egreso",
      categoria: "egreso_indemnizacion",
      monto,
      origenTipo: "orden_incidente",
      origenId,
    });

    await repo.crearMovimientos(tx, [egreso("inc-1", "10.00")]);
    await repo.crearMovimientos(tx, [egreso("inc-2", "20.00")]);

    expect(store.rows).toHaveLength(2);
  });

  it("manuales (origen_id NULL) NO se deduplican: cada ajuste es una fila nueva", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({ walletMovimiento: store.walletMovimiento } as unknown as PrismaClient);
    const manual: CrearMovimientoInput = {
      tipo: "egreso",
      categoria: "egreso_ajuste",
      monto: "50.00",
      origenTipo: "manual",
      origenId: null,
      descripcion: "ajuste",
      registradoPor: "u-maestro",
    };
    await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [manual]);
    await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [manual]);
    // Dos ajustes iguales -> DOS filas (fuera del indice unico parcial).
    expect(store.rows.length).toBe(2);
  });
});
