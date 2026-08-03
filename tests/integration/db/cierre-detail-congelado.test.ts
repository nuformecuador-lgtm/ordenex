import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";

// Feature 69/R17/R18 — EL CORAZON DE LA FEATURE. Los dos casos son money-critical.
//
// La propiedad que se prueba: entre SOLICITAR y APROBAR un cierre, el mundo puede cambiar
// (se edita la orden; se borra la tarifa y se crea otra). El cierre debe liquidar con lo que
// habia AL SOLICITAR. Antes de esta feature los feeds leian `orden`/`zona`/`tarifas` VIVAS
// dentro de la tx de aprobacion y escribian a libros APPEND-ONLY: el descuadre quedaba
// grabado en piedra, en silencio, y solo se corregia a mano con ajuste_credito/ajuste_debito.
//
// Patron `wallet-idempotencia.test.ts`: NO hay Postgres en la suite (verificado), asi que se
// usa una "base" en memoria con la semantica de los constraints. La clave del montaje es que
// `gestionOrden.findMany` resuelve la relacion `orden` contra las filas VIVAS en el momento
// de la llamada — igual que un JOIN real. Por eso, si un lector volviera a mirar datos vivos,
// estos tests se pondrian rojos: es exactamente la regresion que vigilan.

const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

// --- La "base" en memoria -----------------------------------------------------------------

interface OrdenRow {
  id: string;
  montoCobrar: Prisma.Decimal | null;
  cobraComision: boolean;
  zonaId: string;
  tiendaId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  direccion: string | null;
  producto: string;
}
interface TarifaRow {
  id: string;
  tiendaId: string;
  valorFlete: Prisma.Decimal;
  valorFleteGam: Prisma.Decimal;
  valorFleteDevuelto: Prisma.Decimal;
  valorFleteDevueltoGam: Prisma.Decimal;
  comisionCod: Prisma.Decimal;
  ivaFlete: Prisma.Decimal;
  ivaComisionCod: Prisma.Decimal;
  deletedAt: Date | null;
  createdAt: Date;
  status: string;
}
interface GestionRow {
  id: string;
  ordenId: string;
  mensajeroId: string;
  resultado: string;
  montoRecibido: Prisma.Decimal | null;
  cierreId: string | null;
  anuladaAt: Date | null;
}

function dec(v: string) {
  return new Prisma.Decimal(v);
}

