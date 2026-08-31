import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { IncidenteAdminRepository } from "@/lib/repositories/IncidenteAdminRepository";
import { WalletIndemnizacionIncidenteFeedService } from "@/lib/services/WalletIndemnizacionIncidenteFeedService";
import { ORIGENES_INCIDENTE_ADMIN } from "@/lib/services/IncidenteAdminService";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { OrderStatusValue } from "@/lib/types/order-status";

// Feature 158 (T1.26/T1.27, camino del ADMIN) — repositorio con Prisma mockeado (sin DB).
// Cubre R41-R44/R47 (reporte atomico y guardado), R52/R53 (aprobacion + egreso + idempotencia),
// R54/R57 (rechazo con reversion al origen) y R60 (la asignacion NO se toca).
//
// El choke point corre COMPLETO: se siembra el catalogo real (`sembrarCatalogoEstados`) y se
// usan ids `os-<value>`, asi que la guardia de la 140 valida los pares contra `TRANSICIONES` de
// verdad. Un par que no estuviera declarado (p. ej. si alguien retirara la arista #48) haria
// fallar estos tests, que es exactamente lo que debe pasar.

const ORDEN_ID = "o-1";
const INCIDENTE_ID = "inc-1";
const ACTOR = "u-admin";
const ORIGEN_IDS = ORIGENES_INCIDENTE_ADMIN.map((v) => idEstado(v));
const ID_INCIDENTE_ESTADO = idEstado("incidente");

const EVIDENCIAS = [
  { storagePath: "o-1/incidente-1-0.jpg", contentType: "image/jpeg", indice: 0 },
  { storagePath: "o-1/incidente-1-1.png", contentType: "image/png", indice: 1 },
];

/** Error P2002 con la forma que produce el driver adapter (`prisma-unique.ts`). */
function p2002(constraint: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "7",
    meta: {
      driverAdapterError: {
        cause: {
          originalMessage: `llave duplicada viola restriccion de unicidad «${constraint}»`,
        },
      },
    },
  });
}

interface DobleOpts {
  /** Estado ACTUAL de la orden; `null` = la pre-lectura no la encuentra (R42). */
  estatusOrden?: string | null;
  /** `count` del updateMany de la orden (para simular la carrera). */
  ordenUpdateCount?: number;
  /** Error a lanzar en el `create` del incidente (p. ej. el P2002 de R47). */
  errorCreate?: unknown;
  /**
   * Estado REAL del incidente en la "base". El doble de `updateMany` HONRA `where.estado`, asi
   * que un incidente que ya no esta `solicitado` da `count 0` — igual que Postgres. Es lo que
   * convierte la guardia de R53 en una afirmacion de COMPORTAMIENTO y no de forma.
   */
  estadoIncidente?: string;
}

