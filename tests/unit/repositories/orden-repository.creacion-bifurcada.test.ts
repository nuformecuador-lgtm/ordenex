import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { CreateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 155 (T3.1/T3.2) — el lado REPOSITORIO de la bifurcacion de creacion:
//   R3/R8  `create` puede numerar en la MISMA tx, con la guarda idempotente `num_guia IS NULL`
//   R11    las TRES rutas de creacion encolan geocodificacion por orden EFECTIVAMENTE insertada
//   R12    todo-o-nada: estado, guia, historial y encolado se cometen o se revierten juntos
//   R21    `createManyOrdenesConGuia` con `conGuia: false` no consume secuencia (numGuia null)
//
// El fake de Prisma ejecuta el callback de `$transaction` con el propio objeto como `tx`, igual
// que el resto de tests de repositorio del repo.

const HIST_MANUAL = { actorUsuarioId: "u-actor", origenTipo: "creacion_manual" } as const;
const HIST_API = { actorUsuarioId: "key-user-1", origenTipo: "carga_api" } as const;
const HIST_MASIVA = { actorUsuarioId: "store-1", origenTipo: "carga_masiva" } as const;

const DIRECCION_GEOCODIFICABLE = "Av. Central, 200m norte del parque";

function ordenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ord-1",
    numGuia: null as number | null,
    numRemision: "REM-1",
    estatusId: idEstado("por_recolectar_en_tienda"),
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: new Prisma.Decimal("1.500"),
    notas: null,
    direccion: DIRECCION_GEOCODIFICABLE,
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    estatus: { value: "por_recolectar_en_tienda" },
    mensajeroAsignadoId: null,
    prioridad: false,
    ...overrides,
  };
}

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
describe("155/R3/R8 — OrdenRepository.create con `conGuia`", () => {
  it("conGuia: true numera en la MISMA tx y devuelve el DTO ya numerado", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow({ numGuia: null }));
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 100234 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true });

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    // El DTO refleja el estado FINAL de la fila: el `row` del create es previo al UPDATE.
    expect(dto.numGuia).toBe(100234);
    // Todo dentro de UNA sola transaccion.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("conGuia: false (y el default) NO tocan la secuencia: la orden nace sin guia", async () => {
    for (const opciones of [undefined, {}, { conGuia: false }]) {
      const prisma = buildPrisma();
      prisma.orden.create.mockResolvedValue(ordenRow({ numGuia: null }));
      const repo = new OrdenRepository(prisma as unknown as PrismaClient);

      const dto = await repo.create(baseCreateData(), HIST_MANUAL, opciones);

      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(prisma.orden.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(dto.numGuia).toBeNull();
    }
  });

  it("R8: usa la MISMA secuencia atomica del resto del sistema, con la guarda idempotente", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 7 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true });

    const [sql, param] = prisma.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("siguiente_num_guia()");
    // La guarda es lo que hace la operacion idempotente: nunca reasigna una guia existente.
    expect(sql).toContain("num_guia IS NULL");
    // El id viaja como PARAMETRO, jamas interpolado en el SQL.
    expect(sql).toContain("$1");
    expect(param).toBe("ord-1");
    expect(sql).not.toContain("ord-1");
  });

  it("R8: sobre una orden que YA tiene guia, la guarda impide consumir un segundo numero", async () => {
    // Se simula la semantica del `WHERE num_guia IS NULL`: el UPDATE no afecta filas y la
    // relectura devuelve la guia previa. El repositorio NO debe fabricar otra.
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow({ numGuia: 555 }));
    prisma.$executeRawUnsafe.mockResolvedValue(0); // 0 filas afectadas
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 555 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true });

    expect(dto.numGuia).toBe(555);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1); // una sola sentencia, no dos
  });

  it("nunca miente con un `as number`: si la relectura vuelve NULL, lanza", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: null });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true })).rejects.toThrow(
      /num_guia no asignado/,
    );
  });

  it("R10: la numeracion va ANTES del historial, y el historial se registra igual", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 9 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true });

    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data[0]).toMatchObject({
      estatusOrigenId: null, // creacion
      estatusDestinoId: idEstado("por_recolectar_en_tienda"),
      origenTipo: "creacion_manual",
    });
  });

  it("R9: la creacion NUNCA escribe mensajero_asignado_id, tampoco en la rama con guia", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 9 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true });

    const data = prisma.orden.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("mensajeroAsignadoId");
    expect(data).not.toHaveProperty("numGuia");
  });
});

describe("155/R12 — todo-o-nada de la creacion con guia", () => {
  it("si el historial falla, la tx aborta (la guia consumida se revierte con ella)", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 9 });
    prisma.ordenHistorialEstado.createMany.mockRejectedValue(new Error("append boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true })).rejects.toThrow(
      "append boom",
    );
  });

  it("si el encolado de geocodificacion falla, la tx aborta", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 9 });
    const jobRepo = {
      enqueue: vi.fn().mockRejectedValue(new Error("outbox boom")),
    } as unknown as IJobRepository;
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await expect(repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true })).rejects.toThrow(
      "outbox boom",
    );
  });

  it("si la numeracion falla, ni historial ni encolado llegan a ejecutarse", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    prisma.$executeRawUnsafe.mockRejectedValue(new Error("secuencia caida"));
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await expect(repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true })).rejects.toThrow(
      "secuencia caida",
    );
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// T3.2 — el hueco de geocodificacion de `createManyOrdenesConGuia`
// ---------------------------------------------------------------------------------------------
describe("155/R11 — un encolado de geocodificacion por orden EFECTIVAMENTE insertada", () => {
  it("create: encola una vez", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await repo.create(baseCreateData(), HIST_MANUAL);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toBe("geocodificacion");
    expect(enqueue.mock.calls[0][1]).toEqual({ ordenId: "ord-1" }); // R14: solo el id
  });

  it("create con guia: encola exactamente igual (la rama no cambia el criterio)", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    prisma.orden.findUniqueOrThrow.mockResolvedValue({ numGuia: 3 });
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await repo.create(baseCreateData(), HIST_MANUAL, { conGuia: true });

    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("create: no-op si la direccion no es geocodificable", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow({ direccion: "   " }));
    const { jobRepo, enqueue } = buildJobRepo();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient, jobRepo);

    await repo.create(baseCreateData({ direccion: "   " }), HIST_MANUAL);

    expect(enqueue).not.toHaveBeenCalled();
  });

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

    const creadas = await repo.createManyOrdenesConGuia(
      [
        baseCreateData({ numRemision: "REM-VIEJA" }),
        baseCreateData({ numRemision: "REM-NUEVA" }),
      ],
      100,
      HIST_API,
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

    await repo.createManyOrdenesConGuia([baseCreateData()], 100, HIST_API);

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

    const creadas = await repo.createManyOrdenesConGuia(
      [baseCreateData({ estatusId: idEstado("en_preparacion") })],
      100,
      HIST_API,
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

    const creadas = await repo.createManyOrdenesConGuia([baseCreateData()], 100, HIST_API);

    expect(creadas[0].numGuia).toBe(4242);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
