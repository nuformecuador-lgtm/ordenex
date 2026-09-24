import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletMensajeroFeedService } from "@/lib/interfaces/services/IWalletMensajeroFeedService";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService } from "@/lib/interfaces/services/IWalletFeedService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IWalletTiendaFeedService } from "@/lib/interfaces/services/IWalletTiendaFeedService";
import { APLICACION_GESTIONES } from "@/tests/fixtures/anclaje-devolucion";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// FICHA 454 (T1.7, design §7; R7-R14) — LA APLICACION DE GESTIONES dentro de `resolverCierre`.
//
// ⏳ 2026-09-23 — DE DONDE VIENE ESTE ARCHIVO. Era `cierres-admin-anclaje-devolucion.test.ts`
// (feature 239): el ANCLAJE que, al aprobar, llevaba `devolucion_por_confirmar -> devuelta`. La
// 454 lo GENERALIZA: la gestion de calle ya no mueve la orden al registrarse (la deja
// `en_reparto`), y la aprobacion aplica el estado real de los CINCO resultados. El pre-estado
// muere. Cada garantia de la 239 tiene aqui su heredera, caso a caso:
//   239/R4  (ancla en la misma tx)          -> 454/R7  (aplica en la misma tx)
//   239/R5  (la carrera de los dos cierres) -> 454/R7/R9 (solo la vigente MAS RECIENTE)
//   239/R6  (rechazar no ancla)             -> 454/R13
//   239/R7  (actor admin + familia propia)  -> 454/R8  (familia y actor por resultado)
//   239/R8  (segunda aprobacion)            -> 454/R12 (idempotente por la guarda de estado)
//   239/R10 (money-neutral)                 -> igual: el UPDATE lleva SOLO `estatus_id`
// y se suma 454/R14: las gestiones LEGADAS (sin evento de registro) no se re-aplican.
//
// Lo que un doble NO puede probar —el SQL del `UPDATE … RETURNING` ejecutado de verdad, el orden
// frente a los feeds de dinero y a la 139, la atomicidad— se mide contra Postgres en
// `tests/integration/db/454/` (caracterizacion C08-C13 y `aplicacion-al-aprobar-sql-real`).

const ALCANCE_MAESTRO = { destinoTipo: "bodega_central" as const, destinoZonaId: null };

const EN_REPARTO = idEstado("en_reparto");

type Familia = "gestion" | "incidente" | "gestion_tienda_ayuda";

interface GestionFila {
  id: string;
  ordenId: string;
  cierreId: string | null;
  resultado: "entregada" | "reprogramada" | "rechazada" | "devuelta" | "incidente";
  anuladaAt: Date | null;
  createdAt: Date;
  mensajeroId: string;
  motivo: string | null;
  /** `null` = gestion LEGADA (sin evento `gestion_registrada`). */
  registro: { familia: Familia; actor: string } | null;
}