function buildPrisma(opts: DobleOpts = {}) {
  const estatusOrden =
    opts.estatusOrden === undefined ? idEstado("en_bodega_central") : opts.estatusOrden;
  // Los dobles declaran su parametro (`void arg`) para que `mock.calls[i][0]` quede TIPADO: un
  // `vi.fn(async () => ...)` sin parametros lo tipa como tupla vacia y no se puede inspeccionar.
  type ArgWhere = { where: Record<string, unknown> };
  type ArgWhereData = { where: Record<string, unknown>; data: Record<string, unknown> };
  type ArgData = { data: Record<string, unknown> };
  const calls = {
    ordenFindFirst: vi.fn(async (arg: ArgWhere) => {
      void arg;
      return estatusOrden === null ? null : { estatusId: estatusOrden };
    }),
    ordenUpdateMany: vi.fn(async (arg: ArgWhereData) => {
      void arg;
      return { count: opts.ordenUpdateCount ?? 1 };
    }),
    incidenteCreate: vi.fn(async (arg: ArgData) => {
      void arg;
      if (opts.errorCreate) throw opts.errorCreate;
      return { id: INCIDENTE_ID };
    }),
    evidenciaCreateMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    historialCreateMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    walletCreateMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    incidenteUpdateMany: vi.fn(async (arg: ArgWhereData) => {
      // Honra `where.estado`: si la guardia desaparece, el UPDATE aplica sobre un incidente ya
      // resuelto y el feed emite un SEGUNDO egreso. Ese es el fallo que R53 prohibe.
      const estadoReal = opts.estadoIncidente ?? "solicitado";
      const exigido = arg.where.estado as string | undefined;
      return { count: exigido === undefined || exigido === estadoReal ? 1 : 0 };
    }),
    // Tipo de retorno ANCHO a proposito: los casos de lectura sustituyen la fila por una
    // proyeccion completa (o por `null`) con `mockResolvedValueOnce`.
    incidenteFindFirst: vi.fn(async (arg: ArgWhere): Promise<Record<string, unknown> | null> => {
      void arg;
      return { indemnizacion: new Prisma.Decimal("2500.00") };
    }),
    incidenteFindMany: vi.fn(async (arg: ArgWhere): Promise<Record<string, unknown>[]> => {
      void arg;
      return [];
    }),
    incidenteCount: vi.fn(async (arg: ArgWhere) => {
      void arg;
      return 1;
    }),
  };

  const prisma = {
    orden: { findFirst: calls.ordenFindFirst, updateMany: calls.ordenUpdateMany },
    ordenIncidente: {
      create: calls.incidenteCreate,
      updateMany: calls.incidenteUpdateMany,
      findFirst: calls.incidenteFindFirst,
      count: calls.incidenteCount,
      findMany: calls.incidenteFindMany,
    },
    ordenIncidenteEvidencia: { createMany: calls.evidenciaCreateMany },
    ordenHistorialEstado: { createMany: calls.historialCreateMany },
    walletMovimiento: { createMany: calls.walletCreateMany },
  };
  const cliente = {
    ...prisma,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
  return { cliente, calls };
}

/** Repo con el feed REAL (el que emite el egreso) y el repo de wallet REAL sobre el doble. */
function buildRepo(cliente: ReturnType<typeof buildPrisma>["cliente"]) {
  const walletRepo = {
    crearMovimientos: vi.fn(async (tx: { walletMovimiento: { createMany: unknown } }, movs: CrearMovimientoInput[]) => {
      if (movs.length === 0) return 0;
      await (
        tx.walletMovimiento as { createMany: (a: { data: unknown[] }) => Promise<unknown> }
      ).createMany({ data: movs });
      return movs.length;
    }),
    listar: vi.fn(),
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
    obtenerPorOrigen: vi.fn(), // ficha 333: lectura por la clave del libro; este camino no la usa
  };
  const repo = new IncidenteAdminRepository(
    cliente as never,
    walletRepo,
    new WalletIndemnizacionIncidenteFeedService(),
  );
  return { repo, walletRepo };
}

const reporteBase = {
  ordenId: ORDEN_ID,
  causa: "danado" as const,
  motivo: "caja aplastada",
  reportadoPor: ACTOR,
  origenEstatusIds: ORIGEN_IDS,
  incidenteEstatusId: ID_INCIDENTE_ESTADO,
  evidencias: EVIDENCIAS,
  alcance: { zonaId: null },
};

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO
});

