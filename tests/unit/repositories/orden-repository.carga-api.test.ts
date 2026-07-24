import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { CreateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 88 — createManyOrdenesConGuia: inserta el lote y, en la MISMA tx, asigna
// num_guia inmediato (misma secuencia `orden_num_guia_seq` que "Generar guia") y deja el
// historial (origen null -> en_ruta_bodega_central, origenTipo carga_api). El fake de
// prisma invoca el callback de `$transaction` con el propio prisma como `tx`.
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: vi.fn(),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

// Contexto de historial de la carga por API (actor = usuario dedicado de la key).
const HIST_API = { actorUsuarioId: "key-user-1", origenTipo: "carga_api" } as const;

function baseCreateData(overrides: Partial<CreateOrdenData> = {}): CreateOrdenData {
  return {
    numRemision: "REM-1",
    estatusId: "os-erbp", // en_ruta_bodega_central ya resuelto por el service
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "key-user-1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    producto: "Caja",
    peso: null,
    ...overrides,
  };
}

describe("OrdenRepository.createManyOrdenesConGuia (feature 88)", () => {
  it("R9: N ordenes nuevas -> N num_guia distintos y consecutivos desde la secuencia", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany
      .mockResolvedValueOnce([]) // before: ninguna existe
      .mockResolvedValueOnce([
        { id: "o1", numRemision: "REM-1", estatusId: "os-erbp", estatus: { value: "en_ruta_bodega_central" } },
        { id: "o2", numRemision: "REM-2", estatusId: "os-erbp", estatus: { value: "en_ruta_bodega_central" } },
      ]); // after: ambas nuevas
    // La secuencia real es atomica; aqui la simulamos consecutiva por orden numerada.
    prisma.orden.findUniqueOrThrow
      .mockResolvedValueOnce({ numGuia: 1001 })
      .mockResolvedValueOnce({ numGuia: 1002 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const creadas = await repo.createManyOrdenesConGuia(
      [baseCreateData({ numRemision: "REM-1" }), baseCreateData({ numRemision: "REM-2" })],
      500,
      HIST_API,
    );

    expect(creadas).toEqual([
      { ordenId: "o1", numRemision: "REM-1", numGuia: 1001, estatusValue: "en_ruta_bodega_central" },
      { ordenId: "o2", numRemision: "REM-2", numGuia: 1002, estatusValue: "en_ruta_bodega_central" },
    ]);
    // Guias distintas.
    expect(new Set(creadas.map((c) => c.numGuia)).size).toBe(2);
  });

  it("R9: consume la MISMA secuencia orden_num_guia_seq con guarda idempotente (sin interpolar entrada)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "o1", numRemision: "REM-1", estatusId: "os-erbp", estatus: { value: "en_ruta_bodega_central" } },
      ]);
    prisma.orden.findUniqueOrThrow.mockResolvedValueOnce({ numGuia: 5 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenesConGuia([baseCreateData()], 500, HIST_API);

    // El SQL usa la secuencia por su nombre constante (misma que generarGuiaLote) y la
    // guarda `num_guia IS NULL` (idempotencia); el id viaja como parametro, no interpolado.
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, idParam] = prisma.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("siguiente_num_guia()");
    expect(sql).toContain("num_guia IS NULL");
    expect(idParam).toBe("o1");
  });

  it("R8: deja 1 historial por orden creada (origen null -> destino inicial, origenTipo carga_api)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "o1", numRemision: "REM-1", estatusId: "os-erbp", estatus: { value: "en_ruta_bodega_central" } },
      ]);
    prisma.orden.findUniqueOrThrow.mockResolvedValueOnce({ numGuia: 7 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenesConGuia([baseCreateData()], 500, HIST_API);

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: null, // creacion (R20)
        estatusDestinoId: "os-erbp", // en_ruta_bodega_central (R8)
        actorUsuarioId: "key-user-1",
        origenTipo: "carga_api", // D7
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("R11: fila duplicada (ya existia antes del insert) -> no crea, no consume guia, no deja rastro", async () => {
    const prisma = buildPrisma();
    // REM-1 ya existia (before); tras el insert sigue existiendo (after) -> ninguna nueva.
    prisma.orden.findMany
      .mockResolvedValueOnce([{ id: "o-existing" }])
      .mockResolvedValueOnce([
        { id: "o-existing", numRemision: "REM-1", estatusId: "os-x", estatus: { value: "en_bodega_central" } },
      ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const creadas = await repo.createManyOrdenesConGuia([baseCreateData({ numRemision: "REM-1" })], 500, HIST_API);

    expect(creadas).toEqual([]);
    // No se consume num_guia para la duplicada (R11).
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    // appendCambioEstado con lote vacio -> no-op (no crea historial).
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("mezcla nueva + duplicada: solo la nueva recibe guia e historial", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany
      .mockResolvedValueOnce([{ id: "o-existing" }]) // REM-2 preexiste
      .mockResolvedValueOnce([
        { id: "o-existing", numRemision: "REM-2", estatusId: "os-x", estatus: { value: "en_bodega_central" } },
        { id: "o-new", numRemision: "REM-1", estatusId: "os-erbp", estatus: { value: "en_ruta_bodega_central" } },
      ]);
    prisma.orden.findUniqueOrThrow.mockResolvedValueOnce({ numGuia: 9 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const creadas = await repo.createManyOrdenesConGuia(
      [baseCreateData({ numRemision: "REM-1" }), baseCreateData({ numRemision: "REM-2" })],
      500,
      HIST_API,
    );

    expect(creadas).toEqual([
      { ordenId: "o-new", numRemision: "REM-1", numGuia: 9, estatusValue: "en_ruta_bodega_central" },
    ]);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1); // solo la nueva consume guia
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
  });
});
