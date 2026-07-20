import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type {
  EnqueueOpts,
  IJobRepository,
  JobDTO,
  JobTxClient,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { JobTipo } from "@prisma/client";
import type { CreateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";
import { hashDireccion } from "@/lib/geo/direccion-query";
import { dedupeKeyGeocodificacion } from "@/lib/services/jobs/geocodificacion-encolado";

// Feature 91 (R6, R7, R8, R12, R13) — encolado TRANSACTIONAL OUTBOX desde los writers de
// direccion. Prisma va mockeado (patron de tests/integration/repositories), pero el
// `$transaction` fake respeta la semantica que importa: si el callback LANZA, nada de lo
// hecho dentro cuenta. El repo de jobs es una cola EN MEMORIA que honra la unicidad de
// `dedupe_key` igual que el indice unico parcial de la migracion de la 90 — asi el efecto
// de la clave (R12/R13) se observa como filas, no como llamadas.

const HISTORIAL = { actorUsuarioId: "usr-1", origenTipo: "creacion_manual" as const };

/** Cola en memoria con la MISMA regla de unicidad que el indice de `jobs`. */
class ColaEnMemoria implements IJobRepository {
  readonly filas: { id: string; tipo: JobTipo; payload: Record<string, unknown>; dedupeKey: string | null; maxIntentos: number; tx?: JobTxClient }[] =
    [];
  private seq = 0;

  async enqueue(
    tipo: JobTipo,
    payload: Record<string, unknown>,
    opts: EnqueueOpts = {},
    // 4.º parametro: el cliente TRANSACCIONAL del writer (outbox). Se REGISTRA en la fila
    // para poder afirmar que el encolado ocurre dentro de la tx del writer.
    tx?: JobTxClient,
  ): Promise<JobDTO | null> {
    const dedupeKey = opts.dedupeKey ?? null;
    // ON CONFLICT ("dedupe_key") WHERE dedupe_key IS NOT NULL DO NOTHING. OJO: NO esta
    // acotado por estado, y las filas `done` no se purgan (por eso la clave lleva hash).
    if (dedupeKey !== null && this.filas.some((f) => f.dedupeKey === dedupeKey)) return null;
    this.seq += 1;
    this.filas.push({
      id: `job-${this.seq}`,
      tipo,
      payload,
      dedupeKey,
      maxIntentos: opts.maxIntentos ?? 5,
      tx,
    });
    return null;
  }

  async claimBatch(): Promise<JobDTO[]> {
    return [];
  }
  /**
   * Feature 92 (R4): la cola en memoria no guarda el DTO completo, y estos tests solo
   * ejercitan el ENCOLADO. Se devuelve `[]` porque ninguna fila de esta cola llega a
   * tener estado: el gate de asignabilidad se prueba en su propio test con un doble que
   * SI modela `estado`.
   */
  async findByDedupeKeys(): Promise<JobDTO[]> {
    return [];
  }
  async complete(): Promise<void> {}
  async fail(): Promise<void> {}

  /** Filas de geocodificacion encoladas. */
  get geo() {
    return this.filas.filter((f) => f.tipo === "geocodificacion");
  }
}

const CREATE_DATA: CreateOrdenData = {
  numRemision: "REM-1",
  estatusId: "st-1",
  destinatario: "Ana",
  telefonoDest: "88880000",
  tiendaId: "tienda-1",
  zonaId: "zona-1",
  provinciaId: "prov-1",
  cantonId: "canton-1",
  distritoId: "dist-1",
  producto: "Caja",
  peso: null,
  notas: null,
  direccion: "Av. Central 100",
  montoCobrar: null,
  mensajeroSugeridoId: null,
};

/** Prisma fake cuyo `$transaction` propaga el rechazo del callback (R7). */
function buildPrisma(overrides: {
  ordenCreate?: ReturnType<typeof vi.fn>;
  before?: unknown[];
  after?: unknown[];
  createManyCount?: number;
}) {
  const orden = {
    create:
      overrides.ordenCreate ??
      vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "orden-1",
        ...data,
        estatus: { value: "pendiente" },
        peso: null,
        montoCobrar: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    findMany: vi
      .fn()
      .mockResolvedValueOnce(overrides.before ?? [])
      .mockResolvedValueOnce(overrides.after ?? []),
    createMany: vi.fn(async () => ({ count: overrides.createManyCount ?? 0 })),
  };
  const ordenHistorialEstado = { createMany: vi.fn(async () => ({ count: 1 })) };
  const prisma = {
    orden,
    ordenHistorialEstado,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
  };
  return { prisma, orden, ordenHistorialEstado };
}

describe("R6 — creacion individual", () => {
  it("crear una orden con direccion deja un job geocodificacion pendiente", async () => {
    const { prisma } = buildPrisma({});
    const cola = new ColaEnMemoria();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, cola);

    await repo.create(CREATE_DATA, HISTORIAL);

    expect(cola.geo).toHaveLength(1);
    expect(cola.geo[0].payload).toEqual({ ordenId: "orden-1" });
    expect(cola.geo[0].maxIntentos).toBe(8); // R34
    expect(cola.geo[0].dedupeKey).toBe(
      dedupeKeyGeocodificacion("orden-1", hashDireccion("Av. Central 100")),
    );
  });

  it("R9: crear una orden SIN direccion no encola nada", async () => {
    const { prisma } = buildPrisma({});
    const cola = new ColaEnMemoria();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, cola);

    await repo.create({ ...CREATE_DATA, direccion: null }, HISTORIAL);

    expect(cola.geo).toHaveLength(0);
  });

  it("el encolado ocurre DENTRO de la transaccion que inserta la orden", async () => {
    const { prisma } = buildPrisma({});
    const cola = new ColaEnMemoria();
    const enqueueSpy = vi.spyOn(cola, "enqueue");
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, cola);

    await repo.create(CREATE_DATA, HISTORIAL);

    // El 4.º argumento de `enqueue` es el cliente transaccional del writer (outbox).
    expect(enqueueSpy.mock.calls[0][3]).toBe(prisma);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("R7 — la transaccion revertida no deja jobs huerfanos", () => {
  it("si la creacion falla no queda job huerfano en la cola", async () => {
    // El append del historial revienta DESPUES del create: la tx entera revierte.
    const { prisma, ordenHistorialEstado } = buildPrisma({});
    ordenHistorialEstado.createMany.mockRejectedValue(new Error("append boom"));
    const cola = new ColaEnMemoria();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, cola);

    await expect(repo.create(CREATE_DATA, HISTORIAL)).rejects.toThrow();

    // El encolado va DESPUES del append en la misma tx: nunca llego a ejecutarse.
    expect(cola.geo).toHaveLength(0);
  });

  it("si el insert de la orden falla, tampoco se encola", async () => {
    const ordenCreate = vi.fn(async () => {
      throw new Error("create boom");
    });
    const { prisma } = buildPrisma({ ordenCreate });
    const cola = new ColaEnMemoria();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, cola);

    await expect(repo.create(CREATE_DATA, HISTORIAL)).rejects.toThrow();
    expect(cola.geo).toHaveLength(0);
  });
});

describe("R8 — carga masiva", () => {
  it("la carga masiva encola un job por orden nueva y ninguno por duplicado saltado", async () => {
    // `before` ya tiene orden-existente (duplicada, la saltara skipDuplicates);
    // `after` trae las tres, asi que las NUEVAS son orden-a y orden-b.
    const { prisma } = buildPrisma({
      before: [{ id: "orden-existente" }],
      after: [
        { id: "orden-existente", estatusId: "st-1", direccion: "Ya estaba" },
        { id: "orden-a", estatusId: "st-1", direccion: "Av. A" },
        { id: "orden-b", estatusId: "st-1", direccion: "Av. B" },
      ],
      createManyCount: 2,
    });
    const cola = new ColaEnMemoria();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, cola);

    const insertadas = await repo.createManyOrdenes(
      [CREATE_DATA, { ...CREATE_DATA, numRemision: "REM-2" }, { ...CREATE_DATA, numRemision: "REM-3" }],
      100,
      { ...HISTORIAL, origenTipo: "carga_masiva" },
    );

    expect(insertadas).toBe(2);
    expect(cola.geo.map((f) => f.payload)).toEqual([
      { ordenId: "orden-a" },
      { ordenId: "orden-b" },
    ]);
    // La duplicada saltada NO encola.
    expect(cola.geo.map((f) => f.payload)).not.toContainEqual({ ordenId: "orden-existente" });
  });

  it("R9: en un lote, las filas sin direccion no encolan", async () => {
    const { prisma } = buildPrisma({
      before: [],
      after: [
        { id: "orden-a", estatusId: "st-1", direccion: "Av. A" },
        { id: "orden-b", estatusId: "st-1", direccion: null },
        { id: "orden-c", estatusId: "st-1", direccion: "   " },
      ],
      createManyCount: 3,
    });
    const cola = new ColaEnMemoria();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, cola);

    await repo.createManyOrdenes([CREATE_DATA], 100, {
      ...HISTORIAL,
      origenTipo: "carga_masiva",
    });

    expect(cola.geo.map((f) => f.payload)).toEqual([{ ordenId: "orden-a" }]);
  });
});

