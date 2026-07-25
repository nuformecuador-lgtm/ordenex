import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 106 (T7 + T14) — cancelarViaApi: transaccion que valida owner+estado, transiciona a
// `devolviendo_a_tienda` y registra en la bitacora via appendCambioEstado (origen_tipo cancelacion_api,
// motivo 'cancelada por tienda') EN LA MISMA tx, SIN tocar gestion_orden. El fake de $transaction
// invoca el callback con el propio prisma como tx.

const OWNER = "store-1";
const DEVUELTA_ORIGEN_ID = "os-devuelta-origen";

function buildPrisma(ordenActual: Record<string, unknown> | null) {
  const prisma = {
    orden: {
      findFirst: vi.fn().mockResolvedValue(ordenActual),
      update: vi.fn().mockResolvedValue({}),
    },
    ordenHistorialEstado: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    // Spia gestion_orden para probar que la cancelacion NUNCA le escribe (decision (b)).
    gestionOrden: {
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    orderStatus: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function ordenEn(estatusValue: string) {
  return { id: "ord-1", estatusId: "os-origen", estatus: { value: estatusValue } };
}

describe("OrdenRepository.cancelarViaApi (feature 106, T7)", () => {
  it.each(["en_bodega_central", "en_ruta_bodega_central"])(
    "R19/R25: transiciona desde %s a devolviendo_a_tienda (update + append en la MISMA tx)",
    async (estadoOrigen) => {
      const prisma = buildPrisma(ordenEn(estadoOrigen));
      const repo = new OrdenRepository(prisma as unknown as PrismaClient);

      const res = await repo.cancelarViaApi({
        numGuia: 10234,
        ownerId: OWNER,
        devueltaOrigenEstatusId: DEVUELTA_ORIGEN_ID,
      });

      expect(res).toEqual({ status: "ok", estadoAnterior: estadoOrigen });
      // Pre-lectura scoped por owner + no borrada dentro de la tx.
      expect(prisma.orden.findFirst.mock.calls[0][0].where).toMatchObject({
        numGuia: 10234,
        tiendaId: OWNER,
        deletedAt: null,
      });
      // UPDATE del estatus a devolviendo_a_tienda.
      expect(prisma.orden.update).toHaveBeenCalledWith({
        where: { id: "ord-1" },
        data: { estatusId: DEVUELTA_ORIGEN_ID },
      });
      // Todo dentro de una unica $transaction (R25).
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    },
  );

  it("R22/R26: appendCambioEstado registra origen/destino/actor/origen_tipo y motivo='cancelada por tienda'", async () => {
    const prisma = buildPrisma(ordenEn("en_bodega_central"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.cancelarViaApi({
      numGuia: 10234,
      ownerId: OWNER,
      devueltaOrigenEstatusId: DEVUELTA_ORIGEN_ID,
    });

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "ord-1",
        estatusOrigenId: "os-origen", // estado previo real (R22)
        estatusDestinoId: DEVUELTA_ORIGEN_ID, // devolviendo_a_tienda (R22)
        actorUsuarioId: OWNER, // actor = owner (R22)
        origenTipo: "cancelacion_api", // R22
        motivo: "cancelada por tienda", // R26
        gestionOrdenId: null,
      },
    ]);
  });

  it("R26/T14: NO escribe ninguna fila en gestion_orden al cancelar", async () => {
    const prisma = buildPrisma(ordenEn("en_bodega_central"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.cancelarViaApi({
      numGuia: 10234,
      ownerId: OWNER,
      devueltaOrigenEstatusId: DEVUELTA_ORIGEN_ID,
    });

    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.createMany).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.update).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.updateMany).not.toHaveBeenCalled();
  });

  it.each(["en_ruta", "devolviendo_a_tienda", "entregada", "rechazada", "en_bodega_satelite"])(
    "R20: %s no es cancelable -> conflict; no toca estado ni bitacora",
    async (estado) => {
      const prisma = buildPrisma(ordenEn(estado));
      const repo = new OrdenRepository(prisma as unknown as PrismaClient);

      const res = await repo.cancelarViaApi({
        numGuia: 10234,
        ownerId: OWNER,
        devueltaOrigenEstatusId: DEVUELTA_ORIGEN_ID,
      });

      expect(res).toEqual({ status: "conflict", estadoActual: estado });
      expect(prisma.orden.update).not.toHaveBeenCalled();
      expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
    },
  );

  it("R23/R24: orden inexistente / ajena / borrada -> not_found; no toca nada", async () => {
    const prisma = buildPrisma(null); // findFirst scoped no encuentra
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.cancelarViaApi({
      numGuia: 999,
      ownerId: OWNER,
      devueltaOrigenEstatusId: DEVUELTA_ORIGEN_ID,
    });

    expect(res).toEqual({ status: "not_found" });
    expect(prisma.orden.update).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});
