import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { GESTION_DESCARGA_SELECT } from "@/lib/repositories/CierresAdminRepository";
import type { FiltrosDescargaGestiones } from "@/lib/types/filtros-cierres";

// Feature 230 — Tanda 7 (T7.1, R11/R24/R26/R41) — el WHERE, el ORDEN y la PROYECCIÓN de la
// lectura de gestiones de «Cierres de bodega».
//
// El requisito que este archivo hace verificable es R24: «las gestiones de los cierres del día
// CONSOLIDADOS en un cierre de bodega, y ninguna otra gestión». Su traducción es
// `cierre_bodega_id IS NOT NULL`, y no hay ninguna otra forma de acotarlo: un cierre del día sin
// consolidar todavía no es de nadie en esta pantalla.
//
// Y el segundo, R26: este camino y el de «cierres del día» tienen que emitir la MISMA fila. Se
// mide comparando el `orderBy` y el `select` que las dos consultas mandan a Prisma —no leyendo
// dos constantes que casualmente hoy son la misma—, porque el modo de fallo es que UNO de los
// dos derive y el mismo mensajero salga distinto según desde dónde se descargue.

const M1 = "11111111-1111-4111-8111-111111111111";

const FILTROS: FiltrosDescargaGestiones = { mensajeroIds: [M1] };

interface Consulta {
  where?: Record<string, unknown>;
  orderBy?: unknown;
  select?: Record<string, unknown>;
}

function prismaFalso(gestiones: unknown[] = []) {
  const gestionOrden = { findMany: vi.fn(async (_args?: Consulta) => gestiones) };
  const cierreDetail = { findMany: vi.fn(async (_args?: Consulta) => []) };
  return { gestionOrden, cierreDetail };
}

function repositorio(prisma: ReturnType<typeof prismaFalso>) {
  return new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);
}

describe("WHERE/orden/proyección de las gestiones de «Cierres de bodega» (feature 230, T7.1)", () => {
  it("sólo devuelve gestiones de cierres del día consolidados en un cierre de bodega (R24)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesDeCierresBodegaCompleto(FILTROS);

    expect(prisma.gestionOrden.findMany.mock.calls[0]![0]!.where).toEqual({
      cierre: { cierreBodegaId: { not: null }, AND: [{ mensajeroId: { in: [M1] } }] },
    });
  });

  it("NO acota por zona ni por tipo de destino: este listado es de acceso total (R25)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesDeCierresBodegaCompleto(FILTROS);

    // Que no haya `destinoTipo` aquí es lo que hace de las dos pantallas particiones DISJUNTAS
    // (design §2.6): un cierre con destino `bodega_central` —la GAM— nunca llega a consolidarse,
    // así que este camino son las satélite y el otro es la GAM. El guard de rol vive en el
    // servicio, no en el WHERE.
    const where = prisma.gestionOrden.findMany.mock.calls[0]![0]!.where as {
      cierre: Record<string, unknown>;
    };
    expect(where.cierre).not.toHaveProperty("destinoTipo");
    expect(where.cierre).not.toHaveProperty("destinoZonaId");
  });

  it("aplica el rango de fechas con el MISMO criterio que el otro camino (R26/R31)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesDeCierresBodegaCompleto({
      mensajeroIds: [M1],
      desde: "2026-02-01",
      hasta: "2026-02-28",
    });

    // Mismos instantes UTC que el camino A porque los produce la MISMA `filtrosWhere`: es el
    // criterio compartido, no dos traducciones que hoy coinciden.
    const where = prisma.gestionOrden.findMany.mock.calls[0]![0]!.where as {
      cierre: { AND: { solicitadoAt: { gte: Date; lt: Date } }[] };
    };
    expect(where.cierre.AND[0]!.solicitadoAt.gte.toISOString()).toBe("2026-02-01T06:00:00.000Z");
    expect(where.cierre.AND[0]!.solicitadoAt.lt.toISOString()).toBe("2026-03-01T06:00:00.000Z");
  });

  it("usa el MISMO orden que el camino de cierres del día (R11/R26)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesDeCierresBodegaCompleto(FILTROS);

    expect(prisma.gestionOrden.findMany.mock.calls[0]![0]!.orderBy).toEqual([
      { cierre: { solicitadoAt: "desc" } },
      { createdAt: "desc" },
    ]);
  });

  it("usa la MISMA proyección, sin evidencia (R26/R41)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesDeCierresBodegaCompleto(FILTROS);

    const select = prisma.gestionOrden.findMany.mock.calls[0]![0]!.select!;
    expect(select).toBe(GESTION_DESCARGA_SELECT);
    expect(JSON.stringify(select).toLowerCase()).not.toContain("evidencia");
  });

  it("sin gestiones no se consulta el snapshot (R38)", async () => {
    const prisma = prismaFalso([]);

    const filas = await repositorio(prisma).findGestionesDeCierresBodegaCompleto(FILTROS);

    expect(filas).toEqual([]);
    expect(prisma.cierreDetail.findMany).not.toHaveBeenCalled();
  });
});
