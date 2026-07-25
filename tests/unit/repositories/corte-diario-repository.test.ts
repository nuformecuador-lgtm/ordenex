import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";

// Feature 41/C2 (R7/R10) + feature 109 (R4/R10/R29) — repo del corte diario.
// `findMensajerosConActividadSinCierre` devuelve la UNION de (a) mensajeros con gestiones sin
// cerrar (cierre_id IS NULL, anulada_at IS NULL) y (b) mensajeros con >=1 orden en `en_ruta`
// no borrada, menos los que ya tienen un cierre ABIERTO ('solicitado'|'vencido'|'rechazado').
// Mockea Prisma (sin DB real).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    gestionOrden: { findMany: vi.fn().mockResolvedValue([]) },
    orden: { findMany: vi.fn().mockResolvedValue([]) },
    cierreDia: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe("CorteDiarioRepository.findMensajerosConActividadSinCierre (R7/R10)", () => {
  it("R7: filtra gestiones por cierreId null, distinct por mensajero, trae su zona", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ cierreId: null });
    expect(arg.distinct).toEqual(["mensajeroId"]);
    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
  });

  // Feature 109/R4: la seleccion suma a los mensajeros con ordenes en `en_ruta` (sin gestiones).
  it("R4: incluye mensajeros con >=1 orden en `en_ruta` no borrada (sin gestiones pendientes)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m2", mensajeroAsignado: { zonaId: "z2" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      deletedAt: null,
      estatus: { value: "en_ruta" },
      mensajeroAsignadoId: { not: null },
    });
    expect(arg.distinct).toEqual(["mensajeroAsignadoId"]);
    expect(rows).toEqual([{ mensajeroId: "m2", zonaId: "z2" }]);
  });

  // Feature 109/R4: UNION sin duplicar — un mensajero con gestiones Y en_ruta aparece 1 vez.
  it("R4: UNION de gestiones + en_ruta, sin duplicar mensajeros", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
    ]);
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m1", mensajeroAsignado: { zonaId: "z1" } }, // ya esta por gestiones
      { mensajeroAsignadoId: "m2", mensajeroAsignado: { zonaId: "z2" } }, // nuevo por en_ruta
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows.map((r) => r.mensajeroId).sort()).toEqual(["m1", "m2"]);
    expect(rows.filter((r) => r.mensajeroId === "m1")).toHaveLength(1);
  });

  it("R10/R29: excluye al mensajero que ya tiene un cierre ABIERTO (solicitado/vencido/rechazado)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
      { mensajeroId: "m2", mensajero: { zonaId: "z2" } },
    ]);
    // m2 ya tiene un cierre abierto -> no se le crea otro.
    prisma.cierreDia.findMany.mockResolvedValue([{ mensajeroId: "m2" }]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
    // R10/R29: la consulta de excluidos filtra por los 3 estados ABIERTOS sobre los ids candidatos.
    const cierreArg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(cierreArg.where.estado).toEqual({ in: ["solicitado", "vencido", "rechazado"] });
    expect(cierreArg.where.mensajeroId.in.sort()).toEqual(["m1", "m2"]);
  });

  // Feature 109/R29: `rechazado` es AHORA bloqueante -> un mensajero con `rechazado` no recibe un 2.º.
  it("R29: un mensajero con un cierre `rechazado` NO recibe un 2.º cierre del corte", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m1", mensajeroAsignado: { zonaId: "z1" } },
    ]);
    // Simula el filtro por estado: m1 esta en `rechazado` -> devuelto por la query de excluidos.
    prisma.cierreDia.findMany.mockImplementation(
      async (args: { where: { estado: { in: string[] } } }) => {
        expect(args.where.estado.in).toContain("rechazado");
        return [{ mensajeroId: "m1" }];
      },
    );
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([]);
  });

  it("sin actividad (ni gestiones ni en_ruta) -> lista vacia, sin consultar cierres", async () => {
    const prisma = buildPrisma();
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([]);
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });

  // Feature 67/R17: una gestion ANULADA (deshecha) NO es "actividad del dia pendiente de cierre".
  it("67/R17: el WHERE de gestiones exige `anuladaAt: null` (las deshechas no son actividad pendiente)", async () => {
    const prisma = buildPrisma();
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    await repo.findMensajerosConActividadSinCierre();

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ cierreId: null, anuladaAt: null });
  });

  it("propaga zonaId null (P2 lo maneja el service, no el repo)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: null } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: null }]);
  });
});