describe("R41/R44 — el reporte transiciona la orden y deja rastro, en UNA transaccion", () => {
  it.each([...ORIGENES_INCIDENTE_ADMIN])(
    "R41: desde `%s` crea el incidente y mueve la orden a `incidente`",
    async (origen) => {
      const { cliente, calls } = buildPrisma({ estatusOrden: idEstado(origen) });
      const { repo } = buildRepo(cliente);

      const res = await repo.reportar(reporteBase);

      expect(res).toEqual({ status: "ok", incidenteId: INCIDENTE_ID });
      // TODO dentro de UNA sola transaccion.
      expect(cliente.$transaction).toHaveBeenCalledTimes(1);
      const update = calls.ordenUpdateMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(update.data.estatusId).toBe(ID_INCIDENTE_ESTADO);
      // Guardia anti-TOCTOU: el WHERE fija el estatus EXACTO que se acaba de leer.
      expect(update.where.estatusId).toBe(idEstado(origen));
      expect(update.where.deletedAt).toBeNull();
    },
  );

  it("R44: appendea con familia `incidente`, actor y el par (origen -> incidente) real", async () => {
    const { cliente, calls } = buildPrisma({ estatusOrden: idEstado("por_recoger") });
    const { repo } = buildRepo(cliente);

    await repo.reportar(reporteBase);

    const fila = (calls.historialCreateMany.mock.calls[0][0] as { data: Record<string, unknown>[] })
      .data[0];
    expect(fila.origenTipo).toBe("incidente");
    expect(fila.actorUsuarioId).toBe(ACTOR);
    expect(fila.estatusOrigenId).toBe(idEstado("por_recoger"));
    expect(fila.estatusDestinoId).toBe(ID_INCIDENTE_ESTADO);
    expect(fila.motivo).toBe("caja aplastada");
    // Design §9.7: esto NO es una gestion, asi que la fila NO enlaza ninguna.
    expect(fila.gestionOrdenId ?? null).toBeNull();
  });

  it("R43: el incidente NACE `solicitado` y con la causa y el motivo del reporte", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.reportar({ ...reporteBase, causa: "robado", motivo: "asalto en ruta" });

    const data = (calls.incidenteCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.estado).toBe("solicitado");
    expect(data.causa).toBe("robado");
    expect(data.motivo).toBe("asalto en ruta");
    expect(data.reportadoPor).toBe(ACTOR);
    // R43/R50: nace SIN monto y SIN resolutor.
    expect(data.indemnizacion).toBeUndefined();
    expect(data.resueltoPor).toBeUndefined();
  });

  it("R43: el reporte NO produce NINGUN movimiento de dinero", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo, walletRepo } = buildRepo(cliente);

    await repo.reportar(reporteBase);

    expect(walletRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(calls.walletCreateMany).not.toHaveBeenCalled();
  });

  it("R46: persiste las N evidencias con su indice, en la MISMA transaccion", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.reportar(reporteBase);

    const data = (calls.evidenciaCreateMany.mock.calls[0][0] as { data: Record<string, unknown>[] })
      .data;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ incidenteId: INCIDENTE_ID, indice: 0 });
    expect(data[1]).toMatchObject({ incidenteId: INCIDENTE_ID, indice: 1 });
    // El path del bucket PRIVADO, nunca una URL.
    expect(data[0].storagePath).toBe("o-1/incidente-1-0.jpg");
  });

  it("R60 (Q-K): el reporte NO toca `mensajero_asignado_id` ni `asignado_at`", async () => {
    // Es la mitad que hace trivialmente correcta la reversion: no hay nada que reponer porque
    // nunca se quito. Si alguien anadiera la limpieza aqui, R60 dejaria de cumplirse solo.
    const { cliente, calls } = buildPrisma({ estatusOrden: idEstado("por_recoger") });
    const { repo } = buildRepo(cliente);

    await repo.reportar(reporteBase);

    const data = (calls.ordenUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(Object.keys(data)).toEqual(["estatusId"]);
  });
});

