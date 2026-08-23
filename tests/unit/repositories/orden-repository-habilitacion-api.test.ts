import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 266 · T3.1 (R3/R4) — LECTURA scoped por owner del canal por API key. Prisma espiado: el
// scope (`num_guia` + `tienda_id = ownerId` + `deleted_at IS NULL`) se afirma sobre el `where` que
// LLEGA a Prisma, no sobre el codigo fuente. Mismo patron que `orden-repository.api-lectura`.

const OWNER = "usuario-dedicado-de-la-key";
const NUM_GUIA = 100234;

function buildPrisma(findFirstResult: unknown = null) {
  return {
    orden: { findFirst: vi.fn().mockResolvedValue(findFirstResult) },
  };
}

function repoCon(prisma: ReturnType<typeof buildPrisma>) {
  return new OrdenRepository(prisma as unknown as PrismaClient);
}

function whereDe(prisma: ReturnType<typeof buildPrisma>) {
  return prisma.orden.findFirst.mock.calls[0][0].where;
}

describe("Feature 266 · T3.1 — OrdenRepository.findParaHabilitacionApi", () => {
  it("R3/R4: el where lleva las TRES claves — numGuia, tiendaId del owner y deletedAt null", async () => {
    const prisma = buildPrisma();
    await repoCon(prisma).findParaHabilitacionApi(NUM_GUIA, OWNER);
    expect(whereDe(prisma)).toEqual({
      numGuia: NUM_GUIA,
      tiendaId: OWNER,
      deletedAt: null,
    });
  });

  it("R3: el owner viaja en el WHERE y no en un `if` posterior (no hay ventana entre leer y comprobar)", async () => {
    // La orden que la base devolveria si el where NO tuviera `tiendaId`: de otra tienda. Como el
    // scope es del statement, el repo jamas la ve; este caso fija que la clave esta en el where y
    // que el resultado no se filtra despues en memoria.
    const prisma = buildPrisma(null);
    const res = await repoCon(prisma).findParaHabilitacionApi(NUM_GUIA, OWNER);
    expect(res).toBeNull();
    expect(whereDe(prisma).tiendaId).toBe(OWNER);
    expect(prisma.orden.findFirst).toHaveBeenCalledTimes(1);
  });

  it("R4: devuelve null cuando no hay orden viva del owner con esa guia, sin distinguir el motivo", async () => {
    const prisma = buildPrisma(null);
    await expect(repoCon(prisma).findParaHabilitacionApi(999999, OWNER)).resolves.toBeNull();
  });

  it("aplana la fila a los CUATRO campos del discriminador (R12), con el estatus.value resuelto", async () => {
    const prisma = buildPrisma({
      id: "orden-1",
      estatusId: "st-ayuda",
      mensajeroAsignadoId: "mensajero-7",
      estatus: { value: "ayuda_tienda" },
    });
    const res = await repoCon(prisma).findParaHabilitacionApi(NUM_GUIA, OWNER);
    expect(res).toEqual({
      id: "orden-1",
      estatusId: "st-ayuda",
      estatusValue: "ayuda_tienda",
      mensajeroAsignadoId: "mensajero-7",
    });
  });

  it("propaga `mensajeroAsignadoId: null` — es el discriminador de la rama B, no un dato opcional", async () => {
    const prisma = buildPrisma({
      id: "orden-2",
      estatusId: "st-devuelta",
      mensajeroAsignadoId: null,
      estatus: { value: "devuelta" },
    });
    const res = await repoCon(prisma).findParaHabilitacionApi(NUM_GUIA, OWNER);
    expect(res?.mensajeroAsignadoId).toBeNull();
    expect(res?.estatusValue).toBe("devuelta");
  });

  it("el select esta ACOTADO: no pide montos ni la fila entera", async () => {
    const prisma = buildPrisma();
    await repoCon(prisma).findParaHabilitacionApi(NUM_GUIA, OWNER);
    const select = prisma.orden.findFirst.mock.calls[0][0].select;
    expect(select).toEqual({
      id: true,
      estatusId: true,
      mensajeroAsignadoId: true,
      estatus: { select: { value: true } },
    });
    expect(select).not.toHaveProperty("montoCobrar");
  });

  it("es SOLO LECTURA: no invoca ningun metodo de escritura de Prisma", async () => {
    const prisma = {
      orden: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    await new OrdenRepository(prisma as unknown as PrismaClient).findParaHabilitacionApi(
      NUM_GUIA,
      OWNER,
    );
    expect(prisma.orden.update).not.toHaveBeenCalled();
    expect(prisma.orden.updateMany).not.toHaveBeenCalled();
    expect(prisma.orden.create).not.toHaveBeenCalled();
    expect(prisma.orden.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