function makeDb() {
  const zonas: Record<string, { nombre: string; esCentral: boolean }> = {
    z1: { nombre: "Cartago", esCentral: false },
  };
  const usuarios: Record<string, { nombre: string }> = {
    t1: { nombre: "Tienda Original" },
    t2: { nombre: "Tienda Nueva" },
  };
  const ordenes: OrdenRow[] = [
    {
      id: "o1",
      montoCobrar: dec("10000.00"),
      cobraComision: true,
      zonaId: "z1",
      tiendaId: "t1",
      numGuia: 1,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
    },
  ];
  const tarifas: TarifaRow[] = [
    {
      id: "ta1",
      tiendaId: "t1",
      valorFlete: dec("1000.00"),
      valorFleteGam: dec("1500.00"),
      valorFleteDevuelto: dec("400.00"),
      valorFleteDevueltoGam: dec("600.00"),
      comisionCod: dec("5.00"),
      ivaFlete: dec("13.00"),
      ivaComisionCod: dec("13.00"),
      deletedAt: null,
      createdAt: new Date("2026-07-01"),
      status: "activo",
    },
  ];
  const gestiones: GestionRow[] = [
    {
      id: "g1",
      ordenId: "o1",
      mensajeroId: "m1",
      resultado: "entregada",
      montoRecibido: dec("10000.00"),
      cierreId: null,
      anuladaAt: null,
    },
  ];
  const cierres: Array<Record<string, unknown>> = [];
  const detalle: Array<Record<string, unknown>> = [];
  const movs: Array<CrearMovimientoInput & { id: string }> = [];
  const movsTienda: Array<CrearMovimientoTiendaInput & { id: string }> = [];
  let seq = 0;

  // Resuelve la relacion `orden` (y sus anidados) contra las filas VIVAS, como un JOIN real.
  // Este es el nucleo del test: si un lector mira aqui en vez del snapshot, ve lo MUTADO.
  const joinOrden = (o: OrdenRow) => ({
    ...o,
    zona: { nombre: zonas[o.zonaId].nombre, esCentral: zonas[o.zonaId].esCentral },
    tienda: { nombre: usuarios[o.tiendaId].nombre },
    provincia: { nombre: "Cartago" },
    canton: { nombre: "Central" },
    distrito: { nombre: "Oriental" },
  });

  const client = {
    cierreDia: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: `c${++seq}`, estado: data.estado ?? "solicitado" };
        cierres.push(row);
        return { id: row.id };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const c = cierres.find((x) => x.id === where.id);
        if (!c) return { count: 0 };
        Object.assign(c, data);
        return { count: 1 };
      }),
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => cierres[0] ?? null),
    },
    gestionOrden: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const g of gestiones) {
          if (where.mensajeroId !== undefined && g.mensajeroId !== where.mensajeroId) continue;
          if (where.cierreId === null && g.cierreId !== null) continue;
          if (where.anuladaAt === null && g.anuladaAt !== null) continue;
          if (typeof where.cierreId === "string" && g.cierreId !== where.cierreId) continue;
          const ids = (where.id as { in?: string[] } | undefined)?.in;
          if (ids && !ids.includes(g.id)) continue;
          Object.assign(g, data);
          count += 1;
        }
        return { count };
      }),
      findMany: vi.fn(async ({ where }: { where: { cierreId?: string } }) =>
        gestiones
          .filter((g) => g.cierreId === where.cierreId)
          .map((g) => ({
            ...g,
            // JOIN contra la fila VIVA de `orden` (lo que el bug leia).
            orden: joinOrden(ordenes.find((o) => o.id === g.ordenId)!),
          })),
      ),
    },
    cierreDetail: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) {
          // Semantica del UNIQUE (cierre_id, orden_id).
          if (detalle.some((x) => x.cierreId === d.cierreId && x.ordenId === d.ordenId)) {
            throw new Error("unique violation cierre_detail");
          }
          detalle.push({ ...d, id: `d${++seq}` });
        }
        return { count: data.length };
      }),
      findMany: vi.fn(async ({ where }: { where: { cierreId?: string } }) =>
        detalle.filter((d) => d.cierreId === where.cierreId),
      ),
    },
    tarifa: {
      findFirst: vi.fn(async ({ where }: { where: { tiendaId: string; deletedAt: null } }) => {
        const cands = tarifas
          .filter((t) => t.tiendaId === where.tiendaId && t.deletedAt === null)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return cands[0] ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: { tiendaId: { in: string[] }; deletedAt: null } }) =>
        tarifas
          .filter((t) => where.tiendaId.in.includes(t.tiendaId) && t.deletedAt === null)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
    },
    walletMovimiento: {
      createMany: vi.fn(async ({ data }: { data: CrearMovimientoInput[] }) => {
        for (const d of data) movs.push({ ...d, id: `w${++seq}` });
        return { count: data.length };
      }),
    },
    walletTiendaMovimiento: {
      createMany: vi.fn(async ({ data }: { data: CrearMovimientoTiendaInput[] }) => {
        for (const d of data) movsTienda.push({ ...d, id: `wt${++seq}` });
        return { count: data.length };
      }),
    },
  };

  const prisma = {
    ...client,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(client)),
  };

  return { prisma, ordenes, tarifas, gestiones, cierres, detalle, movs, movsTienda };
}

type Db = ReturnType<typeof makeDb>;

// --- Los dos actores reales: SOLICITAR y APROBAR ------------------------------------------

function solicitar(db: Db) {
  const repo = new CierreDiaRepository(
    db.prisma as unknown as PrismaClient,
    new TarifaVigentePorTiendaRepository(db.prisma as unknown as PrismaClient),
  );
  return repo.crearCierre({
    mensajeroId: "m1",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    // 37/R14: los total_* se congelan al SOLICITAR, con el COD realmente recaudado.
    totales: { efectivo: "10000.00", simpe: "0.00", transferencia: "0.00", general: "10000.00" },
    pagoByGestionId: { g1: "0.00" },
    totalPagoMensajero: "0.00",
    ingresoByGestionId: { g1: "0.00" },
    totalIngresoBodegaRechazos: "0.00",
  });
}