describe("R42/R48 — el reporte se rechaza SIN efectos", () => {
  it("la orden no casa el WHERE (no existe, borrada, otro estado u otra zona) -> `no_aplicable`", async () => {
    const { cliente, calls } = buildPrisma({ estatusOrden: null });
    const { repo } = buildRepo(cliente);

    const res = await repo.reportar(reporteBase);

    expect(res).toEqual({ status: "no_aplicable" });
    // CERO efectos: ni transicion, ni incidente, ni evidencias, ni historial.
    expect(calls.ordenUpdateMany).not.toHaveBeenCalled();
    expect(calls.incidenteCreate).not.toHaveBeenCalled();
    expect(calls.evidenciaCreateMany).not.toHaveBeenCalled();
    expect(calls.historialCreateMany).not.toHaveBeenCalled();
  });

  it("R42: la pre-lectura exige los CINCO estados, no borrada, y el alcance, todo en el WHERE", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.reportar({ ...reporteBase, alcance: { zonaId: "z-satelite" } });

    const where = (calls.ordenFindFirst.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(where.id).toBe(ORDEN_ID);
    expect(where.deletedAt).toBeNull();
    expect(where.estatusId).toEqual({ in: ORIGEN_IDS });
    // R48: el alcance va en el WHERE, nunca filtrado en memoria.
    expect(where.zonaId).toBe("z-satelite");
  });

  it("R48: con acceso total NO se aplica filtro de zona", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.reportar({ ...reporteBase, alcance: { zonaId: null } });

    const where = (calls.ordenFindFirst.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(where).not.toHaveProperty("zonaId");
  });

  it("R42: si la orden se movio entre la lectura y la escritura -> `no_aplicable` sin fila", async () => {
    const { cliente, calls } = buildPrisma({ ordenUpdateCount: 0 });
    const { repo } = buildRepo(cliente);

    const res = await repo.reportar(reporteBase);

    expect(res).toEqual({ status: "no_aplicable" });
    expect(calls.incidenteCreate).not.toHaveBeenCalled();
    expect(calls.historialCreateMany).not.toHaveBeenCalled();
  });
});

describe("R47 — a lo sumo UN incidente vivo por orden", () => {
  it("la violacion del indice unico parcial se traduce a `duplicado`, no a un 500", async () => {
    const { cliente } = buildPrisma({ errorCreate: p2002("orden_incidente_orden_vivo_uq") });
    const { repo } = buildRepo(cliente);

    const res = await repo.reportar(reporteBase);

    expect(res).toEqual({ status: "duplicado" });
  });

  it("un P2002 de OTRA constraint NO se disfraza de `duplicado`: se propaga", async () => {
    // Si un dia apareciera otro unique sobre esta tabla, tragarselo como «ya hay un incidente»
    // mentiria. El guard esta acotado al indice que materializa R47.
    const { cliente } = buildPrisma({ errorCreate: p2002("otra_constraint_uq") });
    const { repo } = buildRepo(cliente);

    await expect(repo.reportar(reporteBase)).rejects.toThrow();
  });

  it("un error CUALQUIERA de la transaccion se propaga (no se convierte en resultado)", async () => {
    const { cliente } = buildPrisma({ errorCreate: new Error("caida de DB") });
    const { repo } = buildRepo(cliente);

    await expect(repo.reportar(reporteBase)).rejects.toThrow("caida de DB");
  });
});

