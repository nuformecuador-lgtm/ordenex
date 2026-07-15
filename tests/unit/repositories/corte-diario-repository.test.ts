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

  // Feature 64/R17: una gestion ANULADA (deshecha) NO es "actividad del dia pendiente de
  // cierre". Un mensajero cuyas unicas gestiones del dia estan anuladas NO debe recibir un
  // cierre `vencido` del corte diario (que ademas lo bloquearia para nuevas asignaciones).
  it("64/R17: el WHERE exige `anuladaAt: null` (las gestiones deshechas no son actividad pendiente)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    await repo.findMensajerosConActividadSinCierre();

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ cierreId: null, anuladaAt: null });
  });

  it("64/R17: un mensajero cuya unica gestion pendiente esta anulada queda FUERA del corte", async () => {
    const prisma = buildPrisma();
    // El WHERE `{ cierreId: null, anuladaAt: null }` no devuelve a m2 (su unica gestion del dia
    // esta anulada): la query ya lo excluye en la base, no hace falta filtrar en memoria.
    prisma.gestionOrden.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      expect(args.where.anuladaAt).toBe(null); // sin este filtro, m2 entraria al corte
      return [{ mensajeroId: "m1", mensajero: { zonaId: "z1" } }];
    });
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
    expect(rows.map((r) => r.mensajeroId)).not.toContain("m2");
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
