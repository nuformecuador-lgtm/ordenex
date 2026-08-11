import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { RankingSnapshotRepository } from "@/lib/repositories/RankingSnapshotRepository";
import type { FilaSnapshotInput } from "@/lib/interfaces/repositories/IRankingSnapshotRepository";

// Feature 196 (T2.2) — repositorio del snapshot con Prisma mockeado (sin DB). Cubre R12 (la
// reejecucion es un no-op reportado, no un error), R14 (todo o nada: un fallo a mitad no deja
// cabecera) y R25 (la lectura sale por `puesto` asc, sin reordenar).
//
// LIMITE CONOCIDO DE ESTE ARCHIVO: el P2002 de R12 esta FABRICADO A MANO (`p2002()`), asi que
// aqui se mide la REACCION del repositorio, no la FORMA del error real. Que el P2002 que
// Postgres emite de verdad —atravesando el driver adapter— nombre la constraint que
// `esColisionDeFecha` busca lo mide el bloque C de
// `tests/integration/db/ranking-snapshot-migration.test.ts`, con dos corridas reales.
//
// El fake distingue el cliente DE FUERA de la transaccion del `tx` DE DENTRO: los delegates
// de fuera explotan si alguien los usa para escribir. Asi «va en una transaccion» se mide, en
// vez de darse por supuesto porque el codigo mencione `$transaction`.

const FECHA = new Date("2026-08-10T00:00:00.000Z"); // medianoche UTC = fecha calendario CR

function unaFila(overrides: Partial<FilaSnapshotInput> = {}): FilaSnapshotInput {
  return {
    puesto: 1,
    posicion: 1,
    mensajeroId: "m1",
    mensajeroNombre: "Ana",
    entregadas: 9,
    asignadas: 10,
    premioMonto: "15000.00",
    premioDescripcion: "Primer lugar",
    ...overrides,
  };
}

function p2002(target: string[], constraint: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.8.0",
    meta: { target, driverAdapterError: { cause: { originalMessage: constraint } } },
  });
}

interface FakeOpts {
  createCabecera?: () => unknown;
  createMany?: () => unknown;
  findUniqueCabecera?: unknown;
  filasLeidas?: unknown[];
}

