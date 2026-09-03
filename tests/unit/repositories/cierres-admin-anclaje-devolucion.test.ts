import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletMensajeroFeedService } from "@/lib/interfaces/services/IWalletMensajeroFeedService";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService } from "@/lib/interfaces/services/IWalletFeedService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IWalletTiendaFeedService } from "@/lib/interfaces/services/IWalletTiendaFeedService";
import { ANCLAJE_DEVOLUCION } from "@/tests/fixtures/anclaje-devolucion";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 239 (T2.2, R4-R10) — EL ANCLAJE DE LA DEVOLUCION dentro de `resolverCierre`.
//
// Este archivo es, literalmente, «el que el comentario de `cierres-admin-repository.test.ts`
// prometia y no existia»: la escritura que la aprobacion hacia sobre las devoluciones del cierre
// (encender `gestion_aprobada`) vivio sin una sola asercion propia, y las dos suites que la
// EJECUTABAN la filtraban fuera por la forma de su `where`. Asi es como el fallo llego a `dev`
// con el arbol verde (`progress/auditoria_ayuda_tienda.md` §3).
//
// Lo que se afirma aqui:
//   R4  la aprobacion ANCLA (`devolucion_por_confirmar -> devuelta`) en la MISMA tx;
//   R5  la gestion que ya NO es la vigente mas reciente de su orden NO se ancla — LA CARRERA
//       QUE CUESTA DINERO;
//   R6  un RECHAZO no mueve ninguna orden ni registra anclaje;
//   R7  el append lleva actor = el admin, familia `anclaje_devolucion` y enlaza la gestion ancla;
//   R8  segunda aprobacion: `count = 0`, sin segundo anclaje ni segunda fila de historial;
//   R10 money-neutral: el `data` del updateMany lleva SOLO `estatusId`.

const ALCANCE_MAESTRO = { destinoTipo: "bodega_central" as const, destinoZonaId: null };

const PRE = ANCLAJE_DEVOLUCION.preEstadoId;
const DEVUELTA = ANCLAJE_DEVOLUCION.devueltaId;

interface GestionFila {
  id: string;
  ordenId: string;
  cierreId: string | null;
  resultado: string;
  anuladaAt: Date | null;
  createdAt: Date;
}

/** Dobles de wallet: feeds vacios -> la tx no mueve dinero y el bloque queda aislado. */
function buildWalletDeps() {
  const walletMovimientoRepo: IWalletMovimientoRepository = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listar: vi.fn(),
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
    obtenerPorOrigen: vi.fn(),
    crearMovimientoRegistrado: vi.fn().mockResolvedValue(1), // ficha 362: solo lo decidido por un humano // ficha 333: lectura por la clave del libro; este camino no la usa
  };
  const walletFeedService: IWalletFeedService = {
    construirMovimientosDeIngreso: vi.fn().mockResolvedValue([]),
  };
  const walletTiendaMovimientoRepo: IWalletTiendaMovimientoRepository = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listarPorTienda: vi.fn(),
    agregarSaldoPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
    // ficha 335: doble no-op; esta suite no abre el selector de cierres.
    listarCierresDeTienda: vi.fn(async () => []),
    // Ficha 344: la lectura por id acotada a la tienda. Este doble no la ejercita.
    obtenerPorIdDeTienda: vi.fn(async () => null),
  };
  const walletTiendaFeedService: IWalletTiendaFeedService = {
    construirMovimientosPorTienda: vi.fn().mockResolvedValue([]),
  };
  const pagoMensajeroMovimientoRepo: IPagoMensajeroMovimientoRepository = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listarPorMensajero: vi.fn(),
    agregarCuentaPorPagar: vi.fn(),
    listarCuentasPorPagarTodos: vi.fn(),
    listarCuentasPorPagarPaginado: vi.fn(),
    listarCuentasPorPagarCompleto: vi.fn(),
    obtenerNombreMensajero: vi.fn(),
    // 293/T2.2-T3.3: los dos metodos NUEVOS del contrato (lectura). No-op aqui: este
    // doble no ejercita el premio.
    sumarPremiosVivosPorCierre: vi.fn(async () => ({})),
    listarPremiosPorDias: vi.fn(async () => []),
  };
  const walletMensajeroFeedService: IWalletMensajeroFeedService = {
    construirMovimientosDePago: vi.fn().mockResolvedValue({ libro: [], egresoCaja: [] }),
  };
  return {
    walletMovimientoRepo,
    walletFeedService,
    walletTiendaMovimientoRepo,
    walletTiendaFeedService,
    pagoMensajeroMovimientoRepo,
    walletMensajeroFeedService,
  };
}

