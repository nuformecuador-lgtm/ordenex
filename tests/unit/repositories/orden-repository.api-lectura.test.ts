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
    // ⏳ 2026-09-09 (feature 404): por DEFECTO la orden no tiene mensajero asignado
    // (`mensajero_asignado_id` NULL). Los casos que si lo tienen pasan `MENSAJERO_ROW`.
    mensajeroAsignado: null,
    ...overrides,
  };
}

const OWNER = "store-1";
const ORDEN_ID = "orden-1";

/**
 * ⏳ 2026-09-09 (feature 404) — la fila de `usuario` que Prisma devuelve para la relacion
 * `mensajeroAsignado`, ya proyectada por el `select` del repositorio (id + las tres columnas de
 * identidad de la feature 21).
 */
const MENSAJERO_ID = "018f2c31-0000-4000-8000-0000000000aa";
const MENSAJERO_ROW = {
  id: MENSAJERO_ID,
  nombre: "Carlos",
  primerApellido: "Jimenez",
  segundoApellido: "Mora",
};

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
    // ⏳ 2026-09-09 (feature 404, R16): sigue siendo una igualdad ESTRUCTURAL —no `toMatchObject`—
    // para que un decimo campo que se colara ponga el test rojo. Gana `mensajero` y ni una clave
    // mas; los nueve publicados conservan nombre, tipo y valor.
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
      mensajero: null,
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

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-09-09 — Feature 404 (T4): `mensajero` en la fila publica del listado y del detalle.
// -----------------------------------------------------------------------------------------------

describe("OrdenRepository — el mensajero asignado del canal (feature 404)", () => {
  it("404/R3+R4: la fila publica lleva `{id, nombre}` con el nombre COMPLETO", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([ordenSelectRow({ mensajeroAsignado: MENSAJERO_ROW })]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    // Literal a mano: compararlo contra `nombreCompletoUsuario(MENSAJERO_ROW)` seria compararlo
    // contra su propia fuente y no podria ponerse rojo nunca.
    expect(res.items[0].mensajero).toEqual({ id: MENSAJERO_ID, nombre: "Carlos Jimenez Mora" });
    // R1/R6: dos claves y ninguna mas.
    expect(Object.keys(res.items[0].mensajero!).sort()).toEqual(["id", "nombre"]);
  });

  it("404/R2+R23: `mensajero` es null cuando `mensajero_asignado_id` es NULL, y la clave existe", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([ordenSelectRow({ mensajeroAsignado: null })]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    expect("mensajero" in res.items[0]).toBe(true);
    expect(res.items[0].mensajero).toBeNull();
  });

  it("404/R6: el `select` del listado pide EXACTAMENTE id + las tres columnas de identidad", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    const { select } = (prisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(select.mensajeroAsignado).toEqual({
      select: { id: true, nombre: true, primerApellido: true, segundoApellido: true },
    });
  });

  it("404/R15: una pagina de N ordenes se resuelve con UNA findMany y UN count, sin consulta por item", async () => {
    const filas = Array.from({ length: 25 }, (_, i) =>
      ordenSelectRow({
        numRemision: `REM-${i}`,
        // Mitad con mensajero y mitad sin: si alguien resolviera el nombre con una lectura por
        // item, el contador de llamadas dejaria de ser 1.
        mensajeroAsignado: i % 2 === 0 ? MENSAJERO_ROW : null,
      }),
    );
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue(filas),
        count: vi.fn().mockResolvedValue(25),
        findFirst: vi.fn(),
      },
      // El delegate existe SOLO para poder afirmar que NADIE lo usa: resolver el nombre con una
      // lectura por item es la forma facil de romper R15 sin que ningun otro aserto se entere.
      usuario: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 25 });

    expect(res.items).toHaveLength(25);
    expect(prisma.orden.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orden.count).toHaveBeenCalledTimes(1);
    const usuario = (prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>)
      .usuario;
    expect(usuario.findMany).not.toHaveBeenCalled();
    expect(usuario.findFirst).not.toHaveBeenCalled();
    expect(usuario.findUnique).not.toHaveBeenCalled();
    // Y el mapeo se hizo de verdad, no devolvio 25 `null`.
    expect(res.items.filter((i) => i.mensajero !== null)).toHaveLength(13);
    expect(res.items[0].mensajero?.nombre).toBe("Carlos Jimenez Mora");
  });

  it("404/R18: el DETALLE hereda `mensajero` sin que su `select` declare nada propio", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          ...ordenSelectRow({ mensajeroAsignado: MENSAJERO_ROW }),
          gestiones: [],
          incidentesAdmin: [],
        }),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    expect(res!.mensajero).toEqual({ id: MENSAJERO_ID, nombre: "Carlos Jimenez Mora" });
    expect(res!.evidencias).toEqual([]); // R19: el array sigue ahi, vacio
    // La herencia es por el spread de `API_ORDEN_SELECT`: el `select` del detalle pide la MISMA
    // relacion, con la MISMA proyeccion que el listado. Si alguien la declarara aparte, los dos
    // podrian divergir — que es justo lo que la constante compartida existe para impedir.
    const detalleSelect = (prisma.orden.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .select;
    const listaPrisma = buildPrisma();
    await new OrdenRepository(listaPrisma as unknown as PrismaClient).listByOwner({
      ownerId: OWNER,
      skip: 0,
      take: 1,
    });
    const listadoSelect = (listaPrisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .select;
    expect(detalleSelect.mensajeroAsignado).toEqual(listadoSelect.mensajeroAsignado);
  });

  it("404/R21+R22: el detalle no proyecta el mensajero de la gestion ni su texto libre", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          ...ordenSelectRow({ mensajeroAsignado: MENSAJERO_ROW }),
          gestiones: [],
          incidentesAdmin: [],
        }),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    const { select } = (prisma.orden.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // El gestor es `gestion_orden.mensajero_id` y es la 405: aqui no se pide.
    expect(select.gestiones.select).not.toHaveProperty("mensajeroId");
    expect(select.gestiones.select).not.toHaveProperty("motivo"); // 256/R22, texto libre
    // Y del asignado no se pide nada mas alla de la identidad.
    expect(select.mensajeroAsignado.select).not.toHaveProperty("telefono");
    expect(select.mensajeroAsignado.select).not.toHaveProperty("email");
    expect(select.mensajeroAsignado.select).not.toHaveProperty("cedula");
    // R22: y el `select` publico sigue sin pedir ids internos de la orden ni la tienda.
    expect(select).not.toHaveProperty("id");
    expect(select).not.toHaveProperty("tiendaId");
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
