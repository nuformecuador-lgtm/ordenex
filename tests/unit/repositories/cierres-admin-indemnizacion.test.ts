import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  CierresAdminRepository,
  IndemnizacionNoAplicableError,
} from "@/lib/repositories/CierresAdminRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 158 (T1.14, R22/R23/R26/R28) — la escritura de los montos y la emision del egreso,
// DENTRO de la transaccion de aprobacion. Doble de Prisma con la semantica del indice unico
// parcial `(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`, que es de donde
// sale la idempotencia real.

const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };
const G1 = "g-inc-1";
const G2 = "g-inc-2";

/**
 * Tienda en memoria del libro de la 42, con el indice unico parcial simulado. OJO: lo que
 * llega aqui es lo que el REPO de la 42 pasa a `createMany`, es decir el monto YA convertido a
 * `Prisma.Decimal` (money-safe). Se normaliza con `montoDe` para comparar como STRING.
 */
type FilaWallet = Omit<CrearMovimientoInput, "monto"> & { monto: unknown };

/** Monto de una fila del libro, normalizado a STRING escala 2 (nunca number). */
function montoDe(fila: FilaWallet): string {
  return new Prisma.Decimal(fila.monto as Prisma.Decimal).toFixed(2);
}

function walletStore() {
  const rows: FilaWallet[] = [];
  const seen = new Set<string>();
  const walletMovimiento = {
    createMany: vi.fn(
      async ({
        data,
        skipDuplicates,
      }: {
        data: CrearMovimientoInput[];
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const d of data) {
          if (d.origenId !== null) {
            const k = `${d.origenTipo}|${d.origenId}|${d.categoria}`;
            if (seen.has(k)) {
              if (skipDuplicates) continue;
              throw new Error(`unique violation ${k}`);
            }
            seen.add(k);
          }
          rows.push(d);
          count += 1;
        }
        return { count };
      },
    ),
  };
  return { rows, walletMovimiento };
}

/**
 * Doble de Prisma con las gestiones `incidente` del cierre EN MEMORIA. El `updateMany` honra
 * la guardia `(id, cierreId, resultado)` igual que la base: es la propiedad que se quiere
 * probar, asi que el doble no puede ser mas permisivo que Postgres.
 */
function buildPrisma(
  gestiones: Array<{ id: string; cierreId: string; resultado: string; indemnizacion: Prisma.Decimal | null }>,
  store: ReturnType<typeof walletStore>,
  opts: { updateCierreCount?: number } = {},
) {
  const prisma = {
    cierreDia: {
      updateMany: vi.fn(async () => ({ count: opts.updateCierreCount ?? 1 })),
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async () => ({ mensajeroId: "m1" })),
    },
    gestionOrden: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; cierreId: string; resultado: string };
          data: { indemnizacion: Prisma.Decimal };
        }) => {
          const g = gestiones.find(
            (x) =>
              x.id === where.id && x.cierreId === where.cierreId && x.resultado === where.resultado,
          );
          if (!g) return { count: 0 };
          g.indemnizacion = data.indemnizacion;
          return { count: 1 };
        },
      ),
      findMany: vi.fn(async (args?: { where?: { cierreId?: string; resultado?: string } }) =>
        gestiones.filter(
          (g) =>
            (args?.where?.cierreId === undefined || g.cierreId === args.where.cierreId) &&
            (args?.where?.resultado === undefined || g.resultado === args.where.resultado),
        ),
      ),
    },
    cierreDetail: { findMany: vi.fn(async () => []) },
    orden: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    walletMovimiento: store.walletMovimiento,
  };
  return {
    ...prisma,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
}

function buildRepo(prisma: ReturnType<typeof buildPrisma>) {
  return new CierresAdminRepository(
    prisma as unknown as PrismaClient,
    new WalletMovimientoRepository(prisma as unknown as PrismaClient),
    { construirMovimientosDeIngreso: vi.fn(async () => []) },
    { crearMovimientos: vi.fn(async () => 0), listarPorTienda: vi.fn(), agregarSaldoPorTienda: vi.fn(), listarSaldosTodasTiendas: vi.fn() },
    { construirMovimientosPorTienda: vi.fn(async () => []) },
    { crearMovimientos: vi.fn(async () => 0), listarPorMensajero: vi.fn(), agregarCuentaPorPagar: vi.fn(), listarCuentasPorPagarTodos: vi.fn(), obtenerNombreMensajero: vi.fn() },
    { construirMovimientosDePago: vi.fn(async () => ({ libro: [], egresoCaja: [] })) },
    // Feed REAL: es justo lo que se quiere ejercitar (lee de la tx lo recien escrito).
    new WalletIndemnizacionFeedService(),
  );
}

