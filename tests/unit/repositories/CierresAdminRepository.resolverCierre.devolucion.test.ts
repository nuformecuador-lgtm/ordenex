import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { DevolucionRechazadasConfig } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService } from "@/lib/interfaces/services/IWalletFeedService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IWalletTiendaFeedService } from "@/lib/interfaces/services/IWalletTiendaFeedService";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletMensajeroFeedService } from "@/lib/interfaces/services/IWalletMensajeroFeedService";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 139 (T1.4) — DISPARO de la devolucion de RECHAZADAS al APROBAR el cierre, dentro de
// `CierresAdminRepository.resolverCierre` (mockea Prisma, sin DB real; molde del bloque de
// liberacion `sin_gestionar` de la 109). Cubre R5 (ruteo por zona), R6 (misma tx `aprobado`), R7
// (idempotencia: guarda por estatus_id=rechazada), R8 (money-neutral: no toca mensajero/prioridad),
// R10 (un rechazo no dispara), R11 (append `devolucion_rechazada` con actor=admin), R12 (una
// rechazada con mensajero intacto — origen SLA — es recogida por el findMany).

const ALCANCE_MAESTRO = { destinoTipo: "bodega_central" as const, destinoZonaId: null };

const DEVOLUCION: DevolucionRechazadasConfig = {
  rechazadaId: idEstado("rechazada"),
  porDevolverId: idEstado("por_devolver"), // destino satelite
  porDevolverATiendaId: idEstado("por_devolver_a_tienda"), // destino central
  centralZonaId: "z-central",
};

// Dobles de wallet (feeds vacios -> no-op) para el constructor + un $transaction que ejecuta el
// callback contra el propio doble (tx === prisma). Molde de cierres-admin-repository.test.ts.
function buildWalletDeps() {
  const walletMovimientoRepo: IWalletMovimientoRepository = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listar: vi.fn(),
    agregarBalance: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
  };
  const walletFeedService: IWalletFeedService = {
    construirMovimientosDeIngreso: vi.fn().mockResolvedValue([]),
  };
  const walletTiendaMovimientoRepo: IWalletTiendaMovimientoRepository = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listarPorTienda: vi.fn(),
    agregarSaldoPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
    // Feature 170 (T I.1): saldos paginados; doble no-op, esta suite no los lee.
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(), // feature 171: doble no-op, este test no lee el ledger
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
    obtenerNombreMensajero: vi.fn(),
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

// Prisma con lo que el bloque de devolucion + los wallets necesitan. SIN $queryRaw -> el emisor
// de webhooks del choke point es no-op. tx === prisma.
function buildDevolucionPrisma(
  rechazadas: { id: string; zonaId: string }[],
  opts: { mensajeroId?: string | null; movidas?: number } = {},
) {
  const prisma = {
    cierreDia: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    orden: { findMany: vi.fn(), updateMany: vi.fn() },
    ordenHistorialEstado: { createMany: vi.fn() },
  };
  prisma.cierreDia.findUnique.mockResolvedValue(
    opts.mensajeroId === null ? null : { mensajeroId: opts.mensajeroId ?? "m1" },
  );
  prisma.orden.findMany.mockResolvedValue(rechazadas);
  prisma.orden.updateMany.mockImplementation((args: { where: { id: { in: string[] } } }) =>
    Promise.resolve({ count: opts.movidas ?? args.where.id.in.length }),
  );
  prisma.ordenHistorialEstado.createMany.mockResolvedValue({ count: 0 });
  return prisma;
}

