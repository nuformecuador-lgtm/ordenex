import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { IncidenteAdminRepository } from "@/lib/repositories/IncidenteAdminRepository";
import type { IncidenteAdminPrismaClient } from "@/lib/interfaces/repositories/IIncidenteAdminRepository";

// Fix «tope de negocio de la indemnizacion» (2026-08-04) — LA LECTURA, medida donde vive.
//
// Por que este archivo existe: los tests de servicio de los dos emisores usan DOBLES del repo, y
// un doble devuelve `ordenMontoCobrar` porque el test se lo pone. NINGUNO de ellos ve la
// consulta. Si el `select` no pidiera `montoCobrar`, Prisma devolveria `undefined`, el tope de
// negocio no aplicaria NUNCA en produccion y los dos emisores seguirian en verde. Eso es
// exactamente el fallo que este archivo impide.

describe("EMISOR 1 (cierre) — `findGestionesIncidenteDelCierre` LEE el valor de la orden", () => {
  function buildRepo(rows: unknown[]) {
    const findMany = vi.fn(async (args: unknown) => {
      void args;
      return rows;
    });
    const prisma = { gestionOrden: { findMany } } as unknown as PrismaClient;
    // Los siete colaboradores de escritura no se ejercitan en esta lectura: es una consulta
    // pura. Se pasan como stubs para no arrastrar media wallet a un test de `select`.
    const repo = new CierresAdminRepository(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { repo, findMany };
  }

  it("el `select` PIDE `orden.montoCobrar` (sin esto el tope no existiria en produccion)", async () => {
    const { repo, findMany } = buildRepo([]);

    await repo.findGestionesIncidenteDelCierre("c1", {
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-sat",
    });

    const arg = findMany.mock.calls[0][0] as { where: unknown; select: unknown };
    expect(arg.select).toEqual({ id: true, orden: { select: { montoCobrar: true } } });
    // Y el alcance sigue viajando por la RELACION al cierre: la columna nueva no lo afloja.
    expect(arg.where).toEqual({
      cierreId: "c1",
      resultado: "incidente",
      cierre: { destinoTipo: "bodega_satelite", destinoZonaId: "z-sat" },
    });
  });

  it("proyecta el valor como STRING escala 2 (money-safe), nunca como number", async () => {
    const { repo } = buildRepo([
      { id: "g1", orden: { montoCobrar: new Prisma.Decimal("42000") } },
      { id: "g2", orden: { montoCobrar: new Prisma.Decimal("11091.625") } },
    ]);

    const filas = await repo.findGestionesIncidenteDelCierre("c1", {
      destinoTipo: "bodega_central",
      destinoZonaId: null,
    });

    expect(filas).toEqual([
      { gestionId: "g1", ordenMontoCobrar: "42000.00" },
      { gestionId: "g2", ordenMontoCobrar: "11091.63" },
    ]);
    for (const f of filas) expect(typeof f.ordenMontoCobrar).toBe("string");
  });

  it("una orden SIN valor declarado sale como `null`, no como \"0.00\"", async () => {
    // La diferencia importa: `null` = «el tope de negocio no aplica» (decision declarada);
    // `"0.00"` seria un valor y podria interpretarse como un tope real.
    const { repo } = buildRepo([{ id: "g1", orden: { montoCobrar: null } }]);
    const filas = await repo.findGestionesIncidenteDelCierre("c1", {
      destinoTipo: "bodega_central",
      destinoZonaId: null,
    });
    expect(filas).toEqual([{ gestionId: "g1", ordenMontoCobrar: null }]);
  });

  it("una sola consulta: el tope no cuesta un round-trip por gestion", async () => {
    const { repo, findMany } = buildRepo([
      { id: "g1", orden: { montoCobrar: new Prisma.Decimal("10") } },
      { id: "g2", orden: { montoCobrar: new Prisma.Decimal("20") } },
      { id: "g3", orden: { montoCobrar: new Prisma.Decimal("30") } },
    ]);
    await repo.findGestionesIncidenteDelCierre("c1", {
      destinoTipo: "bodega_central",
      destinoZonaId: null,
    });
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe("EMISOR 2 (incidente) — `findByIdEnAlcance` LEE el valor de la orden", () => {
  function buildRepo(row: unknown) {
    const findFirst = vi.fn(async (args: unknown) => {
      void args;
      return row;
    });
    const prisma = {
      ordenIncidente: { findFirst },
      orden: {},
      $transaction: vi.fn(),
    } as unknown as IncidenteAdminPrismaClient;
    const repo = new IncidenteAdminRepository(prisma, {} as never, {} as never);
    return { repo, findFirst };
  }

  function filaCruda(montoCobrar: Prisma.Decimal | null) {
    return {
      id: "inc-1",
      ordenId: "o-1",
      causa: "perdido",
      motivo: "no aparece",
      estado: "solicitado",
      indemnizacion: null,
      reportadoPor: "u-1",
      resueltoPor: null,
      resueltoAt: null,
      motivoRechazo: null,
      createdAt: new Date("2026-08-04T11:00:00.000Z"),
      orden: {
        numGuia: 42,
        numRemision: "R-42",
        destinatario: "Ana",
        zonaId: "z-1",
        montoCobrar,
        zona: { nombre: "Centro" },
        estatus: { value: "incidente" },
      },
      reportadoPorUsuario: { nombre: "Admin Uno" },
      resueltoPorUsuario: null,
      evidencias: [],
    };
  }

  it("el `select` PIDE `orden.montoCobrar`", async () => {
    const { repo, findFirst } = buildRepo(filaCruda(new Prisma.Decimal("42000")));

    await repo.findByIdEnAlcance("inc-1", { zonaId: null });

    const arg = findFirst.mock.calls[0][0] as {
      select: { orden: { select: Record<string, unknown> } };
    };
    expect(arg.select.orden.select).toHaveProperty("montoCobrar", true);
  });

  it("proyecta el valor como STRING escala 2 (money-safe)", async () => {
    const { repo } = buildRepo(filaCruda(new Prisma.Decimal("42000")));
    const row = await repo.findByIdEnAlcance("inc-1", { zonaId: null });
    expect(row!.ordenMontoCobrar).toBe("42000.00");
    expect(typeof row!.ordenMontoCobrar).toBe("string");
  });

  it("una orden SIN valor declarado sale como `null`, no como \"0.00\"", async () => {
    const { repo } = buildRepo(filaCruda(null));
    const row = await repo.findByIdEnAlcance("inc-1", { zonaId: null });
    expect(row!.ordenMontoCobrar).toBeNull();
  });
});
