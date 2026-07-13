import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";

// Feature 41/C2 (R7/R10) — repo del corte diario. `findMensajerosConActividadSinCierre`
// devuelve los mensajeros con gestiones sin cerrar (cierre_id IS NULL) menos los que ya
// tienen un cierre `solicitado`. Mockea Prisma (sin DB real).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    gestionOrden: { findMany: vi.fn() },
    cierreDia: { findMany: vi.fn() },
    ...overrides,
  };
}

describe("CorteDiarioRepository.findMensajerosConActividadSinCierre (R7/R10)", () => {
  it("R7: filtra gestiones por cierreId null, distinct por mensajero, trae su zona", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
    ]);
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ cierreId: null });
    expect(arg.distinct).toEqual(["mensajeroId"]);
    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
  });

  it("R10: excluye al mensajero que ya tiene un cierre 'solicitado' pendiente", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
      { mensajeroId: "m2", mensajero: { zonaId: "z2" } },
    ]);
    // m2 ya solicito -> no se le crea vencido.
    prisma.cierreDia.findMany.mockResolvedValue([{ mensajeroId: "m2" }]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
    // la consulta de solicitados filtra por estado='solicitado' sobre los ids candidatos.
    const cierreArg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(cierreArg.where).toMatchObject({ estado: "solicitado" });
    expect(cierreArg.where.mensajeroId.in.sort()).toEqual(["m1", "m2"]);
  });

  it("sin actividad pendiente -> lista vacia, sin consultar cierres", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([]);
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });

  it("propaga zonaId null (P2 lo maneja el service, no el repo)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: null } },
    ]);
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: null }]);
  });
});