function aprobar(db: Db, cierreId: string) {
  const prisma = db.prisma as unknown as PrismaClient;
  const repo = new CierresAdminRepository(
    prisma,
    new WalletMovimientoRepository(prisma),
    new WalletFeedService(),
    {
      crearMovimientos: vi.fn(async (tx: unknown, movs: CrearMovimientoTiendaInput[]) => {
        await db.prisma.walletTiendaMovimiento.createMany({ data: movs });
        return movs.length;
      }),
      listarPorTienda: vi.fn(),
      agregarSaldoPorTienda: vi.fn(),
      listarSaldosTodasTiendas: vi.fn(),
      // Feature 170 (T I.1): saldos paginados; doble no-op, esta suite no los lee.
      listarSaldosTiendasPaginado: vi.fn(),
      agregarDesglosePorTienda: vi.fn(), // feature 171: doble no-op, este test no lee el ledger
    },
    new WalletTiendaFeedService(),
    // 44: fuera del alcance de estos dos casos (su libro sale de los snapshots del cierre_dia,
    // que la 69 no toca).
    {
      crearMovimientos: vi.fn(async () => 0),
      listarPorMensajero: vi.fn(),
      agregarCuentaPorPagar: vi.fn(),
      listarCuentasPorPagarTodos: vi.fn(),
      listarCuentasPorPagarPaginado: vi.fn(),
      listarCuentasPorPagarCompleto: vi.fn(),
      obtenerNombreMensajero: vi.fn(),
    },
    { construirMovimientosDePago: vi.fn(async () => ({ libro: [], egresoCaja: [] })) },
    // Feature 158: feed del egreso de indemnizacion (real: sin incidentes devuelve []).
    new WalletIndemnizacionFeedService(),
  );
  return repo.resolverCierre({
    cierreId,
    alcance: ALCANCE,
    nuevoEstado: "aprobado",
    resueltoPor: "adm",
    motivoRechazo: null,
  });
}

// Los repos de wallet convierten el monto STRING -> Prisma.Decimal antes de insertar, asi que
// la fila almacenada lleva Decimal. Se normaliza a STRING escala 2 para comparar (money-safe:
// nunca se compara con number).
const montoDe = (movs: Array<{ categoria: string; monto: unknown }>, categoria: string) => {
  const m = movs.find((x) => x.categoria === categoria)?.monto;
  if (m === undefined) return undefined;
  return m instanceof Prisma.Decimal ? m.toFixed(2) : String(m);
};

// --- R17 ----------------------------------------------------------------------------------

describe("Feature 69/R17 — editar la orden entre SOLICITAR y APROBAR no mueve el dinero", () => {
  it("los movimientos salen con los valores CONGELADOS y cuadran con los total_* del cierre", async () => {
    const db = makeDb();

    // 1) El mensajero SOLICITA su cierre. Aqui se congela todo (monto 10000, tienda t1).
    const cierreId = await solicitar(db);
    expect(cierreId).not.toBeNull();

    // 2) Entre solicitar y aprobar, alguien EDITA la orden. `OrdenRepository.update` no tiene
    //    guarda contra cierres (decision (e): no se anade; el snapshot lo hace inofensivo).
    //    Se mueven las dos palancas money-critical a la vez: cuanto se cobra y A QUIEN.
    const orden = db.ordenes[0];
    orden.montoCobrar = dec("99999.00");
    orden.tiendaId = "t2";

    // 3) El admin APRUEBA.
    expect(await aprobar(db, cierreId!)).toBe("updated");

    // La comision COD se deriva del monto CONGELADO (10000 * 5% = 500), NO del editado
    // (99999 * 5% = 4999.95). Este es el descuadre exacto que la feature mata.
    expect(montoDe(db.movs, "ingreso_comision_cod")).toBe("500.00");
    expect(montoDe(db.movs, "ingreso_iva_comision_cod")).toBe("65.00"); // 500 * 13%
    // El flete no depende del monto, pero si de la tarifa de la tienda congelada.
    expect(montoDe(db.movs, "ingreso_flete")).toBe("1000.00"); // zona no central
    expect(montoDe(db.movs, "ingreso_iva_flete")).toBe("130.00");

    // R17: el ledger por tienda acredita a la tienda CONGELADA (t1), no a la nueva (t2).
    // "A quien se le paga" no puede moverse despues de solicitar.
    const credito = db.movsTienda.find((m) => m.categoria === "cod_recaudado");
    expect(credito?.tiendaId).toBe("t1");

    // R17 (la otra mitad): los movimientos CUADRAN con los total_* snapshot del cierre
    // (37/R14). El COD acreditado a la tienda es exactamente el total_general congelado.
    const cierre = db.cierres[0] as { totalGeneral: Prisma.Decimal };
    expect(credito?.monto).toBe(cierre.totalGeneral.toFixed(2));
    expect(credito?.monto).toBe("10000.00");
  });
});