function gestionesIncidente() {
  return [
    { id: G1, cierreId: "c1", resultado: "incidente", indemnizacion: null as Prisma.Decimal | null },
    { id: G2, cierreId: "c1", resultado: "incidente", indemnizacion: null as Prisma.Decimal | null },
  ];
}

function aprobar(
  repo: CierresAdminRepository,
  indemnizaciones?: ReadonlyArray<{ gestionId: string; monto: string }>,
) {
  return repo.resolverCierre({
    cierreId: "c1",
    alcance: ALCANCE,
    nuevoEstado: "aprobado",
    resueltoPor: "adm",
    motivoRechazo: null,
    indemnizaciones,
  });
}

describe("R22 — persistir los montos y emitir el egreso, en la MISMA transaccion", () => {
  it("escribe cada monto en su gestion y emite UN egreso con la SUMA", async () => {
    const gestiones = gestionesIncidente();
    const store = walletStore();
    const prisma = buildPrisma(gestiones, store);

    const res = await aprobar(buildRepo(prisma), [
      { gestionId: G1, monto: "12500.75" },
      { gestionId: G2, monto: "300.25" },
    ]);

    expect(res).toBe("updated");
    // Una sola transaccion envuelve TODO (todo-o-nada).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Los montos quedan persistidos como Decimal (money-safe).
    expect(gestiones[0].indemnizacion?.toFixed(2)).toBe("12500.75");
    expect(gestiones[1].indemnizacion?.toFixed(2)).toBe("300.25");
    // Y UN solo egreso, con la suma exacta.
    const egresos = store.rows.filter((m) => m.categoria === "egreso_indemnizacion");
    expect(egresos).toHaveLength(1);
    expect(egresos[0]).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_indemnizacion",
      origenTipo: "cierre_dia",
      origenId: "c1",
    });
    expect(montoDe(egresos[0])).toBe("12801.00");
  });

  it("R22: el WHERE de la escritura es una GUARDIA (id + cierreId + resultado), no un filtro", async () => {
    const gestiones = gestionesIncidente();
    const store = walletStore();
    const prisma = buildPrisma(gestiones, store);

    await aprobar(buildRepo(prisma), [{ gestionId: G1, monto: "1.00" }, { gestionId: G2, monto: "1.00" }]);

    const calls = (prisma.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].where).toEqual({ id: G1, cierreId: "c1", resultado: "incidente" });
    expect(calls[1][0].where).toEqual({ id: G2, cierreId: "c1", resultado: "incidente" });
  });

  it("R21/R22: un monto que NO aplica lanza y NADA queda aplicado (rollback)", async () => {
    const gestiones = gestionesIncidente();
    const store = walletStore();
    const prisma = buildPrisma(gestiones, store);

    // `g-ajena` no pertenece al cierre: la guardia del WHERE deja `count = 0`.
    await expect(
      aprobar(buildRepo(prisma), [
        { gestionId: G1, monto: "100.00" },
        { gestionId: "g-ajena", monto: "999999.00" },
      ]),
    ).rejects.toBeInstanceOf(IndemnizacionNoAplicableError);

    // El error se propaga ANTES de que ningun feed corra -> ni un movimiento emitido.
    expect(store.rows).toHaveLength(0);
  });

  it("el error de la escritura guardada NO filtra PII (ni gestion, ni monto, ni actor)", () => {
    const error = new IndemnizacionNoAplicableError("c1");
    expect(error.message).toBe("indemnizacion no aplicable a una gestion del cierre c1");
    expect(error.message).not.toMatch(/g-inc|999999|adm/);
  });

  it("R22: la escritura de los montos va ANTES que el feed (el feed lee lo que ella escribio)", async () => {
    const gestiones = gestionesIncidente();
    const store = walletStore();
    const prisma = buildPrisma(gestiones, store);
    const orden: string[] = [];
    (prisma.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where, data }: { where: { id: string }; data: { indemnizacion: Prisma.Decimal } }) => {
        orden.push(`write:${where.id}`);
        const g = gestiones.find((x) => x.id === where.id);
        if (!g) return { count: 0 };
        g.indemnizacion = data.indemnizacion;
        return { count: 1 };
      },
    );
    (prisma.gestionOrden.findMany as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      orden.push("read");
      return gestiones.filter((g) => g.resultado === "incidente");
    });

    await aprobar(buildRepo(prisma), [{ gestionId: G1, monto: "5.00" }]);

    expect(orden.indexOf("write:g-inc-1")).toBeLessThan(orden.indexOf("read"));
  });
});

