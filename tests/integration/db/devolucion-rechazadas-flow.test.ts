import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { DevolucionOrigenService } from "@/lib/services/DevolucionOrigenService";
import { EnvioDevolucionCentralService } from "@/lib/services/EnvioDevolucionCentralService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RecepcionBodegaCentralService } from "@/lib/services/RecepcionBodegaCentralService";
import { RecepcionOrigenService } from "@/lib/services/RecepcionOrigenService";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IWalletFeedService } from "@/lib/interfaces/services/IWalletFeedService";
import type { IWalletMensajeroFeedService } from "@/lib/interfaces/services/IWalletMensajeroFeedService";
import type { IWalletTiendaFeedService } from "@/lib/interfaces/services/IWalletTiendaFeedService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrderStatusValue } from "@/lib/types/order-status";
import { filasCatalogoEstados, idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";

// Feature 139 (T4.1, R5 + R13-R18) — RECORRIDO COMPLETO de la devolucion de RECHAZADAS, de punta a
// punta y con los SERVICES REALES encadenados (no se re-testea cada uno por separado: eso ya lo
// hacen sus unit tests). Aqui la propiedad probada es la del RECORRIDO: que las transiciones
// encadenan, que ambas ramas (satelite y central) convergen en `devuelta_a_tienda` y que el
// historial queda completo y coherente, con el `origen_tipo` correcto en cada salto.
//
// Patron `resolver-novedad-recupera-sla.test.ts` / `cierre-detail-congelado.test.ts`: no hay
// Postgres en la suite, asi que se usa una "base" EN MEMORIA con la semantica de las queries Prisma
// que consumen los repos REALES (`CierresAdminRepository`, `OrdenRepository`, `ZonaRepository`). Los
// unicos dobles son los feeds/repos de wallet del constructor de cierres (devuelven vacio: el dinero
// no es el objeto de este test) y el proveedor de URLs firmadas (no interviene en aprobar).
//
// Feature 140: el choke point valida CADA par origen->destino contra `TRANSICIONES` con fallo
// CERRADO. Como el recorrido pasa por el choke point real en los cinco saltos, si alguno no fuera
// legal la `$transaction` reventaria aqui: este test tambien es la prueba de que la cadena completa
// es legal para la guardia central.

const VALUE_POR_ID = new Map(filasCatalogoEstados().map((f) => [f.id, f.value]));
const valueDe = (estatusId: string): string => VALUE_POR_ID.get(estatusId) ?? "desconocido";

const ZONA_CENTRAL = "z-central";
const ZONA_SATELITE = "z-sat";
const ES_CENTRAL: Record<string, boolean> = { [ZONA_CENTRAL]: true, [ZONA_SATELITE]: false };

const TIENDA = "t1";
const MENSAJERO = "m1";
const GUIA_SAT = 9001;
const GUIA_CEN = 9002;

const ADMIN_CENTRAL: Actor = { usuarioId: "adm-central", rol: "maestro" };
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const ADMIN_TIENDA: Actor = { usuarioId: TIENDA, rol: "adminTienda" };

interface OrdenRow {
  id: string;
  numGuia: number;
  numRemision: string;
  estatusId: string;
  deletedAt: Date | null;
  zonaId: string;
  tiendaId: string;
  mensajeroAsignadoId: string | null;
  asignadoAt: Date | null;
  prioridad: boolean;
  destinatario: string;
  telefonoDest: string;
  provinciaId: string;
  cantonId: string;
  distritoId: string | null;
  producto: string;
  peso: null;
  notas: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CierreRow {
  id: string;
  estado: string;
  destinoTipo: string;
  destinoZonaId: string | null;
  mensajeroId: string;
  resueltoPor: string | null;
  resueltoAt: Date | null;
  motivoRechazo: string | null;
}

interface HistorialRow {
  ordenId: string;
  estatusOrigenId: string | null;
  estatusDestinoId: string;
  actorUsuarioId: string | null;
  origenTipo: string;
}

type Args = Record<string, never> & Record<string, unknown>;

function ordenBase(over: Partial<OrdenRow> & Pick<OrdenRow, "id" | "numGuia" | "zonaId">): OrdenRow {
  return {
    numRemision: `R-${over.id}`,
    estatusId: idEstado("rechazada"),
    deletedAt: null,
    tiendaId: TIENDA,
    mensajeroAsignadoId: MENSAJERO, // el rechazo NO limpia el mensajero (R8/R12)
    asignadoAt: new Date("2026-07-24T08:00:00.000Z"),
    prioridad: false,
    destinatario: "Cliente",
    telefonoDest: "88888888",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "caja",
    peso: null,
    notas: null,
    createdAt: new Date("2026-07-24T07:00:00.000Z"),
    updatedAt: new Date("2026-07-24T07:00:00.000Z"),
    ...over,
  };
}

/** WHERE de `orden` con la semantica de las queries que ejecutan los repos reales del recorrido. */
function coincideOrden(o: OrdenRow, where: Record<string, unknown>): boolean {
  const id = where.id as string | { in: string[] } | undefined;
  if (typeof id === "string" && o.id !== id) return false;
  if (id !== undefined && typeof id === "object" && !id.in.includes(o.id)) return false;
  if (where.numGuia !== undefined && o.numGuia !== where.numGuia) return false;
  if (where.deletedAt === null && o.deletedAt !== null) return false;
  if (where.estatusId !== undefined && o.estatusId !== where.estatusId) return false;
  const estatus = where.estatus as { value?: string } | undefined;
  if (estatus?.value !== undefined && valueDe(o.estatusId) !== estatus.value) return false;
  if (where.tiendaId !== undefined && o.tiendaId !== where.tiendaId) return false;
  if (
    where.mensajeroAsignadoId !== undefined &&
    o.mensajeroAsignadoId !== where.mensajeroAsignadoId
  ) {
    return false;
  }
  return true;
}

/** Relaciones directas que los `select`/`include` del recorrido resuelven sobre la orden. */
function relacionOrden(o: OrdenRow, nombre: string): Record<string, unknown> {
  if (nombre === "estatus") return { id: o.estatusId, value: valueDe(o.estatusId) };
  if (nombre === "zona") return { id: o.zonaId, esCentral: ES_CENTRAL[o.zonaId] };
  throw new Error(`relacion de orden no soportada por el doble: ${nombre}`);
}

function materializarOrden(o: OrdenRow, args: Record<string, unknown>): Record<string, unknown> {
  const select = args.select as Record<string, unknown> | undefined;
  if (select) {
    const out: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(select)) {
      if (valor === true) out[clave] = (o as unknown as Record<string, unknown>)[clave];
      else {
        const sub = (valor as { select: Record<string, unknown> }).select;
        const rel = relacionOrden(o, clave);
        const relOut: Record<string, unknown> = {};
        for (const k of Object.keys(sub)) relOut[k] = rel[k];
        out[clave] = relOut;
      }
    }
    return out;
  }
  const out: Record<string, unknown> = { ...o };
  for (const clave of Object.keys((args.include as Record<string, unknown>) ?? {})) {
    out[clave] = relacionOrden(o, clave);
  }
  return out;
}

function makeDb() {
  const ordenes: OrdenRow[] = [
    // Rama SATELITE: rechazada de una zona satelite -> `por_devolver` al aprobar el cierre.
    ordenBase({ id: "o-sat", numGuia: GUIA_SAT, zonaId: ZONA_SATELITE }),
    // Rama CENTRAL: rechazada de la zona central -> `por_devolver_a_tienda` al aprobar el cierre.
    ordenBase({ id: "o-cen", numGuia: GUIA_CEN, zonaId: ZONA_CENTRAL }),
  ];
  const cierres: CierreRow[] = [
    {
      id: "c1",
      estado: "solicitado",
      destinoTipo: "bodega_central",
      destinoZonaId: ZONA_CENTRAL,
      mensajeroId: MENSAJERO,
      resueltoPor: null,
      resueltoAt: null,
      motivoRechazo: null,
    },
  ];
  const historial: HistorialRow[] = [];

  const client = {
    orden: {
      findFirst: async (args: Args) => {
        const o = ordenes.find((row) => coincideOrden(row, args.where as Record<string, unknown>));
        return o ? materializarOrden(o, args) : null;
      },
      findUnique: async (args: Args) => {
        const o = ordenes.find((row) => coincideOrden(row, args.where as Record<string, unknown>));
        return o ? materializarOrden(o, args) : null;
      },
      findMany: async (args: Args) =>
        ordenes
          .filter((row) => coincideOrden(row, args.where as Record<string, unknown>))
          .map((row) => materializarOrden(row, args)),
      updateMany: async (args: Args) => {
        let count = 0;
        for (const o of ordenes) {
          if (!coincideOrden(o, args.where as Record<string, unknown>)) continue;
          Object.assign(o, args.data as Partial<OrdenRow>);
          count += 1;
        }
        return { count };
      },
    },
    orderStatus: {
      findUnique: async (args: Args) => {
        const where = args.where as { value?: string; id?: string };
        const fila = filasCatalogoEstados().find(
          (f) => (where.value !== undefined ? f.value === where.value : f.id === where.id),
        );
        return fila ?? null;
      },
    },
    usuario: {
      findUnique: async (args: Args) => {
        const { id } = args.where as { id: string };
        // El adminSatelite responsable pertenece a la zona satelite; el resto no tiene zona.
        return { zonaId: id === ADMIN_SATELITE.usuarioId ? ZONA_SATELITE : null };
      },
    },
    zona: {
      findFirst: async () => ({ id: ZONA_CENTRAL }),
    },
    cierreDia: {
      updateMany: async (args: Args) => {
        const where = args.where as {
          id: string;
          estado?: { in: string[] };
          destinoTipo?: string;
          destinoZonaId?: string;
        };
        let count = 0;
        for (const c of cierres) {
          if (c.id !== where.id) continue;
          if (where.estado !== undefined && !where.estado.in.includes(c.estado)) continue;
          if (where.destinoTipo !== undefined && c.destinoTipo !== where.destinoTipo) continue;
          if (where.destinoZonaId !== undefined && c.destinoZonaId !== where.destinoZonaId) continue;
          Object.assign(c, args.data as Partial<CierreRow>);
          count += 1;
        }
        return { count };
      },
      findUnique: async (args: Args) => {
        const { id } = args.where as { id: string };
        const c = cierres.find((row) => row.id === id);
        return c ? { mensajeroId: c.mensajeroId } : null;
      },
      count: async (args: Args) => {
        const where = args.where as { id: string; destinoTipo?: string };
        return cierres.filter(
          (c) =>
            c.id === where.id &&
            (where.destinoTipo === undefined || c.destinoTipo === where.destinoTipo),
        ).length;
      },
    },
    ordenHistorialEstado: {
      createMany: async (args: Args) => {
        const data = args.data as HistorialRow[];
        for (const fila of data) historial.push(fila);
        return { count: data.length };
      },
    },
    // Feature 158: la aprobacion consulta las gestiones `incidente` del cierre (guardia de
    // cobertura de indemnizaciones) y las tarifa dentro de la tx. En ESTE recorrido no hay
    // ninguna: el doble responde vacio y el camino de la 139 queda intacto (R64).
    gestionOrden: {
      findMany: async () => [] as unknown[],
      updateMany: async () => ({ count: 0 }),
    },
  };

  // `tx === client`: el doble no simula rollback (ningun caso de este recorrido lo ejercita; la
  // atomicidad de la aprobacion la cubre el unit test del repo). SIN `$queryRaw`: el emisor de
  // webhooks del choke point es no-op y la guardia 140 resuelve por la cache del catalogo.
  const prisma = {
    ...client,
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };

  return { prisma, ordenes, cierres, historial };
}

type Db = ReturnType<typeof makeDb>;

function walletDobles() {
  const walletMovimientoRepo = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listar: vi.fn(),
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
  } as unknown as IWalletMovimientoRepository;
  const walletFeedService = {
    construirMovimientosDeIngreso: vi.fn().mockResolvedValue([]),
  } as unknown as IWalletFeedService;
  const walletTiendaMovimientoRepo = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listarPorTienda: vi.fn(),
    agregarSaldoPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
  } as unknown as IWalletTiendaMovimientoRepository;
  const walletTiendaFeedService = {
    construirMovimientosPorTienda: vi.fn().mockResolvedValue([]),
  } as unknown as IWalletTiendaFeedService;
  const pagoMensajeroMovimientoRepo = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listarPorMensajero: vi.fn(),
    agregarCuentaPorPagar: vi.fn(),
    listarCuentasPorPagarTodos: vi.fn(),
    obtenerNombreMensajero: vi.fn(),
  } as unknown as IPagoMensajeroMovimientoRepository;
  const walletMensajeroFeedService = {
    construirMovimientosDePago: vi.fn().mockResolvedValue({ libro: [], egresoCaja: [] }),
  } as unknown as IWalletMensajeroFeedService;
  return {
    walletMovimientoRepo,
    walletFeedService,
    walletTiendaMovimientoRepo,
    walletTiendaFeedService,
    pagoMensajeroMovimientoRepo,
    walletMensajeroFeedService,
  };
}

