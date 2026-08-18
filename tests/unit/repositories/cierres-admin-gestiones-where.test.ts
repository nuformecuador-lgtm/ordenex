import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  CierresAdminRepository,
  GESTION_ADMIN_SELECT,
  GESTION_DESCARGA_SELECT,
} from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { FiltrosDescargaGestiones } from "@/lib/types/filtros-cierres";

// Feature 230 — Tanda 2 (T2.1, R11/R14/R15/R22/R37/R41) — el WHERE, el ORDEN y la PROYECCION de
// la lectura de gestiones de «Cierres del día».
//
// Los casos de servicio prueban que el servicio le pasa al repositorio el alcance del ACTOR y no
// otro; con un doble, no pueden ver en qué se traduce ese alcance. Este archivo cierra ese hueco,
// que es donde vive el modo de fallo caro: un alcance que se queda FUERA de la relación `cierre`
// —o que se aplica en memoria— devuelve gestiones de la bodega vecina, con sus montos dentro.
//
// Se afirman cuatro cosas, y las cuatro son requisitos:
//   1. el alcance viaja DENTRO de `cierre`, y los recortes del diálogo son claves HERMANAS suyas
//      (conjunción: sólo pueden quitar filas, jamás ensanchar — R14/R15/R37);
//   2. el orden es `[{cierre:{solicitadoAt:"desc"}},{createdAt:"desc"}]` (R11);
//   3. la proyección NO lee `evidencia_storage_path` (R22/R41);
//   4. sin gestiones no se pide el snapshot: la segunda consulta no se paga (y el conjunto vacío
//      es el desenlace NORMAL de R38, no un error).

const SATELITE: Alcance = { destinoTipo: "bodega_satelite", destinoZonaId: "z-a" };
const MAESTRO: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