describe("R23 — el RECHAZO no escribe montos ni emite movimientos", () => {
  it("rechazar con `indemnizaciones` presentes NO las aplica (vive dentro de la rama aprobado)", async () => {
    const gestiones = gestionesIncidente();
    const store = walletStore();
    const prisma = buildPrisma(gestiones, store);

    const res = await buildRepo(prisma).resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE,
      nuevoEstado: "rechazado",
      resueltoPor: "adm",
      motivoRechazo: "no cuadra",
      indemnizaciones: [{ gestionId: G1, monto: "100.00" }],
    });

    expect(res).toBe("updated");
    expect(prisma.gestionOrden.updateMany).not.toHaveBeenCalled();
    expect(gestiones[0].indemnizacion).toBeNull();
    expect(store.rows).toHaveLength(0);
  });
});

describe("R27/R28 — sin incidentes no hay fila; reintentar no duplica", () => {
  it("R27: cierre sin gestiones `incidente` -> NINGUN movimiento de indemnizacion", async () => {
    const store = walletStore();
    const prisma = buildPrisma([], store);

    await aprobar(buildRepo(prisma), []);

    expect(store.rows.filter((m) => m.categoria === "egreso_indemnizacion")).toHaveLength(0);
  });

  it("R28: aprobar DOS veces el mismo cierre emite UN solo egreso (indice unico parcial)", async () => {
    const gestiones = gestionesIncidente();
    const store = walletStore();
    const prisma = buildPrisma(gestiones, store);
    const repo = buildRepo(prisma);

    await aprobar(repo, [{ gestionId: G1, monto: "100.00" }, { gestionId: G2, monto: "50.00" }]);
    const trasPrimera = store.rows.length;
    // Segunda pasada: la guardia real del cierre (estado) ya no casaria, pero aunque casara,
    // el indice unico parcial deduplica el egreso.
    await aprobar(repo, [{ gestionId: G1, monto: "100.00" }, { gestionId: G2, monto: "50.00" }]);

    expect(store.rows.length).toBe(trasPrimera);
    const egresos = store.rows.filter((m) => m.categoria === "egreso_indemnizacion");
    expect(egresos).toHaveLength(1);
    expect(montoDe(egresos[0])).toBe("150.00");
  });

  it("R28: el segundo intento NO altera el monto ya emitido, aunque manden otro", async () => {
    const gestiones = gestionesIncidente();
    const store = walletStore();
    const prisma = buildPrisma(gestiones, store);
    const repo = buildRepo(prisma);

    await aprobar(repo, [{ gestionId: G1, monto: "100.00" }, { gestionId: G2, monto: "50.00" }]);
    await aprobar(repo, [{ gestionId: G1, monto: "999999.00" }, { gestionId: G2, monto: "1.00" }]);

    const egresos = store.rows.filter((m) => m.categoria === "egreso_indemnizacion");
    expect(egresos).toHaveLength(1);
    expect(montoDe(egresos[0])).toBe("150.00"); // el movimiento emitido NO se toca
  });

  it("un cierre que NO se aprueba (guardia perdida) no escribe montos ni emite", async () => {
    const gestiones = gestionesIncidente();
    const store = walletStore();
    // `count = 0`: el cierre ya no estaba `solicitado` (carrera / doble submit).
    const prisma = buildPrisma(gestiones, store, { updateCierreCount: 0 });

    const res = await aprobar(buildRepo(prisma), [{ gestionId: G1, monto: "100.00" }]);

    expect(res).toBe("conflict");
    expect(prisma.gestionOrden.updateMany).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });
});

describe("R25 — la lectura de incidentes va acotada por alcance en el WHERE", () => {
  it("findGestionesIncidenteDelCierre filtra por cierre, resultado Y alcance", async () => {
    const gestiones = gestionesIncidente();
    const store = walletStore();
    const prisma = buildPrisma(gestiones, store);
    const repo = buildRepo(prisma);

    const ids = await repo.findGestionesIncidenteDelCierre("c1", {
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-sat",
    });

    expect(ids).toEqual([G1, G2]);
    const arg = (prisma.gestionOrden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      where: Record<string, unknown>;
      select: unknown;
    };
    expect(arg.where).toEqual({
      cierreId: "c1",
      resultado: "incidente",
      // El alcance viaja por la RELACION al cierre: nunca se filtra en memoria.
      cierre: { destinoTipo: "bodega_satelite", destinoZonaId: "z-sat" },
    });
    expect(arg.select).toEqual({ id: true });
  });

  it("el alcance del maestro NO acota por zona (ve todos los `bodega_central`)", async () => {
    const store = walletStore();
    const prisma = buildPrisma([], store);
    await buildRepo(prisma).findGestionesIncidenteDelCierre("c1", ALCANCE);
    const arg = (prisma.gestionOrden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      where: { cierre: Record<string, unknown> };
    };
    expect(arg.where.cierre).toEqual({ destinoTipo: "bodega_central" });
    expect(arg.where.cierre).not.toHaveProperty("destinoZonaId");
  });
});
