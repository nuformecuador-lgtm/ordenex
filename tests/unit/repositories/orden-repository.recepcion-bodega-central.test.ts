import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 138 — repo de la recepcion en la BODEGA CENTRAL. Prisma se mockea con dobles
// simples (patron orden-repository.recepcion-satelite.test.ts): sin DB real, se verifica la
// forma de la query (where/data) y la atomicidad del append. Espejo de `recibirEnSatelite`
// SIN la guarda de zona/tienda: la UNICA guarda es el estado de ORIGEN + no borrada (R11).
// Feature 49/#21: recibirEnBodegaCentral envuelve el updateMany guardado en `$transaction`
// (pre-lectura del origen + append en la misma tx). El fake `$transaction` pasa el propio
// prisma como `tx`.
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

// Contexto de historial: actor = el maestro/admin que recibe por QR; tipo propio (R17).
const HIST_RECEPCION = {
  actorUsuarioId: "u-maestro",
  origenTipo: "recepcion_bodega_central",
} as const;

describe("OrdenRepository.recibirEnBodegaCentral (R2/R3/R9/R18 · feature 49/#21)", () => {
  it("R2/R11/R18: UPDATE guardado por id+deletedAt+origen (SIN zona/tienda); true si afecto 1 fila", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: "os-ruta-central" });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const ok = await repo.recibirEnBodegaCentral("o1", "os-en-bodega-central", HIST_RECEPCION);

    expect(ok).toBe(true);
    const arg = prisma.orden.updateMany.mock.calls[0][0];
    // R11: guarda SOLO por estado de origen + no borrada. SIN zonaId ni tiendaId.
    expect(arg.where).toEqual({
      id: "o1",
      deletedAt: null,
      estatus: { value: "en_ruta_bodega_central" },
    });
    expect(arg.where).not.toHaveProperty("zonaId");
    expect(arg.where).not.toHaveProperty("tiendaId");
    // R18: solo fija estatusId; NO toca mensajeroAsignadoId ni numGuia.
    expect(arg.data).toEqual({ estatusId: "os-en-bodega-central" });
    expect(arg.data).not.toHaveProperty("mensajeroAsignadoId");
    expect(arg.data).not.toHaveProperty("numGuia");
  });

  it("R11: la pre-lectura del origen tampoco acota por zona/tienda", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: "os-ruta-central" });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.recibirEnBodegaCentral("o1", "os-en-bodega-central", HIST_RECEPCION);

    const arg = prisma.orden.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({
      id: "o1",
      deletedAt: null,
      estatus: { value: "en_ruta_bodega_central" },
    });
    expect(arg.where).not.toHaveProperty("zonaId");
    expect(arg.where).not.toHaveProperty("tiendaId");
  });

  // Feature 49/#21 (R3): al recibir, 1 historial (origen en_ruta_bodega_central -> en_bodega_central).
  it("R3/R17: recepcion deja 1 historial con origen pre-leido y tipo recepcion_bodega_central", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: "os-ruta-central" });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.recibirEnBodegaCentral("o1", "os-en-bodega-central", HIST_RECEPCION);

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-ruta-central",
        estatusDestinoId: "os-en-bodega-central",
        actorUsuarioId: "u-maestro",
        origenTipo: "recepcion_bodega_central",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("R9/R3: false si el UPDATE no afecto filas (race); NO deja rastro", async () => {
    const prisma = buildPrisma();
    // Perdio la carrera: la pre-lectura ya no encuentra la orden en el origen (o cambio).
    prisma.orden.findFirst.mockResolvedValue(null);
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(
      await repo.recibirEnBodegaCentral("o1", "os-en-bodega-central", HIST_RECEPCION),
    ).toBe(false);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R3: envuelve el updateMany + append en UNA transaccion (atomicidad)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: "os-ruta-central" });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.recibirEnBodegaCentral("o1", "os-en-bodega-central", HIST_RECEPCION);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
