import { describe, it, expect, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 34 — repo de la asignacion satelite. `asignarSateliteLote` es un UPDATE
// guardado por estado de origen + zona (patron `recibirEnSatelite`). Feature 41/R23:
// es un raw con `NOT EXISTS` de cierre bloqueante (anti-TOCTOU) en el MISMO UPDATE.
// Feature 49/#7: el raw pasa a `$queryRaw ... RETURNING "id"` DENTRO de un `$transaction`,
// y con los ids retornados hace el append del historial en la MISMA tx. El count que
// consume el service = `rows.length` (mismo contrato). Una orden que pierde la guarda
// anti-TOCTOU no aparece en el RETURNING -> no deja rastro (R8).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    ordenHistorialEstado: { createMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    ...overrides,
  };
  return { prisma, tx };
}

// Feature 49/#7: contexto de historial (actor = el adminSatelite que asigna).
const HIST_ASIGNACION = {
  actorUsuarioId: "adminsat-1",
  origenTipo: "asignacion_satelite",
} as const;

describe("OrdenRepository.asignarSateliteLote (feature 34/R7/R14 + feature 41/R23 + feature 49/#7)", () => {
  it("ejecuta un UPDATE raw con guardia estado+zona+NOT EXISTS y RETURNING; count = filas transicionadas", async () => {
    const { prisma, tx } = buildPrisma();
    // La DB solo transiciona las que siguen en el origen de la zona y sin bloqueo: 2 de 3.
    tx.$queryRaw.mockResolvedValue([{ id: "o1" }, { id: "o2" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarSateliteLote(
      ["o1", "o2", "o3"],
      "m-1",
      "z-satelite",
      "os-espera",
      "os-bodega-satelite",
      HIST_ASIGNACION,
    );

    // R14/R23: count refleja solo lo transicionado (rows.length del RETURNING).
    expect(count).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    // `$queryRaw` se invoca como tagged template: call[0] = fragmentos de texto (SQL),
    // call[1..] = valores interpolados. Se verifica el SQL y los parametros.
    const call = tx.$queryRaw.mock.calls[0] as unknown[];
    const strings = (call[0] as string[]).join(" ");
    const values = call.slice(1);
    expect(values).toContain("m-1");
    expect(values).toContain("os-espera");
    expect(values).toContain("os-bodega-satelite");
    expect(values).toContain("z-satelite");
    // R8: la sentencia NO menciona num_guia.
    expect(strings).not.toMatch(/num_guia/);
    // R23: el NOT EXISTS de cierre bloqueante sobre cierre_dia sigue INTACTO (anti-TOCTOU).
    expect(strings).toMatch(/NOT EXISTS/);
    expect(strings).toMatch(/cierre_dia/);
    // Feature 49/#7: RETURNING "id" para atar el historial a las filas realmente transicionadas.
    expect(strings).toMatch(/RETURNING "id"/);
    // Feature 76/R23 (W3): el SET estampa asignado_at = NOW() junto a la asignacion.
    expect(strings).toMatch(/"asignado_at" = NOW\(\)/);
    // Feature 101/R5 (gate F1.4-Q1): el SET apaga prioridad al reasignar desde bodega satelite.
    expect(strings).toMatch(/"prioridad" = false/);
  });

  // Feature 49/#7 (R15/R8): SOLO las ordenes que ganaron la guarda anti-TOCTOU dejan rastro.
  it("R15/R8: registra historial (asignacion_satelite) solo de los ids retornados", async () => {
    const { prisma, tx } = buildPrisma();
    // De 2 pedidas, una perdio la guarda (bloqueo por cierre) -> solo o1 en el RETURNING.
    tx.$queryRaw.mockResolvedValue([{ id: "o1" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarSateliteLote(
      ["o1", "o2"],
      "m-1",
      "z-satelite",
      "os-espera",
      "os-bodega-satelite",
      HIST_ASIGNACION,
    );

    expect(count).toBe(1);
    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    // Origen = el estatus de la guarda (os-bodega-satelite); solo o1, no o2.
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-bodega-satelite",
        estatusDestinoId: "os-espera",
        actorUsuarioId: "adminsat-1",
        origenTipo: "asignacion_satelite",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("count 0 cuando ninguna orden matchea (o el mensajero quedo bloqueado); no deja rastro", async () => {
    const { prisma, tx } = buildPrisma();
    tx.$queryRaw.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarSateliteLote(
      ["o1"],
      "m-1",
      "z-satelite",
      "os-espera",
      "os-bodega-satelite",
      HIST_ASIGNACION,
    );

    expect(count).toBe(0);
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("devuelve 0 sin abrir transaccion cuando ordenIds esta vacio", async () => {
    const { prisma, tx } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(
      await repo.asignarSateliteLote(
        [],
        "m-1",
        "z-satelite",
        "os-espera",
        "os-bodega-satelite",
        HIST_ASIGNACION,
      ),
    ).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
