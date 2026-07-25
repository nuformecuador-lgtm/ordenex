import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { CreateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 49/#1: createManyOrdenes envuelve cada chunk en `$transaction`; el fake
// invoca el callback con el propio `prisma` como `tx` (tiene orden.* + el choke point
// ordenHistorialEstado.createMany). `orden.findMany` sirve para el pre/post SELECT por
// num_remision (before/after) que detecta las filas EFECTIVAMENTE insertadas (R8).
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    orderStatus: { findUnique: vi.fn() },
    zona: { findUnique: vi.fn(), findMany: vi.fn() },
    provincia: { findUnique: vi.fn(), findMany: vi.fn() },
    canton: { findUnique: vi.fn(), findMany: vi.fn() },
    distrito: { findUnique: vi.fn(), findMany: vi.fn() },
    usuario: { findMany: vi.fn() },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

// Feature 49/#1: contexto de historial de carga masiva (actor = la tienda que carga).
const HIST_CARGA = { actorUsuarioId: "tienda-1", origenTipo: "carga_masiva" } as const;

function baseCreateData(overrides: Partial<CreateOrdenData> = {}): CreateOrdenData {
  return {
    numRemision: "REM-1",
    estatusId: idEstado("en_preparacion"),
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    producto: "Caja",
    peso: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("OrdenRepository.findExistingRemisiones (R25)", () => {
  it("mapea numRemision -> estatus.value y filtra deletedAt:null", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { numRemision: "REM-1", estatus: { value: "en_bodega_central" } },
      { numRemision: "REM-2", estatus: { value: "entregada" } },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findExistingRemisiones(["REM-1", "REM-2", "REM-3"]);

    expect(map.get("REM-1")).toBe("en_bodega_central");
    expect(map.get("REM-2")).toBe("entregada");
    expect(map.has("REM-3")).toBe(false);

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      numRemision: { in: ["REM-1", "REM-2", "REM-3"] },
      deletedAt: null,
    });
  });

  it("devuelve un Map vacio sin consultar cuando no hay remisiones", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findExistingRemisiones([]);

    expect(map.size).toBe(0);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.findMensajerosByIds (R22)", () => {
  it("devuelve solo los ids con rol mensajero", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([{ id: "msg-1" }, { id: "msg-2" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const set = await repo.findMensajerosByIds(["msg-1", "msg-2", "no-mensajero"]);

    expect(set.has("msg-1")).toBe(true);
    expect(set.has("msg-2")).toBe(true);
    expect(set.has("no-mensajero")).toBe(false);

    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      id: { in: ["msg-1", "msg-2", "no-mensajero"] },
      rol: { value: "mensajero" },
    });
  });
});

describe("OrdenRepository — resolucion geografica batch (R19)", () => {
  it("findAllProvincias trae TODAS (sin filtrar por nombre; el match normalizado lo hace el service)", async () => {
    const prisma = buildPrisma();
    prisma.provincia.findMany.mockResolvedValue([{ id: "p1", nombre: "Pichincha" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findAllProvincias();

    expect(rows).toEqual([{ id: "p1", nombre: "Pichincha" }]);
    // No hay `where`: se traen todas y el service resuelve el match normalizando
    // (insensible a acentos), evitando descartar "Bogotá" cuando llega "Bogota".
    const arg = prisma.provincia.findMany.mock.calls[0][0];
    expect(arg.where).toBeUndefined();
  });

  it("findCantonesByProvinciaIds filtra por provinciaId in", async () => {
    const prisma = buildPrisma();
    prisma.canton.findMany.mockResolvedValue([{ id: "c1", nombre: "Quito", provinciaId: "p1" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCantonesByProvinciaIds(["p1"]);

    expect(rows).toEqual([{ id: "c1", nombre: "Quito", provinciaId: "p1" }]);
    const arg = prisma.canton.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ provinciaId: { in: ["p1"] } });
  });

  // Feature 24: la zona del distrito vive en la N:M `zona_distrito`, NO en la columna
  // escalar distrito.zona_id (que quedo sin poblar). El repo lee la relacion `zonas` y
  // aplana a `zonaId` solo cuando es inequivoca.
  it("findDistritosByCantonIds filtra por cantonId in y deriva zonaId de la N:M zona_distrito", async () => {
    const prisma = buildPrisma();
    prisma.distrito.findMany.mockResolvedValue([
      { id: "d1", nombre: "San Rafael", cantonId: "c1", zonas: [{ zonaId: "z1", zona: { esCentral: false } }] },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDistritosByCantonIds(["c1"]);

    expect(rows).toEqual([
      { id: "d1", nombre: "San Rafael", cantonId: "c1", zonaId: "z1", esCentral: false },
    ]);
    const arg = prisma.distrito.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ cantonId: { in: ["c1"] } });
    // La zona (y su flag esCentral, feature 98/R2) se piden por la relacion, no por la columna
    // escalar zona_id.
    expect(arg.select).toMatchObject({
      zonas: { select: { zonaId: true, zona: { select: { esCentral: true } } } },
    });
    expect(arg.select.zonaId).toBeUndefined();
  });

  it("findDistritosByCantonIds: distrito sin zonas -> zonaId null (no se inventa zona)", async () => {
    const prisma = buildPrisma();
    prisma.distrito.findMany.mockResolvedValue([
      { id: "d1", nombre: "San Rafael", cantonId: "c1", zonas: [] },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDistritosByCantonIds(["c1"]);

    // Feature 98/R2: sin zona -> esCentral false (no se tarifa: la fila falla arriba por zonaId null).
    expect(rows).toEqual([
      { id: "d1", nombre: "San Rafael", cantonId: "c1", zonaId: null, esCentral: false },
    ]);
  });

  it("findDistritosByCantonIds: distrito con >1 zonas -> zonaId null (ambiguo, no elige una)", async () => {
    const prisma = buildPrisma();
    prisma.distrito.findMany.mockResolvedValue([
      {
        id: "d1",
        nombre: "San Rafael",
        cantonId: "c1",
        zonas: [
          { zonaId: "z1", zona: { esCentral: true } },
          { zonaId: "z2", zona: { esCentral: false } },
        ],
      },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDistritosByCantonIds(["c1"]);

    // Ambiguo: ni "z1" (la primera) ni "z2". Null y esCentral false; la fila falla arriba.
    expect(rows).toEqual([
      { id: "d1", nombre: "San Rafael", cantonId: "c1", zonaId: null, esCentral: false },
    ]);
  });

  // Feature 98 (T4) — proyeccion de esCentral de la zona del distrito. Mapea R2.
  it("findDistritosByCantonIds: distrito en zona CENTRAL -> esCentral true", async () => {
    const prisma = buildPrisma();
    prisma.distrito.findMany.mockResolvedValue([
      { id: "d1", nombre: "Centro", cantonId: "c1", zonas: [{ zonaId: "z1", zona: { esCentral: true } }] },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDistritosByCantonIds(["c1"]);

    expect(rows).toEqual([
      { id: "d1", nombre: "Centro", cantonId: "c1", zonaId: "z1", esCentral: true },
    ]);
  });
});

describe("OrdenRepository.createManyOrdenes (R27)", () => {
  it("trocea en lotes de batchSize y llama createMany con skipDuplicates:true", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const data = [
      baseCreateData({ numRemision: "REM-1" }),
      baseCreateData({ numRemision: "REM-2" }),
      baseCreateData({ numRemision: "REM-3" }),
    ];

    const total = await repo.createManyOrdenes(data, 2, HIST_CARGA);

    expect(total).toBe(3);
    expect(prisma.orden.createMany).toHaveBeenCalledTimes(2);
    const firstCall = prisma.orden.createMany.mock.calls[0][0];
    expect(firstCall.skipDuplicates).toBe(true);
    expect(firstCall.data).toHaveLength(2);
    const secondCall = prisma.orden.createMany.mock.calls[1][0];
    expect(secondCall.data).toHaveLength(1);
  });

  it("mapea peso null a null y no revienta con montoCobrar/mensajeroSugeridoId ausentes", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenes([baseCreateData({ peso: null })], 500, HIST_CARGA);

    const arg = prisma.orden.createMany.mock.calls[0][0];
    expect(arg.data[0].peso).toBeNull();
    expect(arg.data[0].montoCobrar).toBeNull();
    expect(arg.data[0].mensajeroSugeridoId).toBeNull();
  });

  // Feature 17/R2/R8: la carga masiva NUNCA fija num_guia (queda NULL, se asigna
  // en "Generar guia") ni mensajero_asignado_id (acto posterior del maestro).
  it("no envia num_guia ni mensajero_asignado_id (R2/R8)", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenes([baseCreateData()], 500, HIST_CARGA);

    const arg = prisma.orden.createMany.mock.calls[0][0];
    expect(arg.data[0]).not.toHaveProperty("numGuia");
    expect(arg.data[0]).not.toHaveProperty("mensajeroAsignadoId");
  });

  // Feature 49/#1 (R9/R8/R20): deja 1 historial por orden EFECTIVAMENTE insertada; una
  // duplicada (que ya existia antes del insert) NO deja rastro.
  it("R9/R8: 1 historial por orden creada (origen null); las duplicadas no dejan rastro", async () => {
    const prisma = buildPrisma();
    // REM-2 ya existia (before); tras el insert existen ambas (after) -> solo REM-1 es nueva.
    prisma.orden.findMany
      .mockResolvedValueOnce([{ id: "ord-existing" }]) // before: REM-2 preexiste
      .mockResolvedValueOnce([
        { id: "ord-existing", estatusId: idEstado("en_preparacion") },
        { id: "ord-new", estatusId: idEstado("en_preparacion") },
      ]); // after
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const total = await repo.createManyOrdenes(
      [baseCreateData({ numRemision: "REM-1" }), baseCreateData({ numRemision: "REM-2" })],
      500,
      HIST_CARGA,
    );

    expect(total).toBe(1);
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    // Solo la nueva (ord-new) deja rastro; origen null (creacion), tipo carga_masiva.
    expect(arg.data).toEqual([
      {
        ordenId: "ord-new",
        estatusOrigenId: null,
        estatusDestinoId: idEstado("en_preparacion"),
        actorUsuarioId: "tienda-1",
        origenTipo: "carga_masiva",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  // R8: si TODAS las del chunk ya existian (todo duplicado), no se registra historial.
  it("R8: chunk 100% duplicado no registra historial", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany
      .mockResolvedValueOnce([{ id: "dup-1" }]) // before
      .mockResolvedValueOnce([{ id: "dup-1", estatusId: idEstado("en_preparacion") }]); // after: sin nuevas
    prisma.orden.createMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenes([baseCreateData({ numRemision: "REM-DUP" })], 500, HIST_CARGA);

    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});
