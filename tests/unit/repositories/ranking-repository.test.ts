import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RankingRepository } from "@/lib/repositories/RankingRepository";

// Feature 76 (R1) — repo de agregacion del ranking DIARIO con Prisma mockeado (sin DB). El
// rango del dia (CR) llega ya calculado por el service (desde/hasta); el repo no usa Date.now.

const DESDE = new Date("2026-07-16T06:00:00.000Z"); // startOfDayCR de un dia
const HASTA = new Date("2026-07-17T06:00:00.000Z"); // +24h

describe("RankingRepository.contarEntregadasPorMensajero (R1 numerador)", () => {
  it("agrupa por mensajeroId con resultado=entregada, VIGENTES y en el rango HOY(CR)", async () => {
    const groupBy = vi.fn(async () => [
      { mensajeroId: "m1", _count: { _all: 4 } },
      { mensajeroId: "m2", _count: { _all: 1 } },
    ]);
    const repo = new RankingRepository({ gestionOrden: { groupBy } } as unknown as PrismaClient);

    const rows = await repo.contarEntregadasPorMensajero(DESDE, HASTA);

    expect(rows).toEqual([
      { mensajeroId: "m1", total: 4 },
      { mensajeroId: "m2", total: 1 },
    ]);
    const arg = (groupBy.mock.calls[0] as unknown[])[0] as {
      by: string[];
      where: Record<string, unknown>;
    };
    expect(arg.by).toEqual(["mensajeroId"]);
    expect(arg.where.resultado).toBe("entregada"); // solo entregas exitosas
    expect(arg.where.anuladaAt).toBeNull(); // feature 67: solo VIGENTES (excluye anuladas)
    expect(arg.where.createdAt).toEqual({ gte: DESDE, lt: HASTA }); // HOY(CR) half-open
  });
});

describe("RankingRepository.contarAsignadasPorMensajero (R1 denominador)", () => {
  it("agrupa por mensajeroAsignadoId no nulo con asignadoAt en el rango HOY(CR)", async () => {
    const groupBy = vi.fn(async () => [
      { mensajeroAsignadoId: "m1", _count: { _all: 5 } },
      { mensajeroAsignadoId: "m2", _count: { _all: 2 } },
    ]);
    const repo = new RankingRepository({ orden: { groupBy } } as unknown as PrismaClient);

    const rows = await repo.contarAsignadasPorMensajero(DESDE, HASTA);

    expect(rows).toEqual([
      { mensajeroId: "m1", total: 5 },
      { mensajeroId: "m2", total: 2 },
    ]);
    const arg = (groupBy.mock.calls[0] as unknown[])[0] as {
      by: string[];
      where: Record<string, unknown>;
    };
    expect(arg.by).toEqual(["mensajeroAsignadoId"]);
    expect(arg.where.mensajeroAsignadoId).toEqual({ not: null }); // solo asignadas
    expect(arg.where.asignadoAt).toEqual({ gte: DESDE, lt: HASTA }); // via columna nueva (DS1)
  });

  it("descarta filas residuales con mensajeroAsignadoId null sin afectar el conteo", async () => {
    const groupBy = vi.fn(async () => [
      { mensajeroAsignadoId: "m1", _count: { _all: 3 } },
      { mensajeroAsignadoId: null, _count: { _all: 9 } },
    ]);
    const repo = new RankingRepository({ orden: { groupBy } } as unknown as PrismaClient);

    const rows = await repo.contarAsignadasPorMensajero(DESDE, HASTA);

    expect(rows).toEqual([{ mensajeroId: "m1", total: 3 }]);
  });
});
