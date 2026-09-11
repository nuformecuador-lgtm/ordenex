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
    // ⏳ 2026-09-10 (feature 415): lo que el `select` nuevo trae. `orden.zona_id` es NOT NULL, asi
    // que la relacion `zona` NUNCA llega `null`. Por DEFECTO: sin distrito registrado (el unico FK
    // nullable de `orden`) y sin ninguna fila congelada elegible —el 28 % medido—.
    zonaId: ZONA_ID,
    cobraComision: false,
    zona: { id: ZONA_ID, nombre: "GAM", esCentral: true },
    distrito: null,
    cierreDetalles: [],
    ...overrides,
  };
}

const OWNER = "store-1";
const ORDEN_ID = "orden-1";
const ZONA_ID = "018f2c31-0000-4000-8000-00000000za01";

/**
 * ⏳ 2026-09-10 (feature 415) — la fila de `cierre_detail` que Prisma devuelve para la relacion
 * `cierreDetalles`, ya proyectada por el `select` del repositorio. Los montos son `Decimal`, como
 * los devuelve el motor.
 */
function cierreDetalleRow(overrides: Record<string, unknown> = {}) {
  return {
    montoCobrar: new Prisma.Decimal("25900.00"),
    cobraComision: true,
    esCentral: true,
    esZonaEspecial: false,
    tarifaId: "tarifa-congelada-1",
    tarifaValorFlete: new Prisma.Decimal("3000.00"),
    tarifaValorFleteGam: new Prisma.Decimal("2500.00"),
    tarifaValorFleteDevuelto: new Prisma.Decimal("1500.00"),
    tarifaValorFleteDevueltoGam: new Prisma.Decimal("1200.00"),
    tarifaComisionCod: new Prisma.Decimal("3.50"),
    tarifaIvaFlete: new Prisma.Decimal("13.00"),
    tarifaIvaComisionCod: new Prisma.Decimal("13.00"),
    tarifaEspecial: null,
    tarifaEspecialDevuelta: null,
    tarifaFulfillment: new Prisma.Decimal("692.00"),
    ...overrides,
  };
}

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
    //
    // ⏳ 2026-09-10 (feature 415, R34): ENMENDADO, no relajado. La fila gana DOS campos —`zona`,
    // que se publica, y `costeo`, que NO— y sigue siendo igualdad estructural: si alguien colara
    // una tercera, esto se pone rojo. Los nueve de siempre y `mensajero` conservan nombre, tipo y
    // valor, que es lo que R34 pide.
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
      zona: { id: ZONA_ID, nombre: "GAM" },
      costeo: {
        zonaId: ZONA_ID,
        esCentral: true,
        esZonaEspecial: false,
        // R17: CADENA de escala 2, mientras que el publicado de arriba es el `number` 1500.
        montoCobrar: "1500.00",
        cobraComision: false,
        congelado: null,
      },
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
          historialEstados: [], // 405: relacion nueva del select del detalle
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
          historialEstados: [], // 405: relacion nueva del select del detalle
          incidentesAdmin: [],
        }),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    const { select } = (prisma.orden.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // ⏳ 2026-09-10 (feature 405) — AQUI DECIA «el gestor es `gestion_orden.mensajero_id` y es la
    // 405: aqui no se pide», y esa mitad ya NO es cierta: la 405 publica el mensajero de cada
    // gestion. Lo que sigue vigente, y es lo que estos dos asertos protegen de verdad:
    //   · la FK cruda `mensajeroId` NO se proyecta —lo que se pide es la RELACION `mensajero`,
    //     acotada a `id` + las tres columnas de identidad, igual que el asignado—;
    //   · el TEXTO LIBRE `gestion_orden.motivo` sigue sin proyectarse (256/R22), y esa parte no
    //     tiene fecha de caducidad.
    expect(select.gestiones.select).not.toHaveProperty("mensajeroId");
    expect(select.gestiones.select).not.toHaveProperty("motivo"); // 256/R22, texto libre
    // 405/R12: y del gestor tampoco se pide nada mas alla de su identidad.
    expect(select.gestiones.select.mensajero.select).not.toHaveProperty("telefono");
    expect(select.gestiones.select.mensajero.select).not.toHaveProperty("email");
    expect(select.gestiones.select.mensajero.select).not.toHaveProperty("cedula");
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
      historialEstados: [], // 405: relacion nueva del select del detalle
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
      historialEstados: [], // 405: relacion nueva del select del detalle
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
      historialEstados: [], // 405: relacion nueva del select del detalle
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
      historialEstados: [], // 405: relacion nueva del select del detalle
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
      historialEstados: [], // 405: relacion nueva del select del detalle
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
      historialEstados: [], // 405: relacion nueva del select del detalle
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

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-09-10 — Feature 415 (T3): la zona, las entradas VIVAS y la fila CONGELADA.
//
// ⚠️ LO QUE ESTE ARCHIVO PUEDE Y NO PUEDE AFIRMAR. Prisma esta MOCKEADO, asi que aqui se afirma
// **QUE SE LE PIDIO A PRISMA** —la forma del `select`, su `where`, su `orderBy` y su `take`— y el
// MAPEO de lo que Prisma devuelve. Lo que Postgres HACE con ese `where` **solo lo dice Postgres**:
// eso vive en `tests/integration/db/costo-y-zona-api-415.test.ts`, que no es opcional.
// -----------------------------------------------------------------------------------------------

describe("OrdenRepository — zona y costo del canal (feature 415)", () => {
  it("415/R1+R5: `zona` sale con `id` y `nombre` del catalogo, sin transformar y SIN `esCentral`", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([
          ordenSelectRow({
            zona: { id: ZONA_ID, nombre: "FGAM Zona Sur", esCentral: false },
          }),
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    // El nombre va TAL CUAL: ni recortado, ni normalizado, ni partido por el espacio.
    expect(res.items[0].zona).toEqual({ id: ZONA_ID, nombre: "FGAM Zona Sur" });
    expect(Object.keys(res.items[0].zona).sort()).toEqual(["id", "nombre"]);
    // `esCentral` baja al `costeo` —donde elige la columna de flete— y NO al campo publicado.
    expect(res.items[0].zona).not.toHaveProperty("esCentral");
    expect(res.items[0].costeo.esCentral).toBe(false);
  });

  it("415/R1: el `select` pide `id`, `nombre` y `esCentral` de la zona, y NADA mas", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    const select = (prisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].select;
    expect(select.zona).toEqual({ select: { id: true, nombre: true, esCentral: true } });
    // R5: del distrito solo la marca, ni el nombre ni la geografia.
    expect(select.distrito).toEqual({ select: { zonaEspecial: true } });
  });

  it("415/R21: distrito con `zonaEspecial: null` y orden SIN distrito dan los DOS `false`", async () => {
    // La columna es TRI-VALUADA: `null` = «nadie lo decidio», y NO vale `!zonaEspecial`. Si el
    // mapeo usara la negacion, el caso `null` saldria `true` y este aserto se pondria rojo.
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([
          ordenSelectRow({ distrito: { zonaEspecial: null } }),
          ordenSelectRow({ numRemision: "REM-2", distrito: null }),
          // Y el contraste: `true` SI es `true`, para que el caso de arriba no salga verde por
          // vacio (un mapeo que devolviera siempre `false` moriria aqui).
          ordenSelectRow({ numRemision: "REM-3", distrito: { zonaEspecial: true } }),
        ]),
        count: vi.fn().mockResolvedValue(3),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    expect(res.items[0].costeo.esZonaEspecial).toBe(false);
    expect(res.items[1].costeo.esZonaEspecial).toBe(false);
    expect(res.items[2].costeo.esZonaEspecial).toBe(true);
  });

  it("415/R17: `costeo.montoCobrar` es una CADENA de dos decimales, no el `number` publicado", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([
          ordenSelectRow({ montoCobrar: new Prisma.Decimal("16618.4") }),
          ordenSelectRow({ numRemision: "REM-2", montoCobrar: null }),
        ]),
        count: vi.fn().mockResolvedValue(2),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    // Publicado: `number` (feature 106). Para calcular: CADENA de escala 2 (design §D9).
    expect(res.items[0].montoCobrar).toBe(16618.4);
    expect(typeof res.items[0].montoCobrar).toBe("number");
    expect(res.items[0].costeo.montoCobrar).toBe("16618.40");
    expect(typeof res.items[0].costeo.montoCobrar).toBe("string");
    // Sin COD, `null` en las dos (no "0.00" inventado aqui).
    expect(res.items[1].montoCobrar).toBeNull();
    expect(res.items[1].costeo.montoCobrar).toBeNull();
  });

  it("415/R26+R27+R33: el `select` del congelado lleva el `where`, el `orderBy` y el `take` exactos", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    const select = (prisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].select;
    const rel = select.cierreDetalles;

    // R33: el `tienda_id` que acota es el CONGELADO de la fila, y es el OWNER de la peticion.
    // R26: y el filtro por estado del cierre va EXPLICITO. Si alguien lo borrara por «redundante»,
    // esta igualdad se pone roja y dice exactamente que falta.
    expect(rel.where).toEqual({ tiendaId: OWNER, cierre: { estado: "aprobado" } });
    // R27: orden TOTAL (dos claves) y una sola fila. Con una sola clave, dos filas del mismo
    // instante podrian salir en distinto orden entre dos lecturas.
    expect(rel.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(rel.take).toBe(1);
    // ⚠️ ESTO AFIRMA LO QUE SE LE PIDIO A PRISMA, NO LO QUE POSTGRES DEVUELVE. Que el filtro
    // FUNCIONE —que un cierre `solicitado` o `rechazado` no alimente `costoReal`— lo demuestra
    // `tests/integration/db/costo-y-zona-api-415.test.ts`, contra base real.
  });

  it("415/R18: el `select` del congelado NO pide ninguna columna que se publique", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    const select = (prisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].select;
    const claves = Object.keys(select.cierreDetalles.select).sort();
    // Las QUINCE del design §4, ni una mas: las cuatro entradas congeladas y las once de tarifa.
    expect(claves).toEqual([
      "cobraComision",
      "esCentral",
      "esZonaEspecial",
      "montoCobrar",
      "tarifaComisionCod",
      "tarifaEspecial",
      "tarifaEspecialDevuelta",
      "tarifaFulfillment",
      "tarifaId",
      "tarifaIvaComisionCod",
      "tarifaIvaFlete",
      "tarifaValorFlete",
      "tarifaValorFleteDevuelto",
      "tarifaValorFleteDevueltoGam",
      "tarifaValorFleteGam",
    ]);
    // Lo que NO se lee no se puede filtrar: ni el id de la fila, ni el del cierre, ni el
    // `zona_nombre` congelado, ni la fecha de congelacion, ni los descriptivos.
    for (const prohibida of ["id", "cierreId", "ordenId", "zonaId", "zonaNombre", "createdAt", "tiendaId"]) {
      expect(claves).not.toContain(prohibida);
    }
  });

  it("415/R25+R29: el congelado se reconstruye con la tarifa y el fulfillment de la FILA", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi
          .fn()
          .mockResolvedValue([ordenSelectRow({ cierreDetalles: [cierreDetalleRow()] })]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    // Los valores van A MANO: son los mismos que `cierreDetalleRow` siembra, escritos aqui como
    // cadenas de escala 2 —que es lo que `tarifaDe` produce— y no leidos de la fixture.
    expect(res.items[0].costeo.congelado).toEqual({
      tarifa: {
        valorFlete: "3000.00",
        valorFleteGam: "2500.00",
        valorFleteDevuelto: "1500.00",
        valorFleteDevueltoGam: "1200.00",
        comisionCod: "3.50",
        ivaFlete: "13.00",
        ivaComisionCod: "13.00",
        tarifaEspecial: null,
        tarifaEspecialDevuelta: null,
      },
      fulfillment: "692.00",
      esCentral: true,
      esZonaEspecial: false,
      montoCobrar: "25900.00",
      cobraComision: true,
    });
  });

  it("415/R28+R29: `tarifa_id` NULL da tarifa `null`, y `tarifa_fulfillment` NULL da `\"0.00\"`", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([
          ordenSelectRow({
            cierreDetalles: [cierreDetalleRow({ tarifaId: null, tarifaFulfillment: null })],
          }),
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    expect(res.items[0].costeo.congelado!.tarifa).toBeNull();
    expect(res.items[0].costeo.congelado!.fulfillment).toBe("0.00");
    // Pero la FILA existe: eso es lo que separa el cero AFIRMADO (R28) del `costoReal: null`.
    expect(res.items[0].costeo.congelado).not.toBeNull();
  });

  it("415/R26: sin fila congelada, `costeo.congelado` es `null` — el 28 % medido", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([ordenSelectRow({ cierreDetalles: [] })]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    expect(res.items[0].costeo.congelado).toBeNull();
  });

  it("415/R8+R31: una pagina de N ordenes con congelado NO anade consultas por item", async () => {
    const filas = Array.from({ length: 25 }, (_, i) =>
      ordenSelectRow({
        numRemision: `REM-${i}`,
        cierreDetalles: i % 2 === 0 ? [cierreDetalleRow()] : [],
      }),
    );
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue(filas),
        count: vi.fn().mockResolvedValue(25),
        findFirst: vi.fn(),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 25 });

    expect(res.items).toHaveLength(25);
    expect(prisma.orden.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orden.count).toHaveBeenCalledTimes(1);
  });

  it("415/R32: el `where` del listado y el del detalle NO cambian", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });
    await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    // El alcance se escribe en el WHERE de la ORDEN, y esta ficha no lo toca: lo que gano un
    // `where` propio es la RELACION anidada del congelado, no la consulta.
    expect((prisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({
      tiendaId: OWNER,
      deletedAt: null,
    });
    expect((prisma.orden.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({
      id: ORDEN_ID,
      tiendaId: OWNER,
      deletedAt: null,
    });
  });

  it("415/design §5.1: el detalle NO puede divergir del listado — misma proyeccion, misma fuente", async () => {
    const prisma = buildPrisma({
      orden: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.listByOwner({ ownerId: OWNER, skip: 0, take: 50 });
    await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    const listado = (prisma.orden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].select;
    const detalle = (prisma.orden.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].select;

    // ⭑ LA PROPIEDAD QUE LA CONSTANTE GARANTIZABA, AFIRMADA AHORA QUE ES UNA FUNCION. Para CADA
    // clave del listado, el detalle pide EXACTAMENTE lo mismo. Si alguien anadiera una columna
    // solo a uno de los dos, esto se pone rojo y dice cual. El detalle puede tener claves de MAS
    // (`gestiones`, `historialEstados`, `incidentesAdmin`); lo que no puede es divergir en las
    // compartidas ni perder ninguna.
    for (const clave of Object.keys(listado)) {
      expect(detalle, `falta \`${clave}\` en el detalle`).toHaveProperty(clave);
      expect(detalle[clave], `\`${clave}\` diverge entre listado y detalle`).toEqual(
        listado[clave],
      );
    }
    // Y el mismo `ownerId` llega a los dos `where` del congelado: la funcion no puede cerrar sobre
    // un valor distinto en cada camino.
    expect(detalle.cierreDetalles.where.tiendaId).toBe(OWNER);
    expect(listado.cierreDetalles.where.tiendaId).toBe(OWNER);
  });
});
