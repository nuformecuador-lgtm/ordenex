import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RecuperacionBodegaRepository } from "@/lib/repositories/RecuperacionBodegaRepository";

// Feature 100 (T2.2) — repo de la RECUPERACION a bodega (molde de
// DevolucionSlaRepository.liberarDevueltaSla). Mockea Prisma (sin DB real; mocks bare +
// mockResolvedValue). El fake pasa el propio prisma como `tx` (tiene orden.updateMany + el choke
// point ordenHistorialEstado.createMany). Cubre R13 (destino por zona ya resuelto por el service),
// R14 (limpia mensajero + asignado_at), R17 (append actor=admin, origen_tipo=recuperacion_manual),
// R19 + feature 101/R3 (la recuperacion manual NO enciende prioridad: la columna ya existe pero el
// data no la toca; solo la liberacion por SLA 99 la enciende), R20 (append falla -> revierte),
// R21 (UPDATE guardado por estatus=devuelta; count 0 -> false).

function buildPrisma() {
  const prisma = {
    orden: { updateMany: vi.fn() },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.orden.updateMany.mockResolvedValue({ count: 1 });
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function repoWith(prisma: ReturnType<typeof buildPrisma>) {
  return new RecuperacionBodegaRepository(prisma as unknown as PrismaClient);
}

describe("recuperarABodega (R13/R14/R17/R21)", () => {
  it("R13/R14/R17: UPDATE guardado por estatus=devuelta -> destino, limpia mensajero + asignado_at, append actor=admin", async () => {
    const prisma = buildPrisma();

    const ok = await repoWith(prisma).recuperarABodega({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega-satelite",
      estatusDevueltaId: "os-devuelta",
      actorUsuarioId: "admin-1",
    });

    expect(ok).toBe(true);
    const upd = prisma.orden.updateMany.mock.calls[0][0];
    // R21: guarda por estado + no borrada.
    expect(upd.where).toEqual({ id: "o1", estatusId: "os-devuelta", deletedAt: null });
    // R13/R14: destino de bodega + handoff limpio (mensajero + asignado_at a null).
    expect(upd.data).toEqual({
      estatusId: "os-en-bodega-satelite",
      mensajeroAsignadoId: null,
      asignadoAt: null,
    });
    // R17: append por el choke point, actor = el admin (NO NULL), origen_tipo recuperacion_manual.
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const hist = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(hist.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-devuelta",
        estatusDestinoId: "os-en-bodega-satelite",
        actorUsuarioId: "admin-1", // R17: trazabilidad del actor (no del cron)
        origenTipo: "recuperacion_manual", // R17
        motivo: null, // el choke point normaliza a null (no hay motivo en una recuperacion)
        gestionOrdenId: null, // R14: no enlaza gestion (handoff limpio, molde de liberarDevueltaSla)
      },
    ]);
  });

  it("R13: el destino de bodega CENTRAL (resuelto por el service) se aplica tal cual", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).recuperarABodega({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega", // central
      estatusDevueltaId: "os-devuelta",
      actorUsuarioId: "maestro-1",
    });
    expect(prisma.orden.updateMany.mock.calls[0][0].data.estatusId).toBe("os-en-bodega");
    expect(prisma.ordenHistorialEstado.createMany.mock.calls[0][0].data[0].estatusDestinoId).toBe(
      "os-en-bodega",
    );
  });

  it("R19 + feature 101/R3: la recuperacion MANUAL NO enciende `orden.prioridad` (la columna existe, pero el data no la toca) — data solo trae estatus + mensajero", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).recuperarABodega({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega",
      estatusDevueltaId: "os-devuelta",
      actorUsuarioId: "maestro-1",
    });
    const data = prisma.orden.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("prioridad");
    expect(Object.keys(data).sort()).toEqual(["asignadoAt", "estatusId", "mensajeroAsignadoId"]);
  });

  it("R21: 2.ª corrida / carrera con el cron 99 -> count 0 -> false, sin append", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });

    const ok = await repoWith(prisma).recuperarABodega({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega",
      estatusDevueltaId: "os-devuelta",
      actorUsuarioId: "admin-1",
    });

    expect(ok).toBe(false);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R20: si el append al historial falla, la tx revierte (propaga el error -> rollback)", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.createMany.mockRejectedValue(new Error("historial down"));

    await expect(
      repoWith(prisma).recuperarABodega({
        ordenId: "o1",
        destinoEstatusId: "os-en-bodega",
        estatusDevueltaId: "os-devuelta",
        actorUsuarioId: "admin-1",
      }),
    ).rejects.toThrow("historial down");
  });
});
