import { describe, it, expect, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 34 — repo de la asignacion satelite. `asignarSateliteLote` es un UPDATE
// guardado por estado de origen + zona (patron `recibirEnSatelite`). Feature 41/R23:
// ahora es un `$executeRaw` con `NOT EXISTS` de cierre bloqueante (anti-TOCTOU) en el
// MISMO UPDATE; el `count` refleja lo transicionado (0 si el mensajero quedo bloqueado
// o si las ordenes ya cambiaron de estado/zona).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    $executeRaw: vi.fn(),
    ...overrides,
  };
  return { prisma };
}

describe("OrdenRepository.asignarSateliteLote (feature 34/R7/R14 + feature 41/R23)", () => {
  it("ejecuta un UPDATE raw con guardia de estado+zona+NOT EXISTS; count = filas transicionadas", async () => {
    const { prisma } = buildPrisma();
    // La DB solo transiciona las que siguen en el origen de la zona y sin bloqueo: 2 de 3.
    prisma.$executeRaw.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarSateliteLote(
      ["o1", "o2", "o3"],
      "m-1",
      "z-satelite",
      "os-espera",
      "os-bodega-satelite",
    );

    // R14/R23: count refleja solo lo transicionado.
    expect(count).toBe(2);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // `$executeRaw` se invoca como tagged template: call[0] = fragmentos de texto (SQL),
    // call[1..] = valores interpolados. Se verifica el SQL y los parametros.
    const call = prisma.$executeRaw.mock.calls[0] as unknown[];
    const strings = (call[0] as string[]).join(" ");
    const values = call.slice(1);
    expect(values).toContain("m-1");
    expect(values).toContain("os-espera");
    expect(values).toContain("os-bodega-satelite");
    expect(values).toContain("z-satelite");
    // R8: la sentencia NO menciona num_guia.
    expect(strings).not.toMatch(/num_guia/);
    // R23: el NOT EXISTS de cierre bloqueante sobre cierre_dia esta presente.
    expect(strings).toMatch(/NOT EXISTS/);
    expect(strings).toMatch(/cierre_dia/);
  });

  it("count 0 cuando ninguna orden matchea (o el mensajero quedo bloqueado)", async () => {
    const { prisma } = buildPrisma();
    prisma.$executeRaw.mockResolvedValue(0);
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
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
