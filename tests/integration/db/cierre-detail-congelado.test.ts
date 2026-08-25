import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import { ANCLAJE_DEVOLUCION } from "@/tests/fixtures/anclaje-devolucion";

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
// Feature 274: la fila de `tarifas` tiene ya sus DOS dimensiones nullables (feature 273) y ya
// NO tiene `deleted_at` (borra en fisico) ni `status` (la migracion `drop_tarifa_status` los
// retiro). El doble modela eso: un doble que conservara las columnas muertas estaria midiendo
// una tabla que no existe.
interface TarifaRow {
  id: string;
  tiendaId: string | null;
  zonaId: string | null;
  valorFlete: Prisma.Decimal;
  valorFleteGam: Prisma.Decimal;
  valorFleteDevuelto: Prisma.Decimal;
  valorFleteDevueltoGam: Prisma.Decimal;
  // 2026-08-19: columna NOT NULL de `tarifas` que el batch del resolver SELECCIONA (camino del
  // snapshot). Va aqui, no en el escenario, porque el doble modela la FILA: si falta, el
  // resolver lee `undefined.toFixed(2)` y estos tres casos mueren antes de medir nada.
  fulfillment: Prisma.Decimal;
  comisionCod: Prisma.Decimal;
  ivaFlete: Prisma.Decimal;
  ivaComisionCod: Prisma.Decimal;
  createdAt: Date;
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

// Semantica de UNA dimension del `where` de la cascada, como la aplicaria Postgres:
// ausente = no filtra · `null` = IS NULL · string = igualdad · `{ in }` = IN (...).
type CondDimension = string | { in: string[] } | null | undefined;
interface WhereCascadaDoble {
  OR: Array<{ tiendaId?: CondDimension; zonaId?: CondDimension }>;
}
function casaDimension(valor: string | null, cond: CondDimension): boolean {
  if (cond === undefined) return true;
  if (cond === null) return valor === null;
  if (typeof cond === "string") return valor === cond;
  return valor !== null && cond.in.includes(valor);
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
      // Tarifa de NIVEL 2 (la tienda entera, sin zona): es la que resuelve el par (t1, z1)
      // mientras no exista una de nivel 1 para esa zona.
      zonaId: null,
      valorFlete: dec("1000.00"),
      valorFleteGam: dec("1500.00"),
      valorFleteDevuelto: dec("400.00"),
      valorFleteDevueltoGam: dec("600.00"),
      fulfillment: dec("300.00"),
      comisionCod: dec("5.00"),
      ivaFlete: dec("13.00"),
      ivaComisionCod: dec("13.00"),
      createdAt: new Date("2026-07-01"),
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
      // Feature 239 (T2.2): esta consulta la usan DOS lectores con `where` distinto — el feed de
      // dinero (`{ cierreId }`) y el bloque de anclaje (`{ cierreId, resultado, anuladaAt }` y
      // luego `{ ordenId: { in }, resultado, anuladaAt }`). El doble honra las CUATRO claves; si
      // solo mirara `cierreId`, le devolveria al anclaje gestiones que no pidio y este archivo
      // estaria midiendo un camino que no existe.
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            cierreId?: string;
            resultado?: string;
            anuladaAt?: Date | null;
            ordenId?: { in?: string[] };
          };
        }) =>
          gestiones
            .filter(
              (g) =>
                (where.cierreId === undefined || g.cierreId === where.cierreId) &&
                (where.resultado === undefined || g.resultado === where.resultado) &&
                (where.anuladaAt === undefined || g.anuladaAt === where.anuladaAt) &&
                (where.ordenId?.in === undefined || where.ordenId.in.includes(g.ordenId)),
            )
            .map((g) => ({
              ...g,
              // JOIN contra la fila VIVA de `orden` (lo que el bug leia).
              orden: joinOrden(ordenes.find((o) => o.id === g.ordenId)!),
            })),
      ),
    },
    // INVERTIDO el 2026-08-19 (feature 239/T2.3): la escritura de `gestion_aprobada` se retiro y
    // la sustituye el ANCLAJE, que acota por ids y va GUARDADO por `estatus_id = <pre-estado>`.
    // El doble honra esa guarda, que es la que da la idempotencia: un doble mudo que devolviera
    // `{count: 0}` dejaria pasar un WHERE sin guarda. En ESTE archivo el escenario no tiene
    // devoluciones (la unica gestion es `entregada`), asi que el anclaje es no-op — y eso se ve,
    // en vez de esconderse detras de un `vi.fn()` sin cuerpo.
    orden: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: { in?: string[] }; estatusId?: string; deletedAt?: Date | null };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const o of ordenes) {
            if (where.id?.in !== undefined && !where.id.in.includes(o.id)) continue;
            if (where.estatusId !== undefined) continue; // ninguna orden de este escenario esta en el pre-estado
            Object.assign(o, data);
            count += 1;
          }
          return { count };
        },
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
    // Feature 274: el resolver hace UNA sola `findMany` con el `where` de tres ramas que
    // produce `whereCascada` (`{ OR: [...] }`, cada rama con `tiendaId`/`zonaId` en forma de
    // valor, `{ in }` o `null`). El doble honra esa semantica en vez de mirar solo `tiendaId`:
    // si la aplanara, no podria distinguir un nivel 1 de un nivel 2 y este archivo dejaria de
    // medir la cascada. `findFirst` se retiro: ya no hay ningun camino que lo use.
    //
    // El orden de salida es el de insercion, A PROPOSITO y sin `orderBy`: la cascada es
    // determinista por especificidad (R5), asi que devolverlas en cualquier orden no puede
    // cambiar el ganador. Si alguien reintrodujera un desempate por fecha, R22 se pondria rojo.
    tarifa: {
      findMany: vi.fn(async ({ where }: { where: WhereCascadaDoble }) =>
        tarifas.filter((t) =>
          where.OR.some((r) => casaDimension(t.tiendaId, r.tiendaId) && casaDimension(t.zonaId, r.zonaId)),
        ),
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
      // Feature 173/T B.2: al aprobar, el feed del contra-entrega LEE del ledger lo que la
      // linea de arriba acaba de escribir. El doble honra el `where` como lo haria Postgres,
      // para que siga siendo el MISMO libro el que se escribe y el que se lee.
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        movsTienda
          .filter((m) =>
            Object.entries(where).every(
              ([k, v]) => (m as unknown as Record<string, unknown>)[k] === v,
            ),
          )
          .map((m) => ({ monto: new Prisma.Decimal(m.monto) })),
      ),
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
    new TarifaVigenteRepository(db.prisma as unknown as PrismaClient),
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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

    // 2) La tienda cambia su tarifa: borra la vieja —EN FISICO desde la 274: `tarifas` ya no
    //    tiene `deleted_at`, y por eso el UNIQUE del par puede ser total— y da de alta otra MUY
    //    distinta. Sin snapshot, el resolver del feed elegiria esta al aprobar — cambiar una
    //    tarifa no toca `orden`, asi que ninguna guarda al UPDATE (decision (e)) lo veria.
    db.tarifas.splice(0, 1);
    db.tarifas.push({
      id: "ta2",
      tiendaId: "t1",
      zonaId: null,
      valorFlete: dec("7777.00"),
      valorFleteGam: dec("8888.00"),
      valorFleteDevuelto: dec("9999.00"),
      valorFleteDevueltoGam: dec("9999.00"),
      fulfillment: dec("8000.00"), // tambien MUY distinto del de `ta1` (300.00)
      comisionCod: dec("50.00"),
      ivaFlete: dec("99.00"),
      ivaComisionCod: dec("99.00"),
      createdAt: new Date("2026-07-14"),
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
    db.tarifas.splice(0, 1);

    expect(await aprobar(db, cierreId!)).toBe("updated");

    // Sin snapshot esto daria conceptos 0.00 (el gap R9 del resolver) y el cierre liquidaria
    // en cero. Con el snapshot, la tarifa congelada sigue ahi.
    expect(montoDe(db.movs, "ingreso_flete")).toBe("1000.00");
    expect(montoDe(db.movs, "ingreso_comision_cod")).toBe("500.00");
  });
});