function fila(p: Partial<GestionFila> & Pick<GestionFila, "id" | "ordenId">): GestionFila {
  return {
    cierreId: "c1",
    resultado: "entregada",
    anuladaAt: null,
    createdAt: T0,
    mensajeroId: "m1",
    motivo: null,
    registro: { familia: "gestion", actor: "m1" },
    ...p,
  };
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
    registrarCobroEnHistorial: vi.fn(async () => undefined), // exigido por IWalletTiendaMovimientoRepository (ficha 381); no ejercitado aqui
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

interface WhereGestion {
  cierreId?: string;
  anuladaAt?: Date | null;
  ordenId?: { in?: string[] };
  eventos?: { some?: { tipo?: string } };
  resultado?: string;
}

/** El texto de una sentencia `$queryRaw` (plantilla etiquetada: el primer argumento). */
function textoSql(c: unknown[]): string {
  return (c[0] as readonly string[]).join(" ? ");
}

/**
 * «Base» en memoria con las tablas que el bloque toca.
 *
 * `gestionOrden.findMany` honra el `where` COMPLETO (cierreId / anuladaAt / ordenId.in / el filtro
 * de «gestion de calle con evento de registro») y el `orderBy` por `createdAt`: la recencia —la
 * mitigacion de la carrera— se apoya en ese orden. Proyecta `eventos` SOLO si el `select` los pide.
 *
 * `$queryRaw` emula el `UPDATE "orden" SET "estatus_id" = $destino WHERE "id" IN (…) AND
 * "estatus_id" = $enReparto … RETURNING "id"` honrando la GUARDA de estado, que es la
 * idempotencia. Un doble que devolviera todas las ids a ciegas haria pasar una version SIN guarda.
 * Cualquier otra sentencia (el emisor de webhooks del choke point) recibe `[]`: sin suscripciones.
 */
function buildBase(gestiones: GestionFila[], estados: Record<string, string>) {
  const ordenes = { ...estados };
  const gestionOrden = {
    findMany: vi.fn(
      async ({
        where,
        orderBy,
        select,
      }: {
        where: WhereGestion;
        orderBy?: Array<Record<string, "asc" | "desc">>;
        select?: Record<string, unknown>;
      }) => {
        const filas = gestiones.filter(
          (g) =>
            (where.cierreId === undefined || g.cierreId === where.cierreId) &&
            (where.resultado === undefined || g.resultado === where.resultado) &&
            (where.anuladaAt === undefined || g.anuladaAt === where.anuladaAt) &&
            (where.ordenId?.in === undefined || where.ordenId.in.includes(g.ordenId)) &&
            (where.eventos?.some?.tipo !== "gestion_registrada" || g.registro !== null),
        );
        if (orderBy) {
          const dirCreated = orderBy.find((o) => "createdAt" in o)?.createdAt;
          filas.sort((a, b) => {
            if (a.ordenId !== b.ordenId) return a.ordenId < b.ordenId ? -1 : 1;
            const delta = a.createdAt.getTime() - b.createdAt.getTime();
            return dirCreated === "desc" ? -delta : delta;
          });
        }
        return filas.map((g) => ({
          id: g.id,
          ordenId: g.ordenId,
          resultado: g.resultado,
          mensajeroId: g.mensajeroId,
          motivo: g.motivo,
          ...(select && "eventos" in select
            ? {
                eventos: g.registro
                  ? [
                      {
                        id: `ev-${g.id}`,
                        familiaAplicacion: g.registro.familia,
                        actorUsuarioId: g.registro.actor,
                      },
                    ]
                  : [],
              }
            : {}),
        }));
      },
    ),
  };
  const $queryRaw = vi.fn(async (...c: unknown[]) => {
    if (!textoSql(c).includes('UPDATE "orden" SET "estatus_id" =')) return [];
    const destinoId = c[1] as string;
    const ids = (c[2] as { values: string[] }).values;
    // La guarda se lee del TEXTO: si la sentencia la perdiera, el doble movera sin mirar el estado
    // (como Postgres) en vez de dejar de mover por un parametro corrido.
    const conGuarda = textoSql(c).replace(/\s+/g, " ").includes('AND "estatus_id" = ?');
    const guarda = c[3] as string;
    const movidas: { id: string }[] = [];
    for (const id of ids) {
      if (conGuarda && ordenes[id] !== guarda) continue;
      ordenes[id] = destinoId;
      movidas.push({ id });
    }
    return movidas;
  });
  const prisma = {
    $queryRaw,
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
    orden: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ordenHistorialEstado: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  return { prisma, ordenes };
}

/** Las llamadas a `$queryRaw` que son el UPDATE de la aplicacion (no las del emisor). */
function updatesDeAplicacion(prisma: { $queryRaw: ReturnType<typeof vi.fn> }): unknown[][] {
  return (prisma.$queryRaw.mock.calls as unknown[][]).filter((c) =>
    textoSql(c).includes('UPDATE "orden" SET "estatus_id" ='),
  );
}

function entradasHistorial(prisma: {
  ordenHistorialEstado: { createMany: ReturnType<typeof vi.fn> };
}): Record<string, unknown>[] {
  return (
    prisma.ordenHistorialEstado.createMany.mock.calls as unknown as {
      data: Record<string, unknown>[];
    }[][]
  ).flatMap((c) => c[0].data);
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
    aplicacionGestiones: APLICACION_GESTIONES,
    confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar
  });
}