/**
 * «Base» en memoria con las DOS tablas que el bloque toca.
 *
 * `gestionOrden.findMany` honra el `where` COMPLETO (cierreId / resultado / anuladaAt /
 * ordenId.in) y respeta el `orderBy` por `createdAt`. No es celo: la comprobacion de recencia
 * —la mitigacion de la carrera— se apoya en ese orden, y un doble que devolviera siempre la
 * misma lista dejaria pasar una version del bloque que no ordenara nada.
 *
 * `orden.updateMany` honra la GUARDA `estatusId`, que es lo que da la idempotencia. Un doble que
 * devolviera `{count: 1}` a ciegas haria pasar en verde una version SIN guarda.
 */
function buildBase(gestiones: GestionFila[], estados: Record<string, string>) {
  const ordenes = { ...estados };
  const gestionOrden = {
    findMany: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: {
          cierreId?: string;
          resultado?: string;
          anuladaAt?: Date | null;
          ordenId?: { in?: string[] };
        };
        orderBy?: Array<Record<string, "asc" | "desc">>;
      }) => {
        const filas = gestiones.filter(
          (g) =>
            (where.cierreId === undefined || g.cierreId === where.cierreId) &&
            (where.resultado === undefined || g.resultado === where.resultado) &&
            (where.anuladaAt === undefined || g.anuladaAt === where.anuladaAt) &&
            (where.ordenId?.in === undefined || where.ordenId.in.includes(g.ordenId)),
        );
        if (orderBy) {
          const dirCreated = orderBy.find((o) => "createdAt" in o)?.createdAt;
          filas.sort((a, b) => {
            if (a.ordenId !== b.ordenId) return a.ordenId < b.ordenId ? -1 : 1;
            const delta = a.createdAt.getTime() - b.createdAt.getTime();
            return dirCreated === "desc" ? -delta : delta;
          });
        }
        return filas.map((g) => ({ id: g.id, ordenId: g.ordenId }));
      },
    ),
  };
  const orden = {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id?: { in?: string[] }; estatusId?: string; deletedAt?: Date | null };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const [id, estatusId] of Object.entries(ordenes)) {
          if (where.id?.in !== undefined && !where.id.in.includes(id)) continue;
          if (where.estatusId !== undefined && estatusId !== where.estatusId) continue;
          ordenes[id] = data.estatusId as string;
          count += 1;
        }
        return { count };
      },
    ),
  };
  const prisma = {
    cierreDia: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(1),
      // FICHA 362: `resolverCierre` lee ademas el total y el mensajero para congelar la etiqueta
      // y el importe de la fila del registro.
      findUnique: vi.fn().mockResolvedValue({
        mensajeroId: "m1",
        totalGeneral: new Prisma.Decimal("0.00"),
        solicitadoAt: new Date("2026-09-02T12:00:00Z"),
        mensajero: { nombre: "Mensa", primerApellido: "Uno" },
      }),
    },
    // FICHA 362: el registro de la decision, en la MISMA tx.
    historialAccion: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    usuario: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ nombre: "Admin", primerApellido: "Uno", rol: { value: "admin" } }),
    },
    gestionOrden,
    orden,
    ordenHistorialEstado: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  return { prisma, ordenes };
}

