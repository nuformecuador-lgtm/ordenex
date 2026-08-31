import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 106 (T5/T6) — LECTURA scoped por owner del canal integrador. Prisma mock: el scope
// (`tienda_id = ownerId AND deleted_at IS NULL`) se afirma sobre el `where` que llega a Prisma.
//
// BAJA (2026-08-31) — aqui vivia tambien el bloque de `findDetalleByNumGuiaForOwner`, retirado
// junto con su endpoint (`GET /api/ordenes/api-key/{numGuia}`). Sus casos ya estaban cubiertos,
// uno a uno, por `findDetalleByOrdenIdForOwner` en `orden-repository.api-consulta-pdf.test.ts`
// (misma proyeccion: era la misma constante). Lo que NO estaba duplicado —los seis casos del
// incidente de la 268/R27, que es donde vive el mapeo de las dos procedencias— se conserva
// entero aqui abajo, ahora ejercitado por el metodo que sigue vivo.

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
    estatus: { value: "en_bodega_central" },
    ...overrides,
  };
}

const OWNER = "store-1";
const ORDEN_ID = "orden-1";

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
      estatusValue: "en_bodega_central",
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

// FEATURE 268 (T6c / R27, 2026-08-22) — las evidencias del INCIDENTE por sus DOS procedencias.
// Se afirma en el REPO porque es donde vive el mapeo: el service solo firma lo que recibe.
describe("OrdenRepository detalle — evidencias de incidente (feature 268, R27)", () => {
  function prismaConDetalle(detalle: Record<string, unknown>) {
    return buildPrisma({
      orden: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(detalle),
      },
    });
  }

  it("R27: el incidente del MENSAJERO (gestion con resultado=incidente) sale con resultado 'incidente'", async () => {
    const prisma = prismaConDetalle({
      ...ordenSelectRow({ estatus: { value: "incidente" } }),
      gestiones: [
        {
          resultado: "incidente",
          evidenciaStoragePath: "ordenes/o1/incidente-mensajero.jpg",
          evidenciaContentType: "image/jpeg",
          createdAt: new Date("2026-08-22T10:00:00.000Z"),
        },
      ],
      incidentesAdmin: [],
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    expect(res!.evidencias).toEqual([
      {
        resultado: "incidente",
        storagePath: "ordenes/o1/incidente-mensajero.jpg",
        contentType: "image/jpeg",
      },
    ]);
  });

  it("R27: el incidente del ADMIN (orden_incidente) sale con resultado 'incidente' aunque NO haya gestion", async () => {
    const prisma = prismaConDetalle({
      ...ordenSelectRow({ estatus: { value: "incidente" } }),
      gestiones: [], // el camino del admin no crea gestion ninguna: esto es lo que rompe la opcion (a)
      incidentesAdmin: [
        { evidencias: [{ storagePath: "incidentes/i1/portada.jpg", contentType: "image/png" }] },
      ],
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    expect(res!.evidencias).toEqual([
      {
        resultado: "incidente",
        storagePath: "incidentes/i1/portada.jpg",
        contentType: "image/png",
      },
    ]);
  });

  it("R27: las DOS procedencias caen en el MISMO array (gestiones primero, admin despues)", async () => {
    const prisma = prismaConDetalle({
      ...ordenSelectRow({ estatus: { value: "incidente" } }),
      gestiones: [
        {
          resultado: "incidente",
          evidenciaStoragePath: "ordenes/o1/incidente-mensajero.jpg",
          evidenciaContentType: "image/jpeg",
          createdAt: new Date("2026-08-22T10:00:00.000Z"),
        },
      ],
      incidentesAdmin: [
        { evidencias: [{ storagePath: "incidentes/i1/portada.jpg", contentType: "image/png" }] },
      ],
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    expect(res!.evidencias.map((e) => e.storagePath)).toEqual([
      "ordenes/o1/incidente-mensajero.jpg",
      "incidentes/i1/portada.jpg",
    ]);
    expect(res!.evidencias.every((e) => e.resultado === "incidente")).toBe(true);
  });

  it("R27: un incidente del ADMIN sin evidencias se OMITE (nunca una entrada con storagePath vacio)", async () => {
    const prisma = prismaConDetalle({
      ...ordenSelectRow({ estatus: { value: "incidente" } }),
      gestiones: [],
      incidentesAdmin: [{ evidencias: [] }],
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    expect(res!.evidencias).toEqual([]);
  });

  it("R27: el select pide SOLO la portada (indice 0) y ningun campo interno del incidente", async () => {
    const prisma = prismaConDetalle({
      ...ordenSelectRow(),
      gestiones: [],
      incidentesAdmin: [],
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    const { incidentesAdmin } = (prisma.orden.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .select;
    // Regla de contenido de design §7.3 (pregunta abierta 4): LA PORTADA, no las 1..N. La deuda
    // 1..N de la 119 no se reabre en esta ficha.
    expect(incidentesAdmin.select.evidencias.where).toEqual({ indice: 0 });
    expect(Object.keys(incidentesAdmin.select.evidencias.select).sort()).toEqual([
      "contentType",
      "storagePath",
    ]);
    // Ni `causa`, ni `motivo`, ni `indemnizacion`, ni quien lo reporto: el detalle publico no
    // crece con datos internos del tramite de indemnizacion.
    expect(Object.keys(incidentesAdmin.select).sort()).toEqual(["evidencias"]);
  });

  it("R27 (decision 2026-08-22): NO se filtra orden_incidente.estado — el tramite de indemnizacion no decide si hay fotos", async () => {
    const prisma = prismaConDetalle({
      ...ordenSelectRow(),
      gestiones: [],
      incidentesAdmin: [],
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    const { incidentesAdmin } = (prisma.orden.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .select;
    // `solicitado`/`aprobado`/`rechazado` es el estado del tramite ECONOMICO, no el de si el
    // incidente ocurrio. Filtrar por `aprobado` esconderia las fotos justo mientras se decide.
    expect(incidentesAdmin.where).toBeUndefined();
  });
});
