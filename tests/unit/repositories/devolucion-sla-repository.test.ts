import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";

// Feature 99 (T6/T7/T8) — repo del cron SLA. Mockea Prisma (sin DB real, patron
// liberacion-reprogramada-repository.test.ts). Cubre: findDevueltasSla deriva causa + ancladaAt +
// mensajero de la gestion `devuelta` vigente (R5); liberar (UPDATE guardado por estado +
// mensajero null + append liberacion_devuelta_sla, R15/R18/R19/R24/R25); escalar (Option A del
// dinero: gestion sintetica `rechazada` del mensajero, `cierre_id null`, append
// escalado_devuelta_sla; idempotente por estado, R16/R17/R18/R19/R20-R25).

// El fake pasa el propio prisma como `tx` (tiene orden.updateMany + gestionOrden.create + el
// choke point ordenHistorialEstado.createMany).
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: { findMany: vi.fn(), updateMany: vi.fn() },
    gestionOrden: { create: vi.fn(async () => ({ id: "g-sintetica" })) },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function repoWith(prisma: ReturnType<typeof buildPrisma>) {
  return new DevolucionSlaRepository(prisma as unknown as PrismaClient);
}

describe("findDevueltasSla (R5)", () => {
  it("R5: filtra por estatus devuelta + no borrada; deriva causa, ancladaAt y mensajero de la gestion vigente", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "o1",
        zonaId: "z1",
        gestiones: [
          {
            mensajeroId: "m1",
            causaDevolucion: "not_found",
            createdAt: new Date("2026-07-15T06:00:00.000Z"),
          },
        ],
      },
    ]);
    const rows = await repoWith(prisma).findDevueltasSla();

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null, estatus: { value: "devuelta" } });
    // La gestion vigente = la mas reciente NO anulada.
    expect(arg.select.gestiones).toMatchObject({
      where: { resultado: "devuelta", anuladaAt: null },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(rows).toEqual([
      {
        ordenId: "o1",
        zonaId: "z1",
        mensajeroId: "m1",
        causa: "not_found",
        ancladaAt: new Date("2026-07-15T06:00:00.000Z"),
      },
    ]);
  });

  it("R28: una orden con gestion vigente pero SIN causa (pre-73) SI sale (el service la omite)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "o1",
        zonaId: "z1",
        gestiones: [{ mensajeroId: "m1", causaDevolucion: null, createdAt: new Date() }],
      },
    ]);
    const rows = await repoWith(prisma).findDevueltasSla();
    expect(rows).toHaveLength(1);
    expect(rows[0].causa).toBeNull();
  });

  it("ignora ordenes en devuelta SIN gestion `devuelta` vigente (anomalia sin anclaje)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { id: "o1", zonaId: "z1", gestiones: [] },
      { id: "o2", zonaId: "z2", gestiones: [{ mensajeroId: "m2", causaDevolucion: "wrong_number", createdAt: new Date("2026-07-10T00:00:00Z") }] },
    ]);
    const rows = await repoWith(prisma).findDevueltasSla();
    expect(rows.map((r) => r.ordenId)).toEqual(["o2"]);
  });
});

describe("liberarDevueltaSla (R15/R18/R19/R24/R25)", () => {
  it("R15/R18/R19: UPDATE guardado por estatus=devuelta -> destino, limpia mensajero + asignadoAt, append actor NULL", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });

    const ok = await repoWith(prisma).liberarDevueltaSla({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega-satelite",
      estatusDevueltaId: "os-devuelta",
    });

    expect(ok).toBe(true);
    const upd = prisma.orden.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "o1", estatusId: "os-devuelta", deletedAt: null });
    expect(upd.data).toEqual({
      estatusId: "os-en-bodega-satelite",
      mensajeroAsignadoId: null, // R15: handoff limpio a la bodega
      asignadoAt: null,
    });
    // R18/R19: append por el choke point, actor NULL, origen_tipo liberacion_devuelta_sla.
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const hist = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(hist.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-devuelta",
        estatusDestinoId: "os-en-bodega-satelite",
        actorUsuarioId: null,
        origenTipo: "liberacion_devuelta_sla",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
    // No crea gestion sintetica al liberar (eso es del escalado).
    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
  });

  it("R24/R25: 2.ª corrida -> la orden ya salio de devuelta -> count 0 -> false, sin append", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });

    const ok = await repoWith(prisma).liberarDevueltaSla({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega",
      estatusDevueltaId: "os-devuelta",
    });

    expect(ok).toBe(false);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("escalarDevueltaSla — Option A del dinero (R16/R17/R18/R19/R20-R25)", () => {
  it("R20/R22: escala a rechazada + crea 1 gestion sintetica `rechazada` del mensajero, cierre_id null", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });

    const ok = await repoWith(prisma).escalarDevueltaSla({
      ordenId: "o1",
      estatusDevueltaId: "os-devuelta",
      estatusRechazadaId: "os-rechazada",
      mensajeroId: "m1",
      motivo: "escalado SLA not_found",
    });

    expect(ok).toBe(true);
    // R16/R17: transiciona a rechazada, guardado por estado; NO toca el mensajero (paridad rechazo).
    const upd = prisma.orden.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "o1", estatusId: "os-devuelta", deletedAt: null });
    expect(upd.data).toEqual({ estatusId: "os-rechazada" });
    expect(upd.data).not.toHaveProperty("mensajeroAsignadoId");

    // R20/R22: UNA gestion sintetica rechazada del mensajero atribuido, sin cierre.
    expect(prisma.gestionOrden.create).toHaveBeenCalledTimes(1);
    const gArg = (prisma.gestionOrden.create.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(gArg.data).toMatchObject({
      ordenId: "o1",
      mensajeroId: "m1",
      resultado: "rechazada",
      motivo: "escalado SLA not_found",
      cierreId: null,
    });
    // R23: sin aritmetica con `number` (no hay montos coercionados aqui; el ingreso lo cobra el
    // snapshot 56). La gestion sintetica no lleva montoRecibido ni ingreso pre-computado.
    expect(gArg.data).not.toHaveProperty("montoRecibido");
    expect(gArg.data).not.toHaveProperty("ingresoBodegaRechazo");

    // R18/R19: append por el choke point, actor NULL, enlaza la gestion sintetica.
    const hist = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(hist.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-devuelta",
        estatusDestinoId: "os-rechazada",
        actorUsuarioId: null,
        origenTipo: "escalado_devuelta_sla",
        motivo: null,
        gestionOrdenId: "g-sintetica",
      },
    ]);
  });

  it("R21/R24/R25: 2.ª corrida -> count 0 -> false, NO crea 2.ª gestion ni append (sin doble dinero)", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });

    const ok = await repoWith(prisma).escalarDevueltaSla({
      ordenId: "o1",
      estatusDevueltaId: "os-devuelta",
      estatusRechazadaId: "os-rechazada",
      mensajeroId: "m1",
      motivo: "escalado SLA wrong_number",
    });

    expect(ok).toBe(false);
    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});