/** Los CINCO actores del recorrido, cada uno con su service REAL sobre la misma base. */
function makeServices(db: Db) {
  const prisma = db.prisma as unknown as PrismaClient;
  const ordenRepo = new OrdenRepository(prisma);
  const zonaRepo = new ZonaRepository(prisma);
  const wallet = walletDobles();
  const cierresRepo = new CierresAdminRepository(
    prisma,
    wallet.walletMovimientoRepo,
    wallet.walletFeedService,
    wallet.walletTiendaMovimientoRepo,
    wallet.walletTiendaFeedService,
    wallet.pagoMensajeroMovimientoRepo,
    wallet.walletMensajeroFeedService,
    // Feature 158: feed del egreso de indemnizacion. Este flujo no tiene incidentes, asi que
    // el feed REAL devuelve lista vacia y no emite nada.
    new WalletIndemnizacionFeedService(),
  );
  const signedUrls = {
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(),
  } as unknown as ISignedUrlProvider;

  return {
    // Feature 172 (T C.2): + la lectura de los pagos registrados, para derivar el pendiente
    // tras aprobar. Este flujo no registra ningun pago: sin cierre releible -> "0.00".
    cierres: new CierresAdminService(cierresRepo, zonaRepo, ordenRepo, signedUrls, {
      sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
        Object.fromEntries(ids.map((id) => [id, "0.00"])),
      ),
      obtenerCierreParaPago: vi.fn(async () => null),
    }),
    envioSatelite: new EnvioDevolucionCentralService(ordenRepo),
    recepcionCentral: new RecepcionBodegaCentralService(ordenRepo),
    envioTienda: new DevolucionOrigenService(ordenRepo),
    recepcionTienda: new RecepcionOrigenService(ordenRepo),
  };
}