const T0 = new Date("2026-08-19T10:00:00.000Z");
const T1 = new Date("2026-08-19T15:00:00.000Z");

beforeEach(async () => {
  // Feature 140: la guardia del choke point es de FALLO CERRADO. Con el catalogo real, cada par
  // `en_reparto -> <destino>` se valida de verdad contra `TRANSICIONES`.
  await sembrarCatalogoEstados();
});

describe("resolverCierre — APLICACION de las gestiones de calle (454/R7/R8/R14)", () => {
  it("R7: cada gestion de calle de ESTE cierre lleva su orden de `en_reparto` a su destino, en la misma tx", async () => {
    const { prisma, ordenes } = buildBase(
      [
        fila({ id: "g1", ordenId: "o1", resultado: "entregada" }),
        fila({ id: "g2", ordenId: "o2", resultado: "devuelta" }),
        fila({ id: "g3", ordenId: "o3", resultado: "rechazada", motivo: "no quiso" }),
        // Testigo 1: OTRO cierre. Sin la guardia `cierreId`, aprobar c1 la aplicaria tambien.
        fila({ id: "g9", ordenId: "o9", cierreId: "c2", resultado: "entregada" }),
        // Testigo 2 (R14): gestion LEGADA del mismo cierre — ya transiciono al registrarse.
        fila({ id: "gL", ordenId: "oL", resultado: "entregada", registro: null }),
      ],
      { o1: EN_REPARTO, o2: EN_REPARTO, o3: EN_REPARTO, o9: EN_REPARTO, oL: idEstado("entregada") },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("updated");
    expect(ordenes).toEqual({
      o1: idEstado("entregada"),
      o2: idEstado("devuelta"),
      o3: idEstado("rechazada"),
      o9: EN_REPARTO,
      oL: idEstado("entregada"),
    });
    // La primera consulta: gestiones de calle VIGENTES de ESTE cierre (`cierreId` como GUARDIA).
    expect(prisma.gestionOrden.findMany.mock.calls[0][0].where).toEqual({
      cierreId: "c1",
      anuladaAt: null,
      eventos: { some: { tipo: "gestion_registrada" } },
    });
  });

  it("MONEY-NEUTRAL: el UPDATE escribe SOLO `estatus_id`, guardado por `en_reparto`", async () => {
    const { prisma } = buildBase([fila({ id: "g1", ordenId: "o1", resultado: "rechazada" })], {
      o1: EN_REPARTO,
    });
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    const updates = updatesDeAplicacion(prisma);
    expect(updates).toHaveLength(1);
    const sql = textoSql(updates[0]);
    // Lo que va entre `SET` y `WHERE`: una sola columna. Ni mensajero, ni prioridad, ni montos.
    const set = sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE"));
    expect(set.replace(/\s+/g, " ").trim()).toBe('SET "estatus_id" = ?');
    expect(sql.replace(/\s+/g, " ")).toContain('AND "estatus_id" = ?');
    expect(updates[0][3]).toBe(EN_REPARTO); // la GUARDA de estado
    expect(sql).toContain('"deleted_at" IS NULL');
    expect(sql).toContain('RETURNING "id"');
  });

  it("R8: familia y actor por resultado, enlazando la gestion", async () => {
    const { prisma } = buildBase(
      [
        fila({ id: "gE", ordenId: "oE", resultado: "entregada" }),
        fila({ id: "gD", ordenId: "oD", resultado: "devuelta", motivo: "no estaba" }),
        fila({
          id: "gI",
          ordenId: "oI",
          resultado: "incidente",
          motivo: "robo",
          registro: { familia: "incidente", actor: "m1" },
        }),
        fila({
          id: "gT",
          ordenId: "oT",
          resultado: "reprogramada",
          motivo: "otro dia",
          registro: { familia: "gestion_tienda_ayuda", actor: "u-tienda" },
        }),
      ],
      { oE: EN_REPARTO, oD: EN_REPARTO, oI: EN_REPARTO, oT: EN_REPARTO },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    const porOrden = Object.fromEntries(
      entradasHistorial(prisma).map((e) => [e.ordenId as string, e]),
    );
    expect(porOrden.oE).toEqual({
      ordenId: "oE",
      estatusOrigenId: EN_REPARTO,
      estatusDestinoId: idEstado("entregada"),
      actorUsuarioId: "m1", // el mensajero de la gestion
      origenTipo: "gestion",
      motivo: null,
      gestionOrdenId: "gE",
    });
    expect(porOrden.oD).toEqual({
      ordenId: "oD",
      estatusOrigenId: EN_REPARTO,
      estatusDestinoId: idEstado("devuelta"),
      actorUsuarioId: "adm-maestro", // D8: el APROBADOR — el reloj del plazo lee esta familia
      origenTipo: "anclaje_devolucion",
      motivo: null,
      gestionOrdenId: "gD",
    });
    expect(porOrden.oI).toMatchObject({
      estatusDestinoId: idEstado("incidente"),
      actorUsuarioId: "m1",
      origenTipo: "incidente",
      motivo: "robo",
      gestionOrdenId: "gI",
    });
    expect(porOrden.oT).toMatchObject({
      estatusDestinoId: idEstado("reprogramada"),
      actorUsuarioId: "u-tienda", // la PERSONA de la tienda que la registro
      origenTipo: "gestion_tienda_ayuda",
      motivo: "otro dia",
      gestionOrdenId: "gT",
    });
  });

  it("R14: un cierre con SOLO gestiones legadas no aplica nada — una consulta y fuera", async () => {
    const { prisma } = buildBase(
      [fila({ id: "gL", ordenId: "oL", resultado: "entregada", registro: null })],
      { oL: idEstado("entregada") },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    // UNA sola consulta (la primera, que sale vacia): la de recencia ni se lanza.
    expect(prisma.gestionOrden.findMany).toHaveBeenCalledTimes(1);
    expect(updatesDeAplicacion(prisma)).toHaveLength(0);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("resolverCierre — LA CARRERA DE LOS DOS CIERRES (454/R7/R9, heredera de 239/R5)", () => {
  // Secuencia real: el mensajero A gestiona la orden (g1, cierre C1, sin aprobar); el cierre se
  // rechaza o queda abierto; la gestion se deshace y se vuelve a gestionar (g2, cierre C2). Si
  // aprobar C1 aplicara g1, la orden recibiria el estado de una gestion que YA NO es la vigente.
  const GESTIONES: GestionFila[] = [
    fila({ id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", createdAt: T0 }),
    fila({ id: "g2", ordenId: "o1", cierreId: "c2", resultado: "devuelta", createdAt: T1 }),
  ];

  it("R9: aprobar el cierre VIEJO no aplica (su gestion ya no es la vigente mas reciente)", async () => {
    const { prisma, ordenes } = buildBase(GESTIONES, { o1: EN_REPARTO });
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo, "c1");

    expect(r).toBe("updated"); // el cierre si se aprueba (R9: «la aprobacion DEBE continuar»)
    expect(ordenes).toEqual({ o1: EN_REPARTO });
    expect(updatesDeAplicacion(prisma)).toHaveLength(0);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R7: aprobar el cierre NUEVO si aplica, con la gestion correcta", async () => {
    const { prisma, ordenes } = buildBase(GESTIONES, { o1: EN_REPARTO });
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo, "c2");

    expect(ordenes).toEqual({ o1: idEstado("devuelta") });
    const entradas = entradasHistorial(prisma);
    expect(entradas).toHaveLength(1);
    expect(entradas[0].gestionOrdenId).toBe("g2");
  });

  it("la recencia se comprueba DENTRO de la transaccion, en UNA consulta para las N ordenes", async () => {
    const { prisma } = buildBase(GESTIONES, { o1: EN_REPARTO });
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo, "c1");

    const wheres = prisma.gestionOrden.findMany.mock.calls.map((c) => c[0].where);
    expect(wheres[1]).toEqual({
      ordenId: { in: ["o1"] },
      anuladaAt: null,
      eventos: { some: { tipo: "gestion_registrada" } },
    });
    expect(prisma.gestionOrden.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.gestionOrden.findMany.mock.calls[1][0].orderBy).toEqual([
      { ordenId: "asc" },
      { createdAt: "desc" },
    ]);
  });

  it("una gestion ANULADA no cuenta como la mas reciente (no roba la aplicacion)", async () => {
    const { prisma, ordenes } = buildBase(
      [
        fila({ id: "g1", ordenId: "o1", cierreId: "c1", resultado: "devuelta", createdAt: T0 }),
        fila({
          id: "g2",
          ordenId: "o1",
          cierreId: "c2",
          resultado: "devuelta",
          anuladaAt: T1,
          createdAt: T1,
        }),
      ],
      { o1: EN_REPARTO },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo, "c1");

    expect(ordenes).toEqual({ o1: idEstado("devuelta") });
    expect(entradasHistorial(prisma)[0].gestionOrdenId).toBe("g1");
  });

  it("con DOS ordenes en el cierre, se aplica la que toca y solo esa", async () => {
    const { prisma, ordenes } = buildBase(
      [...GESTIONES, fila({ id: "g3", ordenId: "o2", cierreId: "c1", resultado: "devuelta" })],
      { o1: EN_REPARTO, o2: EN_REPARTO },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo, "c1");

    expect(ordenes).toEqual({ o1: EN_REPARTO, o2: idEstado("devuelta") });
    const updates = updatesDeAplicacion(prisma);
    expect(updates).toHaveLength(1);
    expect((updates[0][2] as { values: string[] }).values).toEqual(["o2"]);
    expect(entradasHistorial(prisma).map((e) => e.ordenId)).toEqual(["o2"]);
  });
});

describe("resolverCierre — la aplicacion NO ocurre cuando no debe (454/R9/R12/R13)", () => {
  it("R13: RECHAZAR un cierre no mueve ninguna orden ni registra transicion", async () => {
    const { prisma, ordenes } = buildBase(
      [fila({ id: "g1", ordenId: "o1", resultado: "devuelta" })],
      { o1: EN_REPARTO },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    // El tipo del input ni siquiera admite `aplicacionGestiones` en la rama de rechazo.
    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "rechazado",
      resueltoPor: "adm-maestro",
      motivoRechazo: "cuadre",
    });

    expect(r).toBe("updated");
    expect(ordenes).toEqual({ o1: EN_REPARTO });
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
    expect(updatesDeAplicacion(prisma)).toHaveLength(0);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R12: una SEGUNDA aprobacion no aplica otra vez ni escribe una segunda fila", async () => {
    const { prisma, ordenes } = buildBase(
      [fila({ id: "g1", ordenId: "o1", resultado: "devuelta" })],
      { o1: EN_REPARTO },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);

    await aprobar(repo);

    // La GUARDA `estatus_id = en_reparto` no encuentra nada -> sin append. La idempotencia la da
    // el WHERE, no un codigo aparte.
    expect(ordenes).toEqual({ o1: idEstado("devuelta") });
    expect(updatesDeAplicacion(prisma)).toHaveLength(2); // se INTENTA las dos veces
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1); // y escribe una
  });

  it("R9: una orden que YA no esta `en_reparto` no se toca (la guarda la deja fuera)", async () => {
    const { prisma, ordenes } = buildBase(
      [fila({ id: "g1", ordenId: "o1", resultado: "entregada" })],
      { o1: idEstado("en_bodega_central") },
    );
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("updated");
    expect(ordenes).toEqual({ o1: idEstado("en_bodega_central") });
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("count=0 (conflict): el cierre no transiciona, asi que nada se aplica", async () => {
    const { prisma, ordenes } = buildBase(
      [fila({ id: "g1", ordenId: "o1", resultado: "devuelta" })],
      { o1: EN_REPARTO },
    );
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    const repo = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("conflict");
    expect(ordenes).toEqual({ o1: EN_REPARTO });
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
  });
});