function buildPrisma(opts: FakeOpts = {}) {
  const explota = (que: string) => (_args: unknown) => {
    throw new Error(`${que} se llamo FUERA de la transaccion`);
  };
  const crearCabecera = opts.createCabecera ?? (() => ({ id: "snap-1" }));
  const crearFilas = opts.createMany ?? (() => ({ count: 0 }));
  const tx = {
    rankingSnapshotDia: {
      create: vi.fn(async (_args: unknown) => crearCabecera()),
    },
    rankingSnapshotFila: {
      createMany: vi.fn(async (_args: unknown) => crearFilas()),
    },
  };
  const prisma = {
    rankingSnapshotDia: {
      create: vi.fn(explota("rankingSnapshotDia.create")),
      findUnique: vi.fn(async (_args: unknown) => opts.findUniqueCabecera ?? null),
    },
    rankingSnapshotFila: {
      createMany: vi.fn(explota("rankingSnapshotFila.createMany")),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx };
}

function repoWith(prisma: unknown) {
  return new RankingSnapshotRepository(prisma as unknown as PrismaClient);
}

describe("crearSnapshot — atomicidad (R14)", () => {
  it("cabecera y filas van en UNA sola transaccion (nada se escribe fuera de ella)", async () => {
    const { prisma, tx } = buildPrisma();
    const res = await repoWith(prisma).crearSnapshot({
      fecha: FECHA,
      minAsignadasPodio: 3,
      filas: [unaFila(), unaFila({ puesto: 2, posicion: null, mensajeroId: "m2", premioMonto: null, premioDescripcion: null })],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.rankingSnapshotDia.create).toHaveBeenCalledTimes(1);
    expect(tx.rankingSnapshotFila.createMany).toHaveBeenCalledTimes(1);
    // Los delegates de fuera de la transaccion no se tocan: si el repo escribiera con ellos,
    // el fake habria lanzado.
    expect(prisma.rankingSnapshotDia.create).not.toHaveBeenCalled();
    expect(prisma.rankingSnapshotFila.createMany).not.toHaveBeenCalled();
    expect(res).toEqual({ creado: true, filas: 2 });
  });

  it("la cabecera congela fecha, umbral APLICADO y el conteo de filas (R1)", async () => {
    const { prisma, tx } = buildPrisma();
    await repoWith(prisma).crearSnapshot({
      fecha: FECHA,
      minAsignadasPodio: 5,
      filas: [unaFila()],
    });

    expect(tx.rankingSnapshotDia.create.mock.calls[0][0]).toMatchObject({
      data: { fecha: FECHA, minAsignadasPodio: 5, filas: 1 },
    });
  });

  it("un fallo en createMany propaga y NO deja cabecera: el create quedo dentro de la misma transaccion", async () => {
    const { prisma, tx } = buildPrisma({
      createMany: () => {
        throw new Error("insert de filas fallido");
      },
    });

    await expect(
      repoWith(prisma).crearSnapshot({ fecha: FECHA, minAsignadasPodio: 1, filas: [unaFila()] }),
    ).rejects.toThrow("insert de filas fallido");

    // La cabecera se intento DENTRO del callback de `$transaction`: en una base real el
    // rollback se la lleva. Lo que R14 prohibe —escribirla fuera y dejarla huerfana— no
    // ocurre, y el fake lo prueba porque el `create` de fuera nunca se llamo.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.rankingSnapshotDia.create).toHaveBeenCalledTimes(1);
    expect(prisma.rankingSnapshotDia.create).not.toHaveBeenCalled();
    // Un fallo cualquiera NO se confunde con la reejecucion: no hay consulta de rescate.
    expect(prisma.rankingSnapshotDia.findUnique).not.toHaveBeenCalled();
  });

  it("dia sin actividad: escribe la cabecera con filas = 0 y no llama a createMany (R11)", async () => {
    const { prisma, tx } = buildPrisma();
    const res = await repoWith(prisma).crearSnapshot({
      fecha: FECHA,
      minAsignadasPodio: 1,
      filas: [],
    });

    expect(tx.rankingSnapshotDia.create.mock.calls[0][0]).toMatchObject({ data: { filas: 0 } });
    expect(tx.rankingSnapshotFila.createMany).not.toHaveBeenCalled();
    expect(res).toEqual({ creado: true, filas: 0 });
  });

  it("el monto del premio entra como Prisma.Decimal, nunca como number (R31)", async () => {
    const { prisma, tx } = buildPrisma();
    await repoWith(prisma).crearSnapshot({
      fecha: FECHA,
      minAsignadasPodio: 1,
      filas: [unaFila({ premioMonto: "15000.50" })],
    });

    const { data } = tx.rankingSnapshotFila.createMany.mock.calls[0][0] as {
      data: { premioMonto: unknown; snapshotId: string }[];
    };
    expect(data[0].snapshotId).toBe("snap-1");
    expect(data[0].premioMonto).toBeInstanceOf(Prisma.Decimal);
    expect(String(data[0].premioMonto)).toBe("15000.5");
  });
});

describe("crearSnapshot — reejecucion sobre una fecha ya congelada (R12)", () => {
  it("la colision del UNIQUE de `fecha` devuelve creado:false SIN propagar", async () => {
    const { prisma, tx } = buildPrisma({
      createCabecera: () => {
        throw p2002(["fecha"], 'llave duplicada viola restriccion «ranking_snapshot_dia_fecha_key»');
      },
      findUniqueCabecera: { filas: 7 },
    });

    const res = await repoWith(prisma).crearSnapshot({
      fecha: FECHA,
      minAsignadasPodio: 1,
      filas: [unaFila()],
    });

    // No es un error: es el camino esperado del reintento de Vercel.
    expect(res).toEqual({ creado: false, filas: 7 });
    // Y no se escribio NADA: ni filas nuevas, ni upsert de la cabecera.
    expect(tx.rankingSnapshotFila.createMany).not.toHaveBeenCalled();
    expect(prisma.rankingSnapshotDia.findUnique.mock.calls[0][0]).toMatchObject({
      where: { fecha: FECHA },
    });
  });

  it("reporta las filas YA congeladas, no las que se habrian escrito", async () => {
    const { prisma } = buildPrisma({
      createCabecera: () => {
        throw p2002(["fecha"], "ranking_snapshot_dia_fecha_key");
      },
      findUniqueCabecera: { filas: 0 }, // la fecha congelada era un dia sin actividad
    });

    const res = await repoWith(prisma).crearSnapshot({
      fecha: FECHA,
      minAsignadasPodio: 1,
      filas: [unaFila(), unaFila({ puesto: 2, mensajeroId: "m2", posicion: 2 })],
    });
    expect(res).toEqual({ creado: false, filas: 0 });
  });

  it("un P2002 de OTRA constraint SI se propaga: eso es un defecto, no una reejecucion", async () => {
    const { prisma } = buildPrisma({
      createMany: () => {
        throw p2002(
          ["snapshot_id", "puesto"],
          'llave duplicada viola restriccion «ranking_snapshot_fila_snapshot_id_puesto_key»',
        );
      },
    });

    await expect(
      repoWith(prisma).crearSnapshot({ fecha: FECHA, minAsignadasPodio: 1, filas: [unaFila()] }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

describe("obtenerPorFecha — orden congelado y serializacion (R25/R26/R31)", () => {
  function prismaConSnapshot(row: unknown) {
    return {
      rankingSnapshotDia: { findUnique: vi.fn(async (_args: unknown) => row) },
      rankingSnapshotFila: {},
      $transaction: vi.fn(),
    };
  }

  it("pide las filas ORDER BY puesto asc (R25)", async () => {
    const prisma = prismaConSnapshot(null);
    await repoWith(prisma).obtenerPorFecha(FECHA);

    const arg = prisma.rankingSnapshotDia.findUnique.mock.calls[0][0] as {
      where: unknown;
      include: { filasSnapshot: { orderBy: unknown } };
    };
    expect(arg.where).toEqual({ fecha: FECHA });
    expect(arg.include.filasSnapshot.orderBy).toEqual({ puesto: "asc" });
  });

  it("sin cabecera devuelve null (R26: «el cron no corrio esa fecha»)", async () => {
    const prisma = prismaConSnapshot(null);
    expect(await repoWith(prisma).obtenerPorFecha(FECHA)).toBeNull();
  });

  it("cabecera con cero filas NO es null: es un dia sin actividad (R11/R26)", async () => {
    const prisma = prismaConSnapshot({
      fecha: FECHA,
      generadoAt: new Date("2026-08-11T08:00:00.000Z"),
      minAsignadasPodio: 3,
      filasSnapshot: [],
    });
    const row = await repoWith(prisma).obtenerPorFecha(FECHA);
    expect(row).not.toBeNull();
    expect(row?.filas).toEqual([]);
    expect(row?.minAsignadasPodio).toBe(3);
  });

  it("devuelve las filas TAL CUAL vienen y el monto como STRING escala 2 (R25/R31)", async () => {
    const prisma = prismaConSnapshot({
      fecha: FECHA,
      generadoAt: new Date("2026-08-11T08:00:00.000Z"),
      minAsignadasPodio: 1,
      filasSnapshot: [
        {
          puesto: 1,
          posicion: 1,
          mensajeroId: "m1",
          mensajeroNombre: "Ana",
          entregadas: 9,
          asignadas: 10,
          premioMonto: new Prisma.Decimal("15000"),
          premioDescripcion: "Primer lugar",
        },
        {
          puesto: 2,
          posicion: null,
          mensajeroId: "m2",
          mensajeroNombre: "Beto",
          entregadas: 1,
          asignadas: 4,
          premioMonto: null,
          premioDescripcion: null,
        },
      ],
    });

    const row = await repoWith(prisma).obtenerPorFecha(FECHA);
    expect(row?.filas.map((f) => f.puesto)).toEqual([1, 2]);
    expect(row?.filas[0].premioMonto).toBe("15000.00");
    expect(typeof row?.filas[0].premioMonto).toBe("string");
    expect(row?.filas[1].premioMonto).toBeNull();
    expect(row?.generadoAt).toEqual(new Date("2026-08-11T08:00:00.000Z"));
  });
});