const estadoDe = (db: Db, ordenId: string): string =>
  valueDe(db.ordenes.find((o) => o.id === ordenId)!.estatusId);

/** Linea de tiempo legible de una orden: [origen, destino, origen_tipo, actor] por salto. */
function timeline(db: Db, ordenId: string): [string | null, string, string, string | null][] {
  return db.historial
    .filter((h) => h.ordenId === ordenId)
    .map((h) => [
      h.estatusOrigenId === null ? null : valueDe(h.estatusOrigenId),
      valueDe(h.estatusDestinoId),
      h.origenTipo,
      h.actorUsuarioId,
    ]);
}

/** Recorre la rama SATELITE completa: aprobar cierre -> envio -> recepcion central -> tienda. */
async function recorrerRamaSatelite(db: Db, s: ReturnType<typeof makeServices>) {
  expect(await s.cierres.aprobarCierre("c1", ADMIN_CENTRAL)).toEqual({
    status: "ok",
    cierreId: "c1",
    estado: "aprobado",
    pendientePagoMensajero: "0.00", // feature 172/T C.2
  });
  expect(await s.envioSatelite.enviarACentral("o-sat", ADMIN_SATELITE)).toEqual({ status: "ok" });
  expect(await s.recepcionCentral.recibirEnBodegaCentral(GUIA_SAT, ADMIN_CENTRAL)).toEqual({
    status: "ok",
    ordenId: "o-sat",
    estado: "por_devolver_a_tienda",
  });
  expect(await s.envioTienda.devolverATienda("o-sat", ADMIN_CENTRAL)).toEqual({ status: "ok" });
  expect(await s.recepcionTienda.recibirEnOrigen(GUIA_SAT, ADMIN_TIENDA)).toEqual({
    status: "ok",
    ordenId: "o-sat",
    estado: "devuelta_a_tienda",
  });
}