describe("R12/R13 — idempotencia y re-geocodificacion", () => {
  it("dos encolados de la misma orden y direccion producen una sola fila", async () => {
    const cola = new ColaEnMemoria();
    for (let i = 0; i < 2; i++) {
      const { prisma } = buildPrisma({});
      const repo = new OrdenRepository(prisma as unknown as PrismaClient, cola);
      await repo.create(CREATE_DATA, HISTORIAL);
    }
    expect(cola.geo).toHaveLength(1); // el 2.º choco con la clave y se descarto
  });

  it("corregir la direccion de una orden ya geocodificada encola un job nuevo", async () => {
    const cola = new ColaEnMemoria();

    // 1.º encolado: direccion original. Se procesa y la fila queda `done` (NO se purga).
    const primero = buildPrisma({});
    await new OrdenRepository(primero.prisma as unknown as PrismaClient, cola).create(
      CREATE_DATA,
      HISTORIAL,
    );
    expect(cola.geo).toHaveLength(1);

    // 2.º: la MISMA orden con la direccion CORREGIDA. Con `dedupeKey` sin hash, esto
    // chocaria con la fila anterior y el ON CONFLICT DO NOTHING lo descartaria EN
    // SILENCIO: la correccion no se geocodificaria jamas.
    const segundo = buildPrisma({
      ordenCreate: vi.fn(async () => ({
        id: "orden-1",
        direccion: "Av. Central 200",
        estatus: { value: "pendiente" },
        peso: null,
        montoCobrar: null,
      })),
    });
    await new OrdenRepository(segundo.prisma as unknown as PrismaClient, cola).create(
      { ...CREATE_DATA, numRemision: "REM-9", direccion: "Av. Central 200" },
      HISTORIAL,
    );

    expect(cola.geo).toHaveLength(2);
    expect(cola.geo[1].dedupeKey).toBe(
      dedupeKeyGeocodificacion("orden-1", hashDireccion("Av. Central 200")),
    );
    expect(cola.geo[1].dedupeKey).not.toBe(cola.geo[0].dedupeKey);
  });
});
