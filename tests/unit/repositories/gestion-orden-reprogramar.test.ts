import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";

// Feature 100 (T1.2) — repo de la REPROGRAMACION por la tienda. Mockea Prisma (sin DB real, patron
// devolucion-sla-repository.test.ts: mocks bare + mockResolvedValue). El fake pasa el propio prisma
// como `tx` (tiene orden.updateMany + gestionOrden.findFirst + gestionOrden.create + el choke point
// ordenHistorialEstado.createMany). Cubre R2 (transicion devuelta->reprogramada via el choke
// point), R3 (gestion sintetica reprogramada con fecha en la misma tx), R5 (mensajero de la ultima
// `devuelta` vigente), R11 (actor=adminTienda, origen_tipo=reprogramacion_tienda), R20 (append
// falla -> revierte) y R21 (UPDATE guardado por estatus=devuelta; count 0 -> false).

// El jobRepo del constructor no se usa en reprogramarDesdeDevuelta (no reoptimiza ruta); se pasa un
// doble no-op para no encolar nada.
const noopJobRepo = {} as unknown as ConstructorParameters<typeof GestionOrdenRepository>[1];

function buildPrisma() {
  const prisma = {
    orden: { updateMany: vi.fn() },
    gestionOrden: { findFirst: vi.fn(), create: vi.fn() },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  // Defaults del camino feliz; cada test los sobreescribe donde importa.
  prisma.orden.updateMany.mockResolvedValue({ count: 1 });
  prisma.gestionOrden.findFirst.mockResolvedValue({ mensajeroId: "m-ultima-devuelta" });
  prisma.gestionOrden.create.mockResolvedValue({ id: "g-reprogramada" });
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function repoWith(prisma: ReturnType<typeof buildPrisma>) {
  return new GestionOrdenRepository(prisma as unknown as PrismaClient, noopJobRepo);
}

const INPUT = {
  ordenId: "o1",
  estatusDevueltaId: "os-devuelta",
  estatusReprogramadaId: "os-reprogramada",
  fechaReprogramacion: "2026-07-25",
  motivo: "cliente pidio otra fecha",
  actorUsuarioId: "tienda-1",
};

describe("reprogramarDesdeDevuelta — transicion + gestion sintetica (R2/R3/R5/R11)", () => {
  it("R21: UPDATE guardado por estatus=devuelta + no borrada -> reprogramada", async () => {
    const prisma = buildPrisma();
    const ok = await repoWith(prisma).reprogramarDesdeDevuelta(INPUT);

    expect(ok).toBe(true);
    const upd = prisma.orden.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "o1", estatusId: "os-devuelta", deletedAt: null });
    expect(upd.data).toEqual({ estatusId: "os-reprogramada" });
  });

  it("R5: deriva el mensajero de la ULTIMA gestion `devuelta` VIGENTE (no anulada, mas reciente)", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).reprogramarDesdeDevuelta(INPUT);

    const q = prisma.gestionOrden.findFirst.mock.calls[0][0];
    expect(q.where).toEqual({ ordenId: "o1", resultado: "devuelta", anuladaAt: null });
    expect(q.orderBy).toEqual({ createdAt: "desc" });
    // La gestion sintetica se atribuye a ese mensajero.
    const gArg = prisma.gestionOrden.create.mock.calls[0][0];
    expect(gArg.data.mensajeroId).toBe("m-ultima-devuelta");
  });

  it("R3: crea la gestion sintetica `reprogramada` con fecha (DATE) y motivo, cierre_id null (R10)", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).reprogramarDesdeDevuelta(INPUT);

    expect(prisma.gestionOrden.create).toHaveBeenCalledTimes(1);
    const gArg = prisma.gestionOrden.create.mock.calls[0][0];
    expect(gArg.data).toMatchObject({
      ordenId: "o1",
      mensajeroId: "m-ultima-devuelta",
      resultado: "reprogramada",
      motivo: "cliente pidio otra fecha",
      cierreId: null, // R10: money-neutral (el cierre solo acredita entregada/rechazada)
    });
    // R3: la fecha se persiste como DATE a medianoche UTC (patron crearGestionYTransicionar).
    expect(gArg.data.fechaReprogramacion).toEqual(new Date("2026-07-25T00:00:00.000Z"));
    // R10: la gestion NO lleva montoRecibido ni ingreso pre-computado (aporta $0.00 al cierre).
    expect(gArg.data).not.toHaveProperty("montoRecibido");
    expect(gArg.data).not.toHaveProperty("ingresoBodegaRechazo");
  });

  it("R11/R2: append por el choke point, actor=adminTienda, origen_tipo=reprogramacion_tienda, destino reprogramada (NO devuelta -> R8)", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).reprogramarDesdeDevuelta(INPUT);

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const hist = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(hist.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-devuelta",
        estatusDestinoId: "os-reprogramada", // R8: destino reprogramada, no devuelta -> no cuenta intento
        actorUsuarioId: "tienda-1", // R11: el adminTienda (no NULL, no el mensajero)
        origenTipo: "reprogramacion_tienda", // R11
        motivo: "cliente pidio otra fecha",
        gestionOrdenId: "g-reprogramada", // enlaza la gestion sintetica (bloqueo/liberacion 46)
      },
    ]);
  });

  it("Q1: motivo OPCIONAL -> gestion e historial con motivo null cuando no se envia", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).reprogramarDesdeDevuelta({ ...INPUT, motivo: null });

    expect(prisma.gestionOrden.create.mock.calls[0][0].data.motivo).toBeNull();
    expect(prisma.ordenHistorialEstado.createMany.mock.calls[0][0].data[0].motivo).toBeNull();
  });
});

describe("reprogramarDesdeDevuelta — idempotencia y atomicidad (R7/R20/R21)", () => {
  it("R7/R21: la orden ya salio de `devuelta` (count 0) -> false, sin gestion ni append", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });

    const ok = await repoWith(prisma).reprogramarDesdeDevuelta(INPUT);

    expect(ok).toBe(false);
    expect(prisma.gestionOrden.findFirst).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R20: si el append al historial falla, la tx revierte (propaga el error -> rollback)", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.createMany.mockRejectedValue(new Error("historial down"));

    await expect(repoWith(prisma).reprogramarDesdeDevuelta(INPUT)).rejects.toThrow("historial down");
    // El UPDATE y la creacion de la gestion se intentaron dentro de la MISMA tx que ahora revierte.
    expect(prisma.gestionOrden.create).toHaveBeenCalledTimes(1);
  });

  it("R20/R5: anomalia (orden en devuelta SIN gestion `devuelta` vigente) -> aborta la tx, sin gestion", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findFirst.mockResolvedValue(null); // no hay gestion vigente

    await expect(repoWith(prisma).reprogramarDesdeDevuelta(INPUT)).rejects.toThrow(/mensajero/i);
    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});