/** Recorre la rama CENTRAL completa: aprobar cierre -> envio a tienda -> recepcion en tienda. */
async function recorrerRamaCentral(db: Db, s: ReturnType<typeof makeServices>) {
  expect((await s.cierres.aprobarCierre("c1", ADMIN_CENTRAL)).status).toBe("ok");
  expect(await s.envioTienda.devolverATienda("o-cen", ADMIN_CENTRAL)).toEqual({ status: "ok" });
  expect(await s.recepcionTienda.recibirEnOrigen(GUIA_CEN, ADMIN_TIENDA)).toEqual({
    status: "ok",
    ordenId: "o-cen",
    estado: "devuelta_a_tienda",
  });
}

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO
});

describe("Feature 139 T4.1 — la aprobacion del cierre rutea cada rechazada por la ZONA de la orden (R5)", () => {
  it("satelite -> por_devolver y central -> por_devolver_a_tienda, en la MISMA aprobacion", async () => {
    const db = makeDb();
    const s = makeServices(db);

    expect(estadoDe(db, "o-sat")).toBe("rechazada");
    expect(estadoDe(db, "o-cen")).toBe("rechazada");

    expect((await s.cierres.aprobarCierre("c1", ADMIN_CENTRAL)).status).toBe("ok");

    expect(estadoDe(db, "o-sat")).toBe("por_devolver");
    expect(estadoDe(db, "o-cen")).toBe("por_devolver_a_tienda");
    // R11: ambos saltos quedan clasificados como `devolucion_rechazada` con el admin que aprobo.
    expect(timeline(db, "o-sat")).toEqual([
      ["rechazada", "por_devolver", "devolucion_rechazada", ADMIN_CENTRAL.usuarioId],
    ]);
    expect(timeline(db, "o-cen")).toEqual([
      ["rechazada", "por_devolver_a_tienda", "devolucion_rechazada", ADMIN_CENTRAL.usuarioId],
    ]);
  });
});