function makeRepo(prisma: Record<string, unknown>) {
  const wallet = buildWalletDeps();
  const withTx = {
    ...prisma,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
  return new CierresAdminRepository(
    withTx as unknown as PrismaClient,
    wallet.walletMovimientoRepo,
    wallet.walletFeedService,
    wallet.walletTiendaMovimientoRepo,
    wallet.walletTiendaFeedService,
    wallet.pagoMensajeroMovimientoRepo,
    wallet.walletMensajeroFeedService,
    { construirEgresoIndemnizacion: vi.fn(async () => []) },
  );
}

function aprobar(repo: CierresAdminRepository, cierreId = "c1") {
  return repo.resolverCierre({
    cierreId,
    alcance: ALCANCE_MAESTRO,
    nuevoEstado: "aprobado",
    resueltoPor: "adm-maestro",
    motivoRechazo: null,
    anclajeDevolucion: ANCLAJE_DEVOLUCION,
    confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
  });
}

const T0 = new Date("2026-08-19T10:00:00.000Z");
const T1 = new Date("2026-08-19T15:00:00.000Z");

beforeEach(async () => {
  // Feature 140: la guardia del choke point es de FALLO CERRADO. Con el catalogo real, el par
  // `devolucion_por_confirmar -> devuelta` se valida de verdad contra `TRANSICIONES`.
  await sembrarCatalogoEstados();
});

describe("resolverCierre — ANCLAJE de la devolucion (239/R4/R7/R10)", () => {
  it("R4: al aprobar, la devolucion de ESTE cierre pasa a `devuelta` en la misma tx", async () => {
    const { prisma, ordenes } = buildBase(
      [
        { id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 },
        // Testigo 1: MISMA orden no, OTRO cierre. Sin la guardia `cierreId`, aprobar c1
        // anclaria tambien esta.
        { id: "g9", ordenId: "o9", cierreId: "c2", resultado: "devuelta", anuladaAt: null, createdAt: T0 },
        // Testigo 2: MISMO cierre, otro resultado. Una entrega no se ancla.
        { id: "g2", ordenId: "o2", cierreId: "c1", resultado: "entregada", anuladaAt: null, createdAt: T0 },
      ],
      { o1: PRE, o2: idEstado("entregada"), o9: PRE },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("updated");
    expect(ordenes).toEqual({ o1: DEVUELTA, o2: idEstado("entregada"), o9: PRE });

    // El WHERE tal cual sale del repositorio: ids derivados de ESTE cierre + GUARDA por el
    // pre-estado (R4a) + no borrada.
    const updates = prisma.orden.updateMany.mock.calls.map((c) => c[0]);
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({
      id: { in: ["o1"] },
      estatusId: PRE,
      deletedAt: null,
    });
  });

  it("R10: money-neutral — el `data` lleva SOLO `estatusId`", async () => {
    const { prisma } = buildBase(
      [{ id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 }],
      { o1: PRE },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    const data = prisma.orden.updateMany.mock.calls[0][0].data;
    // Igualdad EXACTA, no `toMatchObject`: lo que se afirma es que no hay NADA mas. A diferencia
    // de la liberacion 109, el anclaje no limpia mensajero ni marca prioridad — la devolucion se
    // queda donde esta; lo unico que cambia es que ya esta confirmada.
    expect(data).toEqual({ estatusId: DEVUELTA });
    expect(data).not.toHaveProperty("montoCobrar");
    expect(data).not.toHaveProperty("mensajeroAsignadoId");
    expect(data).not.toHaveProperty("prioridad");
  });

  it("R7: el append lleva actor = el admin, `anclaje_devolucion` y ENLAZA la gestion ancla", async () => {
    const { prisma } = buildBase(
      [{ id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 }],
      { o1: PRE },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    const entradas = prisma.ordenHistorialEstado.createMany.mock.calls.flatMap((c) => c[0].data);
    expect(entradas).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: PRE,
        estatusDestinoId: DEVUELTA,
        actorUsuarioId: "adm-maestro", // R7: el admin que aprobo
        origenTipo: "anclaje_devolucion", // R7: familia propia (P8)
        motivo: null,
        // No es decorativo: es lo que permite auditar QUE devolucion se confirmo con QUE
        // aprobacion sin volver a derivarlo.
        gestionOrdenId: "g1",
      },
    ]);
  });
});

describe("resolverCierre — LA CARRERA DE LOS DOS CIERRES (239/R5, design §4 carrera 1)", () => {
  // Secuencia real y completa: el mensajero A devuelve la orden (gestion g1, cierre C1, que
  // queda sin aprobar) -> un admin la recupera a bodega -> se reasigna -> el mensajero B la
  // vuelve a devolver (gestion g2, cierre C2). La orden esta en el pre-estado POR g2.
  //
  // Si ahora se aprueba C1 y la anclara, la devolucion NUEVA quedaria anclada con una aprobacion
  // ANTERIOR al hecho: el reloj de SLA arrancaria antes, el escalado a `rechazada` ocurriria
  // antes y SE COBRARIA EL RECHAZO ANTES DE TIEMPO. Es dinero real cobrado de mas a la tienda.
  const GESTIONES: GestionFila[] = [
    { id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 },
    { id: "g2", ordenId: "o1", cierreId: "c2", resultado: "devuelta", anuladaAt: null, createdAt: T1 },
  ];

  it("R5: aprobar el cierre VIEJO no ancla (su gestion ya no es la vigente mas reciente)", async () => {
    const { prisma, ordenes } = buildBase(GESTIONES, { o1: PRE });
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo, "c1"); // el cierre VIEJO

    expect(r).toBe("updated"); // el cierre si se aprueba: lo que no ocurre es el anclaje
    // La orden SIGUE en el pre-estado: su reloj no arranca y la tienda no la ve todavia.
    expect(ordenes).toEqual({ o1: PRE });
    // R5: «NO DEBE dejar rastro de anclaje para ella» — ni escritura ni fila de historial.
    expect(prisma.orden.updateMany).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R4c: aprobar el cierre NUEVO si ancla (su gestion ES la vigente mas reciente)", async () => {
    const { prisma, ordenes } = buildBase(GESTIONES, { o1: PRE });
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo, "c2"); // el cierre NUEVO

    expect(ordenes).toEqual({ o1: DEVUELTA });
    const entradas = prisma.ordenHistorialEstado.createMany.mock.calls.flatMap((c) => c[0].data);
    expect(entradas).toHaveLength(1);
    // Y ancla con la gestion CORRECTA: la nueva (g2), no la vieja.
    expect(entradas[0].gestionOrdenId).toBe("g2");
  });

  it("R5: la recencia se comprueba DENTRO de la transaccion, no antes", async () => {
    // La consulta de vigencia sale del MISMO `tx` que el resto del bloque. Si se resolviera
    // fuera, entre la lectura y el `updateMany` cabria otra devolucion y la carrera volveria.
    const { prisma } = buildBase(GESTIONES, { o1: PRE });
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo, "c1");

    const wheres = prisma.gestionOrden.findMany.mock.calls.map((c) => c[0].where);
    // (1) las gestiones `devuelta` VIGENTES de ESTE cierre — `cierreId` como GUARDIA;
    expect(wheres[0]).toEqual({ cierreId: "c1", resultado: "devuelta", anuladaAt: null });
    // (2) las vigentes de ESAS ordenes, para quedarse con la mas reciente de cada una.
    expect(wheres[1]).toEqual({
      ordenId: { in: ["o1"] },
      resultado: "devuelta",
      anuladaAt: null,
    });
    // UNA consulta para las N ordenes, no una por orden: un `findFirst` por orden seria un N+1
    // dentro de la transaccion mas caliente y mas cara del sistema.
    expect(prisma.gestionOrden.findMany).toHaveBeenCalledTimes(2);
    const orderBy = prisma.gestionOrden.findMany.mock.calls[1][0].orderBy;
    expect(orderBy).toEqual([{ ordenId: "asc" }, { createdAt: "desc" }]);
  });

  it("R5: una gestion ANULADA no cuenta como la mas reciente (no roba el anclaje)", async () => {
    // El mensajero deshizo la devolucion nueva. La vigente mas reciente vuelve a ser g1, asi que
    // aprobar C1 SI ancla. La vigencia se lee de `anuladaAt`, no de la fecha.
    const { prisma, ordenes } = buildBase(
      [
        { id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 },
        { id: "g2", ordenId: "o1", cierreId: "c2", resultado: "devuelta", anuladaAt: T1, createdAt: T1 },
      ],
      { o1: PRE },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo, "c1");

    expect(ordenes).toEqual({ o1: DEVUELTA });
    const entradas = prisma.ordenHistorialEstado.createMany.mock.calls.flatMap((c) => c[0].data);
    expect(entradas[0].gestionOrdenId).toBe("g1");
  });

  it("R5: con DOS ordenes en el cierre, se ancla la que toca y solo esa", async () => {
    // Grano fino: el recorte por recencia es POR ORDEN, no por cierre. `o1` perdio la carrera
    // (tiene una devolucion mas nueva en otro cierre) y `o2` no.
    const { prisma, ordenes } = buildBase(
      [
        { id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 },
        { id: "g2", ordenId: "o1", cierreId: "c2", resultado: "devuelta", anuladaAt: null, createdAt: T1 },
        { id: "g3", ordenId: "o2", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 },
      ],
      { o1: PRE, o2: PRE },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo, "c1");

    expect(ordenes).toEqual({ o1: PRE, o2: DEVUELTA });
    expect(prisma.orden.updateMany.mock.calls[0][0].where.id).toEqual({ in: ["o2"] });
    const entradas = prisma.ordenHistorialEstado.createMany.mock.calls.flatMap((c) => c[0].data);
    expect(entradas.map((e: { ordenId: string }) => e.ordenId)).toEqual(["o2"]);
  });
});

