import { describe, it, expect, vi, beforeEach } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { CreateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import { buildCargaDelegate, loteCtx } from "@/tests/fixtures/carga-lote";

// Feature 155 (T3.1/T3.2) — el lado REPOSITORIO de la bifurcacion de creacion:
//   R11    las DOS rutas de creacion encolan geocodificacion por orden EFECTIVAMENTE insertada
//   R12    todo-o-nada: estado, guia, historial y encolado se cometen o se revierten juntos
//   R21    `createManyOrdenesConGuia` con `conGuia: false` no consume secuencia (numGuia null)
//
// 2026-08-07 (tanda 2 del chore de deuda de superficie): eran TRES rutas de creacion; hoy son
// DOS. La tercera era `create`, el alta individual, borrada al quedarse sin llamador. Con ella
// se fue el bloque de R3/R8; esa guarda idempotente (`num_guia IS NULL`) NO se queda sin
// testigo: la afirman `orden-repository.carga-api.test.ts` sobre `createManyOrdenesConGuia` y
// `orden-repository.guia.test.ts` sobre `generarGuiaLote`, las dos vivas. R12 se REAPUNTA aqui
// abajo a `createManyOrdenesConGuia`, que hace exactamente lo mismo —insertar, numerar, anexar
// historial y encolar en UNA tx— y esta viva.
//
// El fake de Prisma ejecuta el callback de `$transaction` con el propio objeto como `tx`, igual
// que el resto de tests de repositorio del repo.

const HIST_API = { actorUsuarioId: "key-user-1", origenTipo: "carga_api" } as const;
const HIST_MASIVA = { actorUsuarioId: "store-1", origenTipo: "carga_masiva" } as const;

const DIRECCION_GEOCODIFICABLE = "Av. Central, 200m norte del parque";

function baseCreateData(overrides: Partial<CreateOrdenData> = {}): CreateOrdenData {
  return {
    numRemision: "REM-1",
    estatusId: idEstado("por_recolectar_en_tienda"),
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    producto: "Caja",
    peso: null,
    direccion: DIRECCION_GEOCODIFICABLE,
    ...overrides,
  };
}

/** Doble del repo de jobs: solo hace falta `enqueue` (el encolado outbox de la 91). */
function buildJobRepo() {
  // Tipado explicito de los argumentos: sin el, `vi.fn(async () => null)` infiere una tupla
  // VACIA y `mock.calls[0][0]` deja de compilar (TS2493).
  const enqueue = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null);
  return { jobRepo: { enqueue } as unknown as IJobRepository, enqueue };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      create: vi.fn(),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      findUniqueOrThrow: vi.fn(),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
    // Feature 141: las dos rutas de lote aseguran la fila de `carga` DENTRO de la misma tx,
    // asi que el fake de Prisma necesita el delegate. Este archivo no prueba el lote (eso vive
    // en `orden-repository.carga-lote.test.ts`): solo lo deja funcionar.
    carga: buildCargaDelegate(),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    // Lo exige el `JobRepository` real (encolado outbox) cuando el test NO inyecta un doble.
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

beforeEach(async () => {
  // Feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales).
  await sembrarCatalogoEstados();
});

// ---------------------------------------------------------------------------------------------
// T3.1 — `create` con guia opcional
// ---------------------------------------------------------------------------------------------
describe("155/R12 — todo-o-nada de la creacion con guia (via createManyOrdenesConGuia)", () => {
  // REAPUNTADO 2026-08-07: se escribia sobre `create`, borrada. La propiedad —los cuatro
  // efectos se cometen o se revierten JUNTOS— es de la ruta que numera dentro de la tx, y esa
  // sigue viva en `createManyOrdenesConGuia`.
  function conUnaFilaNueva(prisma: ReturnType<typeof buildPrisma>) {
    prisma.orden.findMany.mockReset();
    prisma.orden.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "ord-1",
        numRemision: "REM-1",
        estatusId: idEstado("por_recolectar_en_tienda"),
        direccion: DIRECCION_GEOCODIFICABLE,
        estatus: { value: "por_recolectar_en_tienda" },
      },
    ]);
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    return prisma;
  }

  it("si el historial falla, la tx aborta (la guia consumida se revierte con ella)", async () => {
    const prisma = conUnaFilaNueva(buildPrisma());
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 9 });
    prisma.ordenHistorialEstado.createMany.mockRejectedValue(new Error("append boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.createManyOrdenesConGuia([baseCreateData()], 100, HIST_API, loteCtx()),
    ).rejects.toThrow("append boom");
  });

  it("si el encolado de geocodificacion falla, la tx aborta", async () => {
    const prisma = conUnaFilaNueva(buildPrisma());
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 9 });
    const jobRepo = {
      enqueue: vi.fn().mockRejectedValue(new Error("outbox boom")),
    } as unknown as IJobRepository;
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await expect(
      repo.createManyOrdenesConGuia([baseCreateData()], 100, HIST_API, loteCtx()),
    ).rejects.toThrow("outbox boom");
  });

  it("si la numeracion falla, el encolado no llega a ejecutarse", async () => {
    const prisma = conUnaFilaNueva(buildPrisma());
    prisma.$executeRawUnsafe.mockRejectedValue(new Error("secuencia caida"));
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await expect(
      repo.createManyOrdenesConGuia([baseCreateData()], 100, HIST_API, loteCtx()),
    ).rejects.toThrow("secuencia caida");
    expect(enqueue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// T3.2 — el hueco de geocodificacion de `createManyOrdenesConGuia`
// ---------------------------------------------------------------------------------------------
describe("155/R11 — un encolado de geocodificacion por orden EFECTIVAMENTE insertada", () => {
  // BORRADO 2026-08-07: los tres primeros casos de este bloque ejercitaban `create` (alta
  // individual). El criterio que afirmaban —encolar UNA vez por orden efectivamente insertada,
  // y no-op si la direccion no es geocodificable— lo siguen afirmando los cuatro casos de
  // abajo sobre las dos rutas VIVAS.

  it("createManyOrdenesConGuia: HUECO CERRADO — encola por cada orden nueva", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany
      .mockResolvedValueOnce([]) // before: ninguna existe
      .mockResolvedValueOnce([
        {
          id: "o1",
          numRemision: "REM-1",
          estatusId: idEstado("por_recolectar_en_tienda"),
          direccion: DIRECCION_GEOCODIFICABLE,
          estatus: { value: "por_recolectar_en_tienda" },
        },
        {
          id: "o2",
          numRemision: "REM-2",
          estatusId: idEstado("por_recolectar_en_tienda"),
          direccion: DIRECCION_GEOCODIFICABLE,
          estatus: { value: "por_recolectar_en_tienda" },
        },
      ]);
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 1 });
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await repo.createManyOrdenesConGuia(
      [baseCreateData({ numRemision: "REM-1" }), baseCreateData({ numRemision: "REM-2" })],
      100,
      HIST_API,
      loteCtx({ totalFiles: 2 }), // feature 141: contexto del lote (4.o parametro)
    );

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map((c) => c[1])).toEqual([{ ordenId: "o1" }, { ordenId: "o2" }]);
  });

  it("createManyOrdenesConGuia: CERO encolados por las duplicadas que saltó skipDuplicates", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany
      // before: `o-vieja` ya existia
      .mockResolvedValueOnce([{ id: "o-vieja" }])
      .mockResolvedValueOnce([
        {
          id: "o-vieja",
          numRemision: "REM-VIEJA",
          estatusId: idEstado("por_recolectar_en_tienda"),
          direccion: DIRECCION_GEOCODIFICABLE,
          estatus: { value: "por_recolectar_en_tienda" },
        },
        {
          id: "o-nueva",
          numRemision: "REM-NUEVA",
          estatusId: idEstado("por_recolectar_en_tienda"),
          direccion: DIRECCION_GEOCODIFICABLE,
          estatus: { value: "por_recolectar_en_tienda" },
        },
      ]);
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 1 });
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    const { creadas } = await repo.createManyOrdenesConGuia(
      [
        baseCreateData({ numRemision: "REM-VIEJA" }),
        baseCreateData({ numRemision: "REM-NUEVA" }),
      ],
      100,
      HIST_API,
      loteCtx({ totalFiles: 2 }), // feature 141
    );

    expect(creadas.map((c) => c.ordenId)).toEqual(["o-nueva"]);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][1]).toEqual({ ordenId: "o-nueva" });
    // La duplicada tampoco consume guia (una sola sentencia de numeracion).
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("createManyOrdenes: sigue encolando por orden nueva (no-regresion)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "o1",
          estatusId: idEstado("en_preparacion"),
          direccion: DIRECCION_GEOCODIFICABLE,
        },
      ]);
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await repo.createManyOrdenes(
      [baseCreateData({ estatusId: idEstado("en_preparacion") })],
      100,
      HIST_MASIVA,
      loteCtx(), // feature 141
    );

    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("createManyOrdenesConGuia: no-op para las filas sin direccion geocodificable", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "o1",
        numRemision: "REM-1",
        estatusId: idEstado("por_recolectar_en_tienda"),
        direccion: null,
        estatus: { value: "por_recolectar_en_tienda" },
      },
    ]);
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 1 });
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await repo.createManyOrdenesConGuia([baseCreateData()], 100, HIST_API, loteCtx());

    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("155/R21 — createManyOrdenesConGuia con `conGuia: false`", () => {
  it("inserta y deja historial, pero NO consume secuencia y devuelve numGuia null", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "o1",
        numRemision: "REM-1",
        estatusId: idEstado("en_preparacion"),
        direccion: DIRECCION_GEOCODIFICABLE,
        estatus: { value: "en_preparacion" },
      },
    ]);
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    const { creadas } = await repo.createManyOrdenesConGuia(
      [baseCreateData({ estatusId: idEstado("en_preparacion") })],
      100,
      HIST_API,
      loteCtx(), // feature 141: el contexto del lote se cuela ANTES de `opciones`
      { conGuia: false },
    );

    expect(creadas).toEqual([
      {
        ordenId: "o1",
        numRemision: "REM-1",
        numGuia: null,
        estatusValue: "en_preparacion",
      },
    ]);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.orden.findUniqueOrThrow).not.toHaveBeenCalled();
    // El historial y el encolado NO dependen de la numeracion.
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("el DEFAULT de esa ruta sigue siendo numerar (los llamadores previos no cambian)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "o1",
        numRemision: "REM-1",
        estatusId: idEstado("por_recolectar_en_tienda"),
        direccion: DIRECCION_GEOCODIFICABLE,
        estatus: { value: "por_recolectar_en_tienda" },
      },
    ]);
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 4242 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const { creadas } = await repo.createManyOrdenesConGuia(
      [baseCreateData()],
      100,
      HIST_API,
      loteCtx(), // feature 141
    );

    expect(creadas[0].numGuia).toBe(4242);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