function makeRepo(prisma: Record<string, unknown>) {
  const wallet = buildWalletDeps();
  const withTx = {
    ...prisma,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
  const repo = new CierresAdminRepository(
    withTx as unknown as PrismaClient,
    wallet.walletMovimientoRepo,
    wallet.walletFeedService,
    wallet.walletTiendaMovimientoRepo,
    wallet.walletTiendaFeedService,
    wallet.pagoMensajeroMovimientoRepo,
    wallet.walletMensajeroFeedService,
    // Feature 158/T1.14: doble del feed del egreso de indemnizacion. Sin incidentes en esta
    // suite -> lista vacia -> no se emite ningun movimiento.
    { construirEgresoIndemnizacion: vi.fn(async () => []) },
  );
  return { repo, wallet };
}

function aprobar(repo: CierresAdminRepository) {
  return repo.resolverCierre({
    cierreId: "c1",
    alcance: ALCANCE_MAESTRO,
    nuevoEstado: "aprobado",
    resueltoPor: "adm-maestro",
    motivoRechazo: null,
    devolucionRechazadas: DEVOLUCION,
  });
}

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("CierresAdminRepository.resolverCierre — devolucion de `rechazada` (feature 139/R5-R11)", () => {
  it("R5: rutea por ZONA (central->por_devolver_a_tienda / satelite->por_devolver) con guarda estatus_id=rechazada", async () => {
    const prisma = buildDevolucionPrisma([
      { id: "o1", zonaId: "z-central" }, // -> por_devolver_a_tienda
      { id: "o2", zonaId: "z-sat" }, // -> por_devolver
    ]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("updated");
    // R5: pre-SELECT de las `rechazada` del mensajero del cierre.
    expect(prisma.orden.findMany.mock.calls[0][0].where).toEqual({
      mensajeroAsignadoId: "m1",
      estatusId: idEstado("rechazada"),
      deletedAt: null,
    });
    // dos updateMany (uno por destino), cada uno GUARDADO por estatus_id=rechazada.
    const calls = prisma.orden.updateMany.mock.calls.map((c) => c[0]);
    const central = calls.find((c) => c.data.estatusId === idEstado("por_devolver_a_tienda"));
    const sat = calls.find((c) => c.data.estatusId === idEstado("por_devolver"));
    expect(central.where).toEqual({ id: { in: ["o1"] }, estatusId: idEstado("rechazada"), deletedAt: null });
    expect(sat.where).toEqual({ id: { in: ["o2"] }, estatusId: idEstado("rechazada"), deletedAt: null });
  });

  it("R8: money-neutral — el updateMany SOLO cambia estatus_id (NO mensajero/asignado_at/prioridad)", async () => {
    const prisma = buildDevolucionPrisma([{ id: "o1", zonaId: "z-sat" }]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    const data = prisma.orden.updateMany.mock.calls[0][0].data;
    expect(data).toEqual({ estatusId: idEstado("por_devolver") });
    expect(data).not.toHaveProperty("mensajeroAsignadoId");
    expect(data).not.toHaveProperty("asignadoAt");
    expect(data).not.toHaveProperty("prioridad");
  });

  it("R11: append por el choke point con actor=admin + origen `devolucion_rechazada`", async () => {
    const prisma = buildDevolucionPrisma([{ id: "o1", zonaId: "z-sat" }]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    const entradas = prisma.ordenHistorialEstado.createMany.mock.calls.flatMap((c) => c[0].data);
    expect(entradas).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("rechazada"),
        estatusDestinoId: idEstado("por_devolver"),
        actorUsuarioId: "adm-maestro", // R11: el admin que aprobo
        origenTipo: "devolucion_rechazada", // R11
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("R12: una rechazada de origen SLA (con mensajero_asignado_id intacto) es recogida por el findMany", async () => {
    // El escalado SLA (99) NO limpia mensajero_asignado_id; la orden queda `rechazada` con su
    // mensajero. Cuando ese mensajero cierra y su cierre se aprueba, este findMany la recoge.
    const prisma = buildDevolucionPrisma([{ id: "o-sla", zonaId: "z-sat" }], { mensajeroId: "m-sla" });
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    // El WHERE del findMany usa el mensajero del cierre; una rechazada suya (venga de rechazo directo
    // o de escalado SLA) entra igual (elegibilidad por estado, agnostica del camino).
    expect(prisma.orden.findMany.mock.calls[0][0].where.mensajeroAsignadoId).toBe("m-sla");
    expect(prisma.orden.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.orden.updateMany.mock.calls[0][0].data).toEqual({ estatusId: idEstado("por_devolver") });
  });

  it("R7/no-op: cierre sin rechazadas (0 filas) -> no updateMany de orden ni append", async () => {
    const prisma = buildDevolucionPrisma([]); // el mensajero no tiene rechazadas
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("updated"); // la aprobacion (wallets) no se ve afectada
    expect(prisma.orden.updateMany).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R10: la devolucion SOLO corre en la rama `aprobado` — un rechazo NO dispara", async () => {
    const prisma = buildDevolucionPrisma([{ id: "o1", zonaId: "z-sat" }]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    // Aunque se pasara la config, el bloque vive DENTRO del `if (nuevoEstado === 'aprobado')`.
    await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "rechazado",
      resueltoPor: "adm-maestro",
      motivoRechazo: "cuadre",
      devolucionRechazadas: DEVOLUCION,
    });

    expect(prisma.orden.findMany).not.toHaveBeenCalled();
    expect(prisma.orden.updateMany).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R7: sin `devolucionRechazadas` en el input -> no dispara (aunque apruebe)", async () => {
    const prisma = buildDevolucionPrisma([{ id: "o1", zonaId: "z-sat" }]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });

  it("R7: count=0 (conflict) NO dispara aunque el destino sea aprobado", async () => {
    const prisma = buildDevolucionPrisma([{ id: "o1", zonaId: "z-sat" }]);
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreDia.count.mockResolvedValue(1);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("conflict");
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});