// --- R18 ----------------------------------------------------------------------------------

describe("Feature 69/R18 — cambiar la tarifa entre SOLICITAR y APROBAR no mueve el dinero", () => {
  it("los movimientos salen con la tarifa CONGELADA, no con la vigente al aprobar", async () => {
    const db = makeDb();

    // 1) SOLICITAR: congela la tarifa `ta1` (flete 1000, IVA 13%, comision 5%).
    const cierreId = await solicitar(db);
    expect(cierreId).not.toBeNull();

    // 2) La tienda cambia su tarifa: borra la vieja (soft delete) y da de alta otra MUY
    //    distinta. Sin snapshot, el resolver del feed elegiria esta al aprobar — cambiar una
    //    tarifa no toca `orden`, asi que ninguna guarda al UPDATE (decision (e)) lo veria.
    db.tarifas[0].deletedAt = new Date();
    db.tarifas.push({
      id: "ta2",
      tiendaId: "t1",
      valorFlete: dec("7777.00"),
      valorFleteGam: dec("8888.00"),
      valorFleteDevuelto: dec("9999.00"),
      valorFleteDevueltoGam: dec("9999.00"),
      comisionCod: dec("50.00"),
      ivaFlete: dec("99.00"),
      ivaComisionCod: dec("99.00"),
      deletedAt: null,
      createdAt: new Date("2026-07-14"),
      status: "activo",
    });

    // 3) APROBAR.
    expect(await aprobar(db, cierreId!)).toBe("updated");

    // Todo sale de `ta1` (la congelada). Con `ta2` serian 7777.00 / 7699.23 / 5000.00.
    expect(montoDe(db.movs, "ingreso_flete")).toBe("1000.00");
    expect(montoDe(db.movs, "ingreso_iva_flete")).toBe("130.00");
    expect(montoDe(db.movs, "ingreso_comision_cod")).toBe("500.00");
    expect(montoDe(db.movs, "ingreso_iva_comision_cod")).toBe("65.00");

    // La fila del snapshot deja rastro de QUE tarifa se uso (auditabilidad, design §2.1: es
    // la contrapartida que hace visible la deuda (g)).
    expect(db.detalle[0].tarifaId).toBe("ta1");
  });

  it("R9/(c): una tienda que se queda SIN tarifa vigente al aprobar sigue liquidando la congelada", async () => {
    const db = makeDb();
    const cierreId = await solicitar(db);

    // La tienda borra su unica tarifa despues de solicitar: al aprobar NO hay ninguna vigente.
    db.tarifas[0].deletedAt = new Date();

    expect(await aprobar(db, cierreId!)).toBe("updated");

    // Sin snapshot esto daria conceptos 0.00 (el gap R9 del resolver) y el cierre liquidaria
    // en cero. Con el snapshot, la tarifa congelada sigue ahi.
    expect(montoDe(db.movs, "ingreso_flete")).toBe("1000.00");
    expect(montoDe(db.movs, "ingreso_comision_cod")).toBe("500.00");
  });
});