describe("resolverCierre — el anclaje NO ocurre cuando no debe (239/R6/R8)", () => {
  it("R6: RECHAZAR un cierre no mueve ninguna orden del pre-estado ni registra anclaje", async () => {
    const { prisma, ordenes } = buildBase(
      [{ id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 }],
      { o1: PRE },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    // El bloque vive DENTRO del `if (nuevoEstado === 'aprobado')`, y el tipo del input ni
    // siquiera admite `anclajeDevolucion` en la rama de rechazo (union discriminada).
    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "rechazado",
      resueltoPor: "adm-maestro",
      motivoRechazo: "cuadre",
    });

    expect(r).toBe("updated");
    expect(ordenes).toEqual({ o1: PRE });
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
    expect(prisma.orden.updateMany).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R8: una SEGUNDA aprobacion no produce un segundo anclaje ni una segunda fila", async () => {
    const { prisma, ordenes } = buildBase(
      [{ id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 }],
      { o1: PRE },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);

    await aprobar(repo); // misma transaccion, misma config

    // La GUARDA `estatusId = <pre-estado>` no encuentra nada -> `count = 0` -> sin append. No hay
    // codigo de idempotencia: la da el WHERE, igual que en los otros dos bloques de la tx.
    expect(ordenes).toEqual({ o1: DEVUELTA });
    expect(prisma.orden.updateMany).toHaveBeenCalledTimes(2); // se INTENTA las dos veces
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1); // y solo escribe una
  });

  it("R8: una orden que YA estaba en `devuelta` no se re-ancla (la guarda la deja fuera)", async () => {
    const { prisma, ordenes } = buildBase(
      [{ id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 }],
      { o1: DEVUELTA },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    expect(ordenes).toEqual({ o1: DEVUELTA });
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("cierre SIN devoluciones: no-op y CERO consultas extra", async () => {
    const { prisma } = buildBase(
      [{ id: "g1", ordenId: "o1", cierreId: "c1", resultado: "entregada", anuladaAt: null, createdAt: T0 }],
      { o1: idEstado("entregada") },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    // UNA sola consulta (la primera, que sale vacia): la segunda —la de recencia— ni se lanza.
    expect(prisma.gestionOrden.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orden.updateMany).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("count=0 (conflict): el cierre no transiciona, asi que nada se ancla", async () => {
    const { prisma, ordenes } = buildBase(
      [{ id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", anuladaAt: null, createdAt: T0 }],
      { o1: PRE },
    );
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("conflict");
    expect(ordenes).toEqual({ o1: PRE });
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
  });
});