const FILTROS: FiltrosDescargaGestiones = { mensajeroIds: ["m-1", "m-2"] };

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
  return new CierresAdminRepository(
    prisma as unknown as PrismaClient,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe("WHERE/orden/proyección de las gestiones de «Cierres del día» (feature 230, T2.1)", () => {
  it("pone el alcance del satélite DENTRO de la relación cierre, junto a los recortes (R14/R15)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesPorAlcanceCompleto(SATELITE, FILTROS);

    const consulta = prisma.gestionOrden.findMany.mock.calls[0]![0]!;
    // El alcance y el recorte son claves HERMANAS del mismo objeto: eso es un AND. Un `OR`, o un
    // alcance en el nivel de la gestión, es justo lo que dejaría entrar la bodega vecina.
    expect(consulta.where).toEqual({
      cierre: {
        destinoTipo: "bodega_satelite",
        destinoZonaId: "z-a",
        mensajeroId: { in: ["m-1", "m-2"] },
      },
    });
  });

  it("el acceso total no acota por zona, pero SÍ por tipo de destino (design §2.6)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesPorAlcanceCompleto(MAESTRO, FILTROS);

    // `destinoZonaId` AUSENTE, no `null`: el maestro ve todos los cierres con destino central.
    // Y `destinoTipo` SIEMPRE presente: es lo que hace que este listado y el de bodega sean
    // particiones disjuntas y no dos vistas de lo mismo.
    expect(prisma.gestionOrden.findMany.mock.calls[0]![0]!.where).toEqual({
      cierre: { destinoTipo: "bodega_central", mensajeroId: { in: ["m-1", "m-2"] } },
    });
  });

  it("un mensajero de otra zona NO se convierte en un OR: se cruza con el alcance (R37)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesPorAlcanceCompleto(SATELITE, {
      mensajeroIds: ["m-de-otra-zona"],
    });

    const where = prisma.gestionOrden.findMany.mock.calls[0]![0]!.where as {
      cierre: Record<string, unknown>;
    };
    expect(where.cierre.destinoZonaId).toBe("z-a");
    expect(where.cierre.mensajeroId).toEqual({ in: ["m-de-otra-zona"] });
    expect(JSON.stringify(where)).not.toContain("OR");
  });

  it("el rango de fechas recorta por la fecha de solicitud del CIERRE, con `hasta` inclusivo (R31)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesPorAlcanceCompleto(MAESTRO, {
      mensajeroIds: ["m-1"],
      desde: "2026-02-01",
      hasta: "2026-02-28",
    });

    const where = prisma.gestionOrden.findMany.mock.calls[0]![0]!.where as {
      cierre: { solicitadoAt: { gte: Date; lt: Date } };
    };
    // Días CALENDARIO de Costa Rica (UTC-6) resueltos a instantes UTC. El borde superior es `lt`
    // del día SIGUIENTE y no `lte` del último: con `lte` se perderían los cierres solicitados
    // después de la medianoche del último día del rango.
    expect(where.cierre.solicitadoAt.gte.toISOString()).toBe("2026-02-01T06:00:00.000Z");
    expect(where.cierre.solicitadoAt.lt.toISOString()).toBe("2026-03-01T06:00:00.000Z");
  });

  it("sin fechas no aparece ningún predicado temporal (no se inventa un rango por defecto)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesPorAlcanceCompleto(MAESTRO, FILTROS);

    const where = prisma.gestionOrden.findMany.mock.calls[0]![0]!.where as {
      cierre: Record<string, unknown>;
    };
    expect(where.cierre).not.toHaveProperty("solicitadoAt");
  });

  it("ordena por fecha de solicitud del cierre y luego por la gestión (R11)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesPorAlcanceCompleto(MAESTRO, FILTROS);

    // El valor ABSOLUTO, no una referencia a la constante: si alguien cambia el orden, este caso
    // se pone rojo aunque las dos mitades sigan leyendo la misma declaración.
    expect(prisma.gestionOrden.findMany.mock.calls[0]![0]!.orderBy).toEqual([
      { cierre: { solicitadoAt: "desc" } },
      { createdAt: "desc" },
    ]);
  });

  it("la proyección NO lee evidencia_storage_path (R22/R41)", async () => {
    const prisma = prismaFalso();

    await repositorio(prisma).findGestionesPorAlcanceCompleto(MAESTRO, FILTROS);

    const select = prisma.gestionOrden.findMany.mock.calls[0]![0]!.select!;
    expect(Object.keys(select)).not.toContain("evidenciaStoragePath");
    // No basta con que no se emita: no se LEE. Un campo que la consulta no trae no puede acabar
    // firmado «de paso» ni proyectado a una celda por descuido.
    expect(JSON.stringify(select).toLowerCase()).not.toContain("evidencia");
  });

  it("la proyección es la del detalle menos la evidencia, más la identidad del cierre (R8/R11/R41)", async () => {
    // Este caso es el que se pone rojo el día que `GESTION_ADMIN_SELECT` gane un campo: obliga a
    // DECIDIR si la hoja fundida también lo quiere, en vez de que las dos proyecciones se
    // separen en silencio.
    const delDetalle = new Set(Object.keys(GESTION_ADMIN_SELECT));
    const deLaDescarga = new Set(Object.keys(GESTION_DESCARGA_SELECT));

    expect([...delDetalle].filter((k) => !deLaDescarga.has(k))).toEqual(["evidenciaStoragePath"]);
    // `cierreId` no es una celda (R42): es la clave del join contra `cierre_detail`, cuyo grano
    // es (cierre_id, orden_id). Al cruzar cierres, emparejar sólo por orden cogería la fila
    // congelada del cierre equivocado.
    expect([...deLaDescarga].filter((k) => !delDetalle.has(k)).sort()).toEqual([
      "cierre",
      "cierreId",
    ]);
  });

  it("sin gestiones no se consulta el snapshot: cero filas es un desenlace normal (R38)", async () => {
    const prisma = prismaFalso([]);

    const filas = await repositorio(prisma).findGestionesPorAlcanceCompleto(SATELITE, FILTROS);

    expect(filas).toEqual([]);
    expect(prisma.cierreDetail.findMany).not.toHaveBeenCalled();
  });
});