describe("Feature 139 T4.1 — rama SATELITE: recorrido completo hasta devuelta_a_tienda (R5/R13/R17/R15/R18)", () => {
  it("encadena los cinco saltos y deja el historial completo con su origen_tipo por salto", async () => {
    const db = makeDb();
    const s = makeServices(db);

    await recorrerRamaSatelite(db, s);

    expect(estadoDe(db, "o-sat")).toBe("devuelta_a_tienda");
    expect(timeline(db, "o-sat")).toEqual([
      // R5/R11: la aprobacion del cierre saca la orden de `rechazada` (unico disparador, R9).
      ["rechazada", "por_devolver", "devolucion_rechazada", ADMIN_CENTRAL.usuarioId],
      // R13/R23: envio por lote del adminSatelite de la zona.
      ["por_devolver", "devolviendo_a_bodega_central", "ajuste_estado", ADMIN_SATELITE.usuarioId],
      // R17: recepcion central STATE-AWARE (reuso 138), que rutea a `por_devolver_a_tienda`.
      [
        "devolviendo_a_bodega_central",
        "por_devolver_a_tienda",
        "recepcion_bodega_central",
        ADMIN_CENTRAL.usuarioId,
      ],
      // R15/R23: envio a la tienda por maestro/admin (central).
      ["por_devolver_a_tienda", "devolviendo_a_tienda", "ajuste_estado", ADMIN_CENTRAL.usuarioId],
      // R18/R23: la tienda dueña recibe y cierra el flujo.
      ["devolviendo_a_tienda", "devuelta_a_tienda", "ajuste_estado", ADMIN_TIENDA.usuarioId],
    ]);
  });

  it("la cadena es COHERENTE: el origen de cada salto es el destino del anterior, sin huecos", async () => {
    const db = makeDb();
    const s = makeServices(db);

    await recorrerRamaSatelite(db, s);

    const saltos = timeline(db, "o-sat");
    expect(saltos[0][0]).toBe("rechazada"); // arranca donde reposaba la orden
    for (let i = 1; i < saltos.length; i += 1) {
      expect(saltos[i][0]).toBe(saltos[i - 1][1]);
    }
    expect(saltos[saltos.length - 1][1]).toBe(estadoDe(db, "o-sat")); // termina en el estado real
  });

  it("R8: el recorrido es money-neutral — mensajero, asignado_at y prioridad quedan intactos", async () => {
    const db = makeDb();
    const s = makeServices(db);
    const antes = { ...db.ordenes.find((o) => o.id === "o-sat")! };

    await recorrerRamaSatelite(db, s);

    const despues = db.ordenes.find((o) => o.id === "o-sat")!;
    expect(despues.mensajeroAsignadoId).toBe(antes.mensajeroAsignadoId);
    expect(despues.asignadoAt).toEqual(antes.asignadoAt);
    expect(despues.prioridad).toBe(false);
    expect(despues.numGuia).toBe(antes.numGuia);
    expect(despues.tiendaId).toBe(antes.tiendaId);
  });
});

