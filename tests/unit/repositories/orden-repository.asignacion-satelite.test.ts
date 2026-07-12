import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 34 — repo de la asignacion satelite. `asignarSateliteLote` es un
// `updateMany` guardado por estado de origen + zona (patron `recibirEnSatelite`);
// aqui se verifica el WHERE (guardia) y el data (sin tocar num_guia), y que el
// `count` refleja lo transicionado.

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      updateMany: vi.fn(),
    },
    ...overrides,
  };
  return { prisma };
}

describe("OrdenRepository.asignarSateliteLote (feature 34/R7/R14)", () => {
  it("updateMany guardado por estado de origen + zona + no borrada; fija mensajero/estatus sin tocar num_guia", async () => {
    const { prisma } = buildPrisma();
    // La DB solo transiciona las que siguen en el origen de la zona: 2 de 3.
    prisma.orden.updateMany.mockResolvedValue({ count: 2 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarSateliteLote(
      ["o1", "o2", "o3"],
      "m-1",
      "z-satelite",
      "os-espera",
      "os-bodega-satelite",
    );

    // R14: count refleja solo lo transicionado (o3 quedo en otro estado/zona).
    expect(count).toBe(2);
    const arg = prisma.orden.updateMany.mock.calls[0][0];
    // Guardia en el WHERE: id IN lote AND estatusId = origen AND zona AND no borrada.
    expect(arg.where).toEqual({
      id: { in: ["o1", "o2", "o3"] },
      estatusId: "os-bodega-satelite",
      zonaId: "z-satelite",
      deletedAt: null,
    });
    // R7/R8: fija mensajero + estatus destino; NUNCA toca numGuia.
    expect(arg.data).toEqual({ mensajeroAsignadoId: "m-1", estatusId: "os-espera" });
    expect(arg.data).not.toHaveProperty("numGuia");
  });

  it("una orden en otro estado o de otra zona no se toca (guardia por estatusId+zona)", async () => {
    const { prisma } = buildPrisma();
    // Ninguna matchea el origen/zona -> count 0 (todas ya movidas o de otra zona).
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarSateliteLote(
      ["o1"],
      "m-1",
      "z-satelite",
      "os-espera",
      "os-bodega-satelite",
    );

    expect(count).toBe(0);
  });

  it("devuelve 0 sin consultar cuando ordenIds esta vacio", async () => {
    const { prisma } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(
      await repo.asignarSateliteLote([], "m-1", "z-satelite", "os-espera", "os-bodega-satelite"),
    ).toBe(0);
    expect(prisma.orden.updateMany).not.toHaveBeenCalled();
  });
});
