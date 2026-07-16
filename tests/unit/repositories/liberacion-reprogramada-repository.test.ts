import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";

// Feature 46 (R10/R11/R13/R15/R17) — repo de la liberacion programada. Mockea Prisma
// (sin DB real, patron corte-diario-repository.test.ts). Cubre: seleccion `<= hoy`,
// exclusion de borradas/futuras (el where), UPDATE guardado por estado (0 filas si ya
// salio de reprogramada) y findLiberadasHoy (fecha + estatus + zona).

// hoy CR = medianoche UTC del dia calendario CR.
const HOY = new Date("2026-07-15T00:00:00.000Z");

// Feature 49/#10: liberarOrden envuelve el updateMany guardado en `$transaction`; el fake
// pasa el propio prisma como `tx` (tiene orden.updateMany + el choke point
// ordenHistorialEstado.createMany).
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: { findMany: vi.fn(), updateMany: vi.fn() },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function repoWith(prisma: ReturnType<typeof buildPrisma>) {
  return new LiberacionReprogramadaRepository(prisma as unknown as PrismaClient);
}

describe("findOrdenesLiberables (R10/R11)", () => {
  it("R10: filtra por estatus reprogramada + no borrada, gestion reprogramada mas reciente", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { id: "o1", zonaId: "z1", gestiones: [{ fechaReprogramacion: new Date("2026-07-14T00:00:00.000Z") }] },
    ]);
    const rows = await repoWith(prisma).findOrdenesLiberables(HOY);

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null, estatus: { value: "reprogramada" } });
    // gestion vigente = la reprogramada mas reciente.
    expect(arg.select.gestiones).toMatchObject({
      where: { resultado: "reprogramada" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(rows).toEqual([
      { id: "o1", zonaId: "z1", fechaReprogramacion: new Date("2026-07-14T00:00:00.000Z") },
    ]);
  });

  it("selecciona la de fecha == hoy y la de fecha < hoy; EXCLUYE la futura (R11)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { id: "hoy", zonaId: "z1", gestiones: [{ fechaReprogramacion: new Date("2026-07-15T00:00:00.000Z") }] },
      { id: "ayer", zonaId: "z2", gestiones: [{ fechaReprogramacion: new Date("2026-07-10T00:00:00.000Z") }] },
      { id: "manana", zonaId: "z3", gestiones: [{ fechaReprogramacion: new Date("2026-07-16T00:00:00.000Z") }] },
    ]);
    const rows = await repoWith(prisma).findOrdenesLiberables(HOY);

    expect(rows.map((r) => r.id)).toEqual(["hoy", "ayer"]);
  });

  it("excluye ordenes sin gestion reprogramada vigente (sin fecha)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { id: "o1", zonaId: "z1", gestiones: [] },
      { id: "o2", zonaId: "z1", gestiones: [{ fechaReprogramacion: null }] },
    ]);
    const rows = await repoWith(prisma).findOrdenesLiberables(HOY);

    expect(rows).toEqual([]);
  });
});

describe("liberarOrden (R13/R17 · feature 49/#10)", () => {
  it("R13: UPDATE guardado por estatus=reprogramada, fija destino + limpia mensajero + marca", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const corridaAt = new Date("2026-07-15T06:00:00.000Z");

    const ok = await repoWith(prisma).liberarOrden({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega",
      estatusReprogramadaId: "os-reprogramada",
      corridaAt,
    });

    expect(ok).toBe(true);
    const arg = prisma.orden.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "o1", estatusId: "os-reprogramada", deletedAt: null });
    expect(arg.data).toEqual({
      estatusId: "os-en-bodega",
      mensajeroAsignadoId: null,
      asignadoAt: null, // feature 76/LC1 (C3): limpia el timestamp de asignacion
      liberadaReprogramadaAt: corridaAt,
    });
  });

  // Feature 49/#10 (R18/R21): al liberar, 1 historial con origen reprogramada -> destino,
  // ACTOR NULL (sistema/cron) y tipo liberacion_reprogramada.
  it("R18/R21: liberar deja historial con actor NULL (sistema) y origen reprogramada", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });

    await repoWith(prisma).liberarOrden({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega-satelite",
      estatusReprogramadaId: "os-reprogramada",
      corridaAt: new Date("2026-07-15T06:00:00.000Z"),
    });

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-reprogramada",
        estatusDestinoId: "os-en-bodega-satelite",
        actorUsuarioId: null, // R21: sistema/cron
        origenTipo: "liberacion_reprogramada",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("R17/R8: si la orden ya no esta en reprogramada -> 0 filas -> false; no duplica rastro", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });

    const ok = await repoWith(prisma).liberarOrden({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega",
      estatusReprogramadaId: "os-reprogramada",
      corridaAt: new Date(),
    });

    expect(ok).toBe(false);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("findLiberadasHoy (R15/R16)", () => {
  it("filtra por zona + estatus destino + liberada_reprogramada_at en el dia de hoyCR", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "o1",
        numGuia: 42,
        numRemision: "R-42",
        destinatario: "Ana",
        liberadaReprogramadaAt: new Date("2026-07-15T06:00:00.000Z"),
      },
    ]);

    const rows = await repoWith(prisma).findLiberadasHoy(
      { zonaId: "z-central", estatusValue: "en_bodega" },
      HOY,
    );

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      zonaId: "z-central",
      deletedAt: null,
      estatus: { value: "en_bodega" },
    });
    // ventana [hoyCR, hoyCR + 24h).
    expect(arg.where.liberadaReprogramadaAt.gte).toEqual(HOY);
    expect(arg.where.liberadaReprogramadaAt.lt).toEqual(new Date("2026-07-16T00:00:00.000Z"));
    expect(rows).toEqual([
      {
        id: "o1",
        numGuia: 42,
        numRemision: "R-42",
        destinatario: "Ana",
        liberadaReprogramadaAt: new Date("2026-07-15T06:00:00.000Z"),
      },
    ]);
  });

  it("bodega satelite: filtra por en_bodega_satelite + su zona", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);

    await repoWith(prisma).findLiberadasHoy(
      { zonaId: "z-limon", estatusValue: "en_bodega_satelite" },
      HOY,
    );

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      zonaId: "z-limon",
      estatus: { value: "en_bodega_satelite" },
    });
  });
});