describe("Feature 139 T4.1 — rama CENTRAL: recorrido completo hasta devuelta_a_tienda (R5/R15/R18)", () => {
  it("no pasa por bodega satelite: tres saltos y a la tienda", async () => {
    const db = makeDb();
    const s = makeServices(db);

    await recorrerRamaCentral(db, s);

    expect(estadoDe(db, "o-cen")).toBe("devuelta_a_tienda");
    expect(timeline(db, "o-cen")).toEqual([
      ["rechazada", "por_devolver_a_tienda", "devolucion_rechazada", ADMIN_CENTRAL.usuarioId],
      ["por_devolver_a_tienda", "devolviendo_a_tienda", "ajuste_estado", ADMIN_CENTRAL.usuarioId],
      ["devolviendo_a_tienda", "devuelta_a_tienda", "ajuste_estado", ADMIN_TIENDA.usuarioId],
    ]);
    // Los dos estados del tramo satelite no aparecen NUNCA en su linea de tiempo.
    const visitados = timeline(db, "o-cen").flatMap((s2) => [s2[0], s2[1]]);
    expect(visitados).not.toContain("por_devolver");
    expect(visitados).not.toContain("devolviendo_a_bodega_central");
  });
});

describe("Feature 139 T4.1 — ambas ramas convergen y el recorrido no se puede atajar", () => {
  it("las dos ordenes del MISMO cierre terminan en devuelta_a_tienda por caminos distintos", async () => {
    const db = makeDb();
    const s = makeServices(db);

    await recorrerRamaSatelite(db, s); // aprueba el cierre y lleva la satelite hasta el final
    // La central quedo en `por_devolver_a_tienda` desde la misma aprobacion: sigue su tramo.
    expect(estadoDe(db, "o-cen")).toBe("por_devolver_a_tienda");
    expect(await s.envioTienda.devolverATienda("o-cen", ADMIN_CENTRAL)).toEqual({ status: "ok" });
    expect((await s.recepcionTienda.recibirEnOrigen(GUIA_CEN, ADMIN_TIENDA)).status).toBe("ok");

    expect(estadoDe(db, "o-sat")).toBe("devuelta_a_tienda");
    expect(estadoDe(db, "o-cen")).toBe("devuelta_a_tienda");
    // 5 saltos la satelite + 3 la central: ningun salto de mas (sin re-transiciones).
    expect(db.historial).toHaveLength(8);
  });

  it("R9/R13: la satelite no puede saltarse la bodega central ni ser enviada por otro actor", async () => {
    const db = makeDb();
    const s = makeServices(db);
    expect((await s.cierres.aprobarCierre("c1", ADMIN_CENTRAL)).status).toBe("ok");

    // Desde `por_devolver` NO hay salida directa a la tienda (ese tramo empieza en central).
    expect(await s.envioTienda.devolverATienda("o-sat", ADMIN_CENTRAL)).toMatchObject({
      status: "conflict",
    });
    // Y el envio a central lo hace SOLO el adminSatelite de la zona (R14).
    expect(await s.envioSatelite.enviarACentral("o-sat", ADMIN_CENTRAL)).toEqual({
      status: "forbidden",
    });
    // Ningun rechazo dejo rastro: la orden sigue donde la dejo la aprobacion.
    expect(estadoDe(db, "o-sat")).toBe("por_devolver");
    expect(timeline(db, "o-sat")).toHaveLength(1);
  });

  it("R7: una 2.a aprobacion del mismo cierre no repite ningun salto del recorrido", async () => {
    const db = makeDb();
    const s = makeServices(db);

    await recorrerRamaSatelite(db, s);
    const saltosAntes = db.historial.length;

    // El cierre ya esta `aprobado`: la guarda de estado del updateMany no lo vuelve a resolver.
    expect((await s.cierres.aprobarCierre("c1", ADMIN_CENTRAL)).status).toBe("conflict");

    expect(db.historial).toHaveLength(saltosAntes);
    expect(estadoDe(db, "o-sat")).toBe("devuelta_a_tienda");
  });
});

