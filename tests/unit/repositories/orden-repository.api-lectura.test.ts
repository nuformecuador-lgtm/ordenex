import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 106 (T5/T6) — LECTURA scoped por owner del canal integrador. Prisma mock: el scope
// (`tienda_id = ownerId AND deleted_at IS NULL`) se afirma sobre el `where` que llega a Prisma.

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    orden: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
    orderStatus: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    ...overrides,
  };
}

function ordenSelectRow(overrides: Record<string, unknown> = {}) {
  return {
    numGuia: 10234,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: new Prisma.Decimal(1500),
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    estatus: { value: "en_bodega" },
    ...overrides,
  };
}

const OWNER = "store-1";

describe("OrdenRepository.listByOwner (feature 106, T5)", () => {
  it("R7: el where fuerza tienda_id = ownerId y deleted_at IS NULL (find y count)", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    const findWhere = (prisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    const countWhere = (prisma.orden.count as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    expect(findWhere).toMatchObject({ tiendaId: OWNER, deletedAt: null });
    expect(countWhere).toMatchObject({ tiendaId: OWNER, deletedAt: null });
  });

  it("R11: excluye borradas — deleted_at: null va SIEMPRE en el where", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });
    const findWhere = (prisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    expect(findWhere.deletedAt).toBeNull();
  });

  it("R6: mapea las filas del owner a fila publica (estatusValue plano, montoCobrar number) y devuelve total", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([ordenSelectRow()]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    expect(res.total).toBe(1);
    expect(res.items[0]).toEqual({
      numGuia: 10234,
      numRemision: "REM-1",
      estatusValue: "en_bodega",
      destinatario: "Ana",
      telefonoDest: "0991234567",
      producto: "Caja",
      direccion: "Calle 1",
      montoCobrar: 1500,
      createdAt: new Date("2026-07-20T15:04:00.000Z"),
    });
  });

  it("acota por estatusId cuando se pasa, y aplica skip/take de la paginacion", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await repo.listByOwner({ ownerId: OWNER, estatusId: "os-bodega", skip: 100, take: 25 });
    const call = (prisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where).toMatchObject({ tiendaId: OWNER, deletedAt: null, estatusId: "os-bodega" });
    expect(call.skip).toBe(100);
    expect(call.take).toBe(25);
  });
});

describe("OrdenRepository.findDetalleByNumGuiaForOwner (feature 106, T6)", () => {
  it("R12: devuelve el detalle de una orden propia; where scoped por num_guia + owner + no borrada", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ ...ordenSelectRow(), gestiones: [] }),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.findDetalleByNumGuiaForOwner(10234, OWNER);

    const where = (prisma.orden.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    expect(where).toMatchObject({ numGuia: 10234, tiendaId: OWNER, deletedAt: null });
    expect(res).not.toBeNull();
    expect(res!.numGuia).toBe(10234);
    expect(res!.estatusValue).toBe("en_bodega");
  });

  it("R13/R14/R24: no existe / ajena / borrada -> null (findFirst null)", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    const res = await repo.findDetalleByNumGuiaForOwner(999, OWNER);
    expect(res).toBeNull();
  });

  it("R15: incluye evidencias de entrega/rechazo con storage_path crudo y content-type", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          ...ordenSelectRow({ estatus: { value: "entregada" } }),
          gestiones: [
            {
              resultado: "entregada",
              evidenciaStoragePath: "ordenes/o1/evidencia.jpg",
              evidenciaContentType: "image/jpeg",
              createdAt: new Date("2026-07-21T10:00:00.000Z"),
            },
          ],
        }),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.findDetalleByNumGuiaForOwner(10234, OWNER);

    // El WHERE de gestiones acota a entregada/rechazada con evidencia no nula.
    const gestionesArg = (prisma.orden.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].select
      .gestiones;
    expect(gestionesArg.where.resultado.in).toEqual(["entregada", "rechazada"]);
    expect(gestionesArg.where.evidenciaStoragePath).toEqual({ not: null });
    expect(res!.evidencias).toEqual([
      {
        resultado: "entregada",
        storagePath: "ordenes/o1/evidencia.jpg",
        contentType: "image/jpeg",
      },
    ]);
  });

  it("R18: sin evidencias -> evidencias vacias, no error", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ ...ordenSelectRow(), gestiones: [] }),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    const res = await repo.findDetalleByNumGuiaForOwner(10234, OWNER);
    expect(res!.evidencias).toEqual([]);
  });
});