describe("R52/R53 — aprobar escribe el monto y emite UN egreso, en la MISMA tx", () => {
  const aprobar = {
    incidenteId: INCIDENTE_ID,
    alcance: { zonaId: null },
    nuevoEstado: "aprobado" as const,
    resueltoPor: "u-otro-admin",
    monto: "2500.00",
    motivoRechazo: null,
  };

  it("R52: emite exactamente UN movimiento con tipo/categoria/origen_tipo/origen_id exactos", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo, walletRepo } = buildRepo(cliente);

    const res = await repo.resolver(aprobar);

    expect(res).toBe("updated");
    expect(cliente.$transaction).toHaveBeenCalledTimes(1);
    expect(walletRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    const movs = walletRepo.crearMovimientos.mock.calls[0][1] as CrearMovimientoInput[];
    expect(movs).toHaveLength(1);
    expect(movs[0]).toEqual({
      tipo: "egreso",
      categoria: "egreso_indemnizacion",
      monto: "2500.00",
      origenTipo: "orden_incidente",
      origenId: INCIDENTE_ID,
      descripcion: null,
      registradoPor: null,
    });
    expect(calls.walletCreateMany).toHaveBeenCalledTimes(1);
  });

  it("R52/R55: el monto se escribe como Decimal (money-safe), nunca como number", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.resolver({ ...aprobar, monto: "0.01" });

    const data = (calls.incidenteUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    expect(data.indemnizacion).toBeInstanceOf(Prisma.Decimal);
    expect((data.indemnizacion as Prisma.Decimal).toFixed(2)).toBe("0.01");
    expect(typeof data.indemnizacion).not.toBe("number");
    expect(data.estado).toBe("aprobado");
    expect(data.resueltoPor).toBe("u-otro-admin");
    expect(data.resueltoAt).toBeInstanceOf(Date);
  });

  it("R53: la escritura va GUARDADA por `estado = solicitado` + alcance en el WHERE", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.resolver({ ...aprobar, alcance: { zonaId: "z-1" } });

    const where = (calls.incidenteUpdateMany.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(where.id).toBe(INCIDENTE_ID);
    expect(where.estado).toBe("solicitado");
    expect(where.orden).toEqual({ zonaId: "z-1" });
  });

  it("R53: reintentar sobre uno ya resuelto -> `conflict` SIN tocar el feed ni la wallet", async () => {
    const { cliente, calls } = buildPrisma();
    calls.incidenteUpdateMany.mockResolvedValueOnce({ count: 0 });
    const { repo, walletRepo } = buildRepo(cliente);

    const res = await repo.resolver(aprobar);

    expect(res).toBe("conflict");
    // La guardia de estado corta ANTES del feed: no hay segundo movimiento ni siquiera intentado.
    expect(walletRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(calls.incidenteFindFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["aprobado", "aprobado"],
    ["rechazado", "rechazado"],
  ])(
    "R53 (COMPORTAMIENTO): sobre un incidente ya `%s` NO se emite un segundo egreso",
    async (_c, estadoIncidente) => {
      // El doble honra `where.estado`, como la base. Sin la guardia el UPDATE aplicaria sobre un
      // incidente ya resuelto, el feed correria y la wallet recibiria un SEGUNDO movimiento.
      const { cliente } = buildPrisma({ estadoIncidente });
      const { repo, walletRepo } = buildRepo(cliente);

      const res = await repo.resolver(aprobar);

      expect(res).toBe("conflict");
      expect(walletRepo.crearMovimientos).not.toHaveBeenCalled();
    },
  );

  it("R53 (control): con el MISMO doble, un `solicitado` SI se aprueba y emite", async () => {
    // Sin este control, los dos casos de arriba podrian pasar por la razon equivocada.
    const { cliente } = buildPrisma({ estadoIncidente: "solicitado" });
    const { repo, walletRepo } = buildRepo(cliente);

    expect(await repo.resolver(aprobar)).toBe("updated");
    expect(walletRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("R48: si no existe en el alcance -> `fuera_de_alcance` (no se distingue de inexistente)", async () => {
    const { cliente, calls } = buildPrisma();
    calls.incidenteUpdateMany.mockResolvedValueOnce({ count: 0 });
    calls.incidenteCount.mockResolvedValueOnce(0);
    const { repo } = buildRepo(cliente);

    expect(await repo.resolver(aprobar)).toBe("fuera_de_alcance");
  });

  it("R52: el feed LEE de la base lo que la MISMA tx acaba de escribir (no el monto del request)", async () => {
    // El doble devuelve un monto DISTINTO del que se pasa por parametro. El movimiento debe
    // llevar el de la BASE: si el feed usara el del request, el libro y el incidente podrian
    // divergir cuando la escritura falle a medias (leccion de la 69).
    const { cliente, calls } = buildPrisma();
    calls.incidenteFindFirst.mockResolvedValueOnce({
      indemnizacion: new Prisma.Decimal("777.77"),
    });
    const { repo, walletRepo } = buildRepo(cliente);

    await repo.resolver({ ...aprobar, monto: "2500.00" });

    const movs = walletRepo.crearMovimientos.mock.calls[0][1] as CrearMovimientoInput[];
    expect(movs[0].monto).toBe("777.77");
    // Y el orden importa: primero se escribe, despues se lee.
    expect(calls.incidenteUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      calls.incidenteFindFirst.mock.invocationCallOrder[0],
    );
  });

  it("R52: aprobar NO mueve la orden (queda en `incidente`, que es terminal)", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.resolver(aprobar);

    expect(calls.ordenUpdateMany).not.toHaveBeenCalled();
    expect(calls.historialCreateMany).not.toHaveBeenCalled();
  });

  it("si la wallet falla, se PROPAGA y la tx revierte (nada queda aplicado)", async () => {
    const { cliente } = buildPrisma();
    const { repo, walletRepo } = buildRepo(cliente);
    walletRepo.crearMovimientos.mockRejectedValueOnce(new Error("wallet caida"));

    await expect(repo.resolver(aprobar)).rejects.toThrow("wallet caida");
  });
});

describe("R54/R57 — rechazar devuelve la orden a su ORIGEN, sin monto y sin movimiento", () => {
  const reversionA = (destino: OrderStatusValue) => ({
    incidenteId: INCIDENTE_ID,
    alcance: { zonaId: null },
    nuevoEstado: "rechazado" as const,
    resueltoPor: "u-otro-admin",
    monto: null,
    motivoRechazo: "no procede",
    reversion: {
      ordenId: ORDEN_ID,
      incidenteEstatusId: ID_INCIDENTE_ESTADO,
      destinoEstatusId: idEstado(destino),
    },
  });

  it.each([...ORIGENES_INCIDENTE_ADMIN])(
    "R57: la orden vuelve a `%s`, con la arista inversa declarada",
    async (destino) => {
      const { cliente, calls } = buildPrisma();
      const { repo } = buildRepo(cliente);

      const res = await repo.resolver(reversionA(destino));

      expect(res).toBe("updated");
      const update = calls.ordenUpdateMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(update.data.estatusId).toBe(idEstado(destino));
      // Guardia: la orden DEBE seguir en `incidente` (si se movio, cuenta 0 y todo revierte).
      expect(update.where.estatusId).toBe(ID_INCIDENTE_ESTADO);
      // R60: la asignacion NO se toca, ni para reponerla ni para limpiarla.
      expect(Object.keys(update.data)).toEqual(["estatusId"]);
      // Y el rastro va por el choke point con la familia `incidente` (aristas #54-#58).
      const fila = (
        calls.historialCreateMany.mock.calls[0][0] as { data: Record<string, unknown>[] }
      ).data[0];
      expect(fila.origenTipo).toBe("incidente");
      expect(fila.estatusOrigenId).toBe(ID_INCIDENTE_ESTADO);
      expect(fila.estatusDestinoId).toBe(idEstado(destino));
      expect(fila.actorUsuarioId).toBe("u-otro-admin");
    },
  );

  it("R54: NO persiste monto y NO emite NINGUN movimiento", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo, walletRepo } = buildRepo(cliente);

    await repo.resolver(reversionA("en_bodega_central"));

    const data = (calls.incidenteUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    expect(data.indemnizacion).toBeNull();
    expect(data.estado).toBe("rechazado");
    expect(data.motivoRechazo).toBe("no procede");
    expect(walletRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(calls.walletCreateMany).not.toHaveBeenCalled();
  });

  it("R59: el RETRACTO del autor escribe lo mismo, con `motivoRechazo` null", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.resolver({ ...reversionA("por_recoger"), motivoRechazo: null, resueltoPor: ACTOR });

    const data = (calls.incidenteUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    expect(data.estado).toBe("rechazado");
    expect(data.motivoRechazo).toBeNull();
    expect(data.resueltoPor).toBe(ACTOR);
  });

  it("si la orden se movio bajo los pies, TODO revierte (`conflict`, sin historial)", async () => {
    const { cliente, calls } = buildPrisma({ ordenUpdateCount: 0 });
    const { repo } = buildRepo(cliente);

    const res = await repo.resolver(reversionA("en_bodega_satelite"));

    expect(res).toBe("conflict");
    expect(calls.historialCreateMany).not.toHaveBeenCalled();
  });
});

describe("R48/R49 — las lecturas van acotadas por alcance en el WHERE", () => {
  it("findByAlcance filtra por la zona de la ORDEN, no por la del autor", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.findByAlcance({ zonaId: "z-1" });

    const arg = calls.incidenteFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({ orden: { zonaId: "z-1" } });
  });

  it("con acceso total el WHERE queda vacio (todas las zonas)", async () => {
    const { cliente, calls } = buildPrisma();
    const { repo } = buildRepo(cliente);

    await repo.findByAlcance({ zonaId: null });

    const arg = calls.incidenteFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({});
  });

  it("findByIdEnAlcance devuelve null fuera de alcance (no se distingue de inexistente)", async () => {
    const { cliente, calls } = buildPrisma();
    calls.incidenteFindFirst.mockResolvedValueOnce(null);
    const { repo } = buildRepo(cliente);

    expect(await repo.findByIdEnAlcance(INCIDENTE_ID, { zonaId: "z-1" })).toBeNull();
  });

  it("R46/R50: la fila proyecta el monto como STRING y los paths CRUDOS del bucket", async () => {
    const { cliente, calls } = buildPrisma();
    calls.incidenteFindFirst.mockResolvedValueOnce({
      id: INCIDENTE_ID,
      ordenId: ORDEN_ID,
      causa: "perdido",
      motivo: "no aparece",
      estado: "aprobado",
      indemnizacion: new Prisma.Decimal("1500.5"),
      reportadoPor: ACTOR,
      resueltoPor: "u-otro",
      resueltoAt: new Date("2026-07-30T12:00:00.000Z"),
      motivoRechazo: null,
      createdAt: new Date("2026-07-30T11:00:00.000Z"),
      orden: {
        numGuia: 42,
        numRemision: "R-42",
        destinatario: "Ana",
        zonaId: "z-1",
        montoCobrar: null, // fix «tope de negocio» (2026-08-04): columna nueva del select
        zona: { nombre: "Centro" },
        estatus: { value: "incidente" },
      },
      reportadoPorUsuario: { nombre: "Admin Uno" },
      resueltoPorUsuario: { nombre: "Admin Dos" },
      evidencias: [{ storagePath: "p/0.jpg" }, { storagePath: "p/1.jpg" }],
    });
    const { repo } = buildRepo(cliente);

    const row = await repo.findByIdEnAlcance(INCIDENTE_ID, { zonaId: null });

    expect(row).not.toBeNull();
    // Money-safe: STRING escala 2 fija, nunca number.
    expect(row!.indemnizacion).toBe("1500.50");
    expect(typeof row!.indemnizacion).toBe("string");
    expect(row!.evidenciaStoragePaths).toEqual(["p/0.jpg", "p/1.jpg"]);
    expect(row!.resueltoAt).toBe("2026-07-30T12:00:00.000Z");
    expect(row!.reportadoPorNombre).toBe("Admin Uno");
    expect(row!.resueltoPorNombre).toBe("Admin Dos");
    expect(row!.estatusValue).toBe("incidente");
  });

  it("un incidente sin resolver proyecta monto y resolutor en null (no 0.00)", async () => {
    const { cliente, calls } = buildPrisma();
    calls.incidenteFindFirst.mockResolvedValueOnce({
      id: INCIDENTE_ID,
      ordenId: ORDEN_ID,
      causa: "danado",
      motivo: "x",
      estado: "solicitado",
      indemnizacion: null,
      reportadoPor: ACTOR,
      resueltoPor: null,
      resueltoAt: null,
      motivoRechazo: null,
      createdAt: new Date("2026-07-30T11:00:00.000Z"),
      orden: {
        numGuia: null,
        numRemision: "R-1",
        destinatario: "Ana",
        zonaId: "z-1",
        montoCobrar: null, // fix «tope de negocio» (2026-08-04): columna nueva del select
        zona: { nombre: "Centro" },
        estatus: { value: "incidente" },
      },
      reportadoPorUsuario: { nombre: "Admin Uno" },
      resueltoPorUsuario: null,
      evidencias: [],
    });
    const { repo } = buildRepo(cliente);

    const row = await repo.findByIdEnAlcance(INCIDENTE_ID, { zonaId: null });

    expect(row!.indemnizacion).toBeNull();
    expect(row!.resueltoPorNombre).toBeNull();
    expect(row!.resueltoAt).toBeNull();
  });
});