describe("Feature 139 T4.1 — el recorrido completo es legal para la guardia central (feature 140)", () => {
  it("los cinco pares origen->destino de la rama satelite son transiciones declaradas", async () => {
    const db = makeDb();
    const s = makeServices(db);

    // Si algun par no estuviera en `TRANSICIONES`, el choke point (fallo CERRADO) habria lanzado
    // dentro de su $transaction y ninguno de los `expect(...).toEqual({status:'ok'})` de arriba
    // pasaria. Que el recorrido llegue al final ES la prueba; aqui se fija el conjunto exacto.
    await recorrerRamaSatelite(db, s);

    const pares = timeline(db, "o-sat").map(([origen, destino]) => `${origen}->${destino}`);
    expect(pares).toEqual([
      "rechazada->por_devolver",
      "por_devolver->devolviendo_a_bodega_central",
      "devolviendo_a_bodega_central->por_devolver_a_tienda",
      "por_devolver_a_tienda->devolviendo_a_tienda",
      "devolviendo_a_tienda->devuelta_a_tienda",
    ]);
    // Todos los estados del recorrido son values REALES del catalogo (no cadenas inventadas).
    const estados = new Set(timeline(db, "o-sat").flatMap(([o, d]) => [o as OrderStatusValue, d as OrderStatusValue]));
    for (const estado of estados) expect(VALUE_POR_ID.has(idEstado(estado))).toBe(true);
  });
});