// --- Feature 274 (R22/R23/R24) ------------------------------------------------------------
//
// Estos tres casos recorren el camino REAL de punta a punta: `CierreDiaRepository.crearCierre`
// -> `TarifaVigenteRepository.resolveTarifas` -> `whereCascada`/`elegirPorCascada` -> la
// `findMany` del doble. Nada de la cascada esta mockeado; lo unico simulado es Postgres.

describe("Feature 274/R22 — el snapshot congela la fila que elige la CASCADA (tienda, zona)", () => {
  it("congela la de NIVEL 1 (t1, z1) aunque la de nivel 2 sea MAS RECIENTE", async () => {
    const db = makeDb();
    // `ta1` es la de nivel 2 (tienda sola) y se hace la MAS NUEVA de las dos.
    db.tarifas[0].createdAt = new Date("2026-08-01");
    db.tarifas.push({
      id: "ta-z1",
      tiendaId: "t1",
      zonaId: "z1", // nivel 1: el par exacto de la orden `o1`
      valorFlete: dec("2500.00"),
      valorFleteGam: dec("2600.00"),
      valorFleteDevuelto: dec("700.00"),
      valorFleteDevueltoGam: dec("800.00"),
      fulfillment: dec("450.00"),
      comisionCod: dec("7.00"),
      ivaFlete: dec("13.00"),
      ivaComisionCod: dec("13.00"),
      createdAt: new Date("2026-07-01"), // MAS VIEJA, y aun asi gana
    });

    const cierreId = await solicitar(db);
    expect(cierreId).not.toBeNull();

    // R22: gana la especificidad, no la fecha. Antes de la 274 el cierre resolvia por TIENDA
    // y habria congelado `ta1` (1000.00), la generica.
    const fila = db.detalle[0] as Record<string, unknown>;
    expect(fila.tarifaId).toBe("ta-z1");
    expect((fila.tarifaValorFlete as Prisma.Decimal).toFixed(2)).toBe("2500.00");
    expect((fila.tarifaFulfillment as Prisma.Decimal).toFixed(2)).toBe("450.00");

    // Y el dinero liquidado sale de esa misma fila: 2500 de flete + 13% de IVA.
    expect(await aprobar(db, cierreId!)).toBe("updated");
    expect(montoDe(db.movs, "ingreso_flete")).toBe("2500.00");
    expect(montoDe(db.movs, "ingreso_iva_flete")).toBe("325.00");
  });

  it("R7: N ordenes del cierre => UNA sola `tarifa.findMany`, dentro de la tx", async () => {
    const db = makeDb();
    const cierreId = await solicitar(db);
    expect(cierreId).not.toBeNull();
    expect(db.prisma.tarifa.findMany).toHaveBeenCalledTimes(1);
    // El `where` es el de la cascada (tres ramas), no un `tiendaId` pelado.
    const [{ where }] = (db.prisma.tarifa.findMany as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((where as WhereCascadaDoble).OR).toHaveLength(3);
  });
});

describe("Feature 274/R23/R39 — sin tarifa el cierre se crea igual, con las 9 columnas NULL", () => {
  it("no hay ninguna fila que resuelva el par => snapshot en NULL y cierre creado", async () => {
    const db = makeDb();
    db.tarifas.length = 0; // ni nivel 1, ni nivel 2, ni nivel 3

    const cierreId = await solicitar(db);

    // El `409` de las dos APIs por key NO llega hasta aqui (R39): el mensajero cierra su dia.
    expect(cierreId).not.toBeNull();
    expect(db.detalle).toHaveLength(1);
    const fila = db.detalle[0] as Record<string, unknown>;
    for (const col of [
      "tarifaId",
      "tarifaValorFlete",
      "tarifaValorFleteGam",
      "tarifaValorFleteDevuelto",
      "tarifaValorFleteDevueltoGam",
      "tarifaComisionCod",
      "tarifaIvaFlete",
      "tarifaIvaComisionCod",
      "tarifaFulfillment",
      // Los dos pactos entran en el mismo "todas o ninguna": sin tarifa vigente no hay pacto
      // que congelar, y NULL aqui no se puede confundir con "se pacto cero".
      "tarifaEspecial",
      "tarifaEspecialDevuelta",
    ]) {
      expect(fila[col]).toBeNull();
    }
  });
});

describe("Feature 274/R24 — el shape del snapshot no cambia", () => {
  it("la fila persistida trae las MISMAS columnas que en dev (29, `tarifa_id` y `fulfillment` incluidos)", async () => {
    const db = makeDb();
    await solicitar(db);

    // Lista congelada tal cual la escribia `dev` antes de la 274. `id` lo pone el doble al
    // insertar (lo pondria el default de Postgres), asi que se excluye de la comparacion.
    const COLUMNAS_DEV = [
      "cierreId",
      "ordenId",
      "montoCobrar",
      "cobraComision",
      "zonaId",
      "tiendaId",
      "esCentral",
      // 2026-08-25 (tarifa especial por distrito): la marca del distrito y los dos pactos son
      // entradas de la formula, y todo lo que entra en la formula se congela aqui. Sin esto,
      // un cierre viejo se re-derivaria con la tarifa y la marca de HOY.
      "esZonaEspecial",
      "tarifaId",
      "tarifaValorFlete",
      "tarifaValorFleteGam",
      "tarifaValorFleteDevuelto",
      "tarifaValorFleteDevueltoGam",
      "tarifaComisionCod",
      "tarifaIvaFlete",
      "tarifaIvaComisionCod",
      "tarifaFulfillment",
      "tarifaEspecial",
      "tarifaEspecialDevuelta",
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "producto",
      "tiendaNombre",
      "zonaNombre",
      "provinciaNombre",
      "cantonNombre",
      "distritoNombre",
    ];
    const escritas = Object.keys(db.detalle[0]).filter((k) => k !== "id");
    expect(escritas.sort()).toEqual([...COLUMNAS_DEV].sort());
  });
});
