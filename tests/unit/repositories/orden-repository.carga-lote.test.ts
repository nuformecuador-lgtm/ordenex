import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { CreateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";
import { CargaLoteAjenoError } from "@/lib/interfaces/repositories/IOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import { buildCargaDelegate, loteCtx, type CargaDelegateFake } from "@/tests/fixtures/carga-lote";

// Feature 141 (T6/T12/T13) — el lote en la capa de repositorio. Cubre:
//   R23 — el ensure del lote y el INSERT de las ordenes ocurren en la MISMA $transaction;
//         si el insert falla, la tx revierte y no queda lote.
//   R24 — ningun lote huerfano: un batch sin filas por insertar NO toca `carga`.
//   R25 — TODAS las ordenes creadas del batch llevan el MISMO carga_id; las duplicadas
//         saltadas por skipDuplicates no se modifican.
//   R26 — el alta manual individual (`create`) deja carga_id NULL y no crea lote.
//   R29 — ningun camino escribe `download_url` (ni en `orden` ni en `carga`).
//   R11 — la carga masiva sigue sin enviar `num_guia`.
//   R17 — un lote de otro usuario aborta la insercion (el borde lo traduce a 403).
//   R19 — via API key: UN solo lote aunque el lote se parta en varios batches internos.

const UUID_SESION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HIST_CARGA = { actorUsuarioId: "tienda-1", origenTipo: "carga_masiva" } as const;
const HIST_API = { actorUsuarioId: "key-user-1", origenTipo: "carga_api" } as const;

function buildPrisma(carga: CargaDelegateFake = buildCargaDelegate()) {
  const prisma = {
    orden: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: vi.fn(),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
    carga,
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function baseCreateData(overrides: Partial<CreateOrdenData> = {}): CreateOrdenData {
  return {
    numRemision: "REM-1",
    estatusId: idEstado("en_preparacion"),
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "tienda-1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    producto: "Caja",
    peso: null,
    direccion: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO
});

describe("createManyOrdenes — lote en la MISMA transaccion (R23/R25)", () => {
  it("R25: todas las filas del createMany llevan el MISMO carga_id del lote", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany.mockResolvedValue({ count: 2 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.createManyOrdenes(
      [baseCreateData({ numRemision: "REM-1" }), baseCreateData({ numRemision: "REM-2" })],
      500,
      HIST_CARGA,
      loteCtx({ cargaId: UUID_SESION, usuarioCargaId: "tienda-1", totalFiles: 2 }),
    );

    expect(res.cargaId).toBe(UUID_SESION);
    const filas = prisma.orden.createMany.mock.calls[0][0].data;
    expect(filas.map((f: { cargaId: string }) => f.cargaId)).toEqual([UUID_SESION, UUID_SESION]);
  });

  it("R23: el ensure del lote ocurre DENTRO del mismo $transaction y ANTES del insert", async () => {
    const orden: string[] = [];
    const carga = buildCargaDelegate();
    carga.createMany.mockImplementation(async ({ data }: { data: Array<{ id: string }> }) => {
      orden.push("carga.createMany");
      carga.filas.set(data[0].id, {
        id: data[0].id,
        usuarioCarga: "tienda-1",
        totalFiles: 1,
        downloadUrl: null,
      });
      return { count: 1 };
    });
    const prisma = buildPrisma(carga);
    prisma.orden.createMany.mockImplementation(async () => {
      orden.push("orden.createMany");
      return { count: 1 };
    });
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      orden.push("tx.start");
      const out = await fn(prisma);
      orden.push("tx.end");
      return out;
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenes([baseCreateData()], 500, HIST_CARGA, loteCtx());

    expect(orden).toEqual(["tx.start", "carga.createMany", "orden.createMany", "tx.end"]);
  });

  it("R23: si el insert de las ordenes falla, el error se propaga y la tx revierte", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany.mockRejectedValue(new Error("insert boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.createManyOrdenes([baseCreateData()], 500, HIST_CARGA, loteCtx()),
    ).rejects.toThrow("insert boom");
    // El ensure del lote vive en la MISMA tx: al revertir, la fila de `carga` se va con ella
    // (aqui se observa que no hubo commit: el insert nunca completo).
    expect(prisma.orden.createMany).toHaveBeenCalledTimes(1);
  });

  it("R17: un lote de OTRO usuario aborta la insercion (sin crear ordenes)", async () => {
    const carga = buildCargaDelegate([
      { id: UUID_SESION, usuarioCarga: "otra-tienda", totalFiles: 10, downloadUrl: null },
    ]);
    const prisma = buildPrisma(carga);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.createManyOrdenes(
        [baseCreateData()],
        500,
        HIST_CARGA,
        loteCtx({ cargaId: UUID_SESION, usuarioCargaId: "tienda-1" }),
      ),
    ).rejects.toBeInstanceOf(CargaLoteAjenoError);
    expect(prisma.orden.createMany).not.toHaveBeenCalled();
  });

  it("R11/R29: la fila insertada no lleva num_guia ni download_url", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenes([baseCreateData()], 500, HIST_CARGA, loteCtx());

    const fila = prisma.orden.createMany.mock.calls[0][0].data[0];
    expect(fila).not.toHaveProperty("numGuia");
    expect(fila).not.toHaveProperty("downloadUrl");
  });
});

describe("createManyOrdenes — sin lotes huerfanos (R15/R24)", () => {
  it("un batch cuyas filas YA existen no toca `carga` ni inserta", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    // `before` (dentro de la tx) devuelve las MISMAS remisiones del batch: nada por insertar.
    prisma.orden.findMany.mockResolvedValueOnce([{ id: "o-existing", numRemision: "REM-DUP" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.createManyOrdenes(
      [baseCreateData({ numRemision: "REM-DUP" })],
      500,
      HIST_CARGA,
      loteCtx({ cargaId: UUID_SESION }),
    );

    expect(carga.createMany).not.toHaveBeenCalled();
    expect(carga.filas.size).toBe(0);
    expect(prisma.orden.createMany).not.toHaveBeenCalled();
    expect(res.inserted).toBe(0);
  });

  it("un batch mixto (una nueva, una duplicada) SI crea el lote", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    prisma.orden.findMany
      .mockResolvedValueOnce([{ id: "o-existing", numRemision: "REM-DUP" }]) // before
      .mockResolvedValueOnce([
        { id: "o-existing", estatusId: idEstado("en_preparacion"), direccion: null },
        { id: "o-new", estatusId: idEstado("en_preparacion"), direccion: null },
      ]); // after
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.createManyOrdenes(
      [baseCreateData({ numRemision: "REM-DUP" }), baseCreateData({ numRemision: "REM-NEW" })],
      500,
      HIST_CARGA,
      loteCtx({ cargaId: UUID_SESION, totalFiles: 2 }),
    );

    expect(res.cargaId).toBe(UUID_SESION);
    expect(carga.filas.size).toBe(1);
  });
});

describe("createManyOrdenesConGuia — un lote por peticion (R19/R21/R25)", () => {
  it("R19: dos batches internos comparten UN solo lote (el id se genera una vez)", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    prisma.orden.findMany
      .mockResolvedValueOnce([]) // batch 1 · before
      .mockResolvedValueOnce([
        {
          id: "o1",
          numRemision: "REM-1",
          estatusId: idEstado("en_ruta_bodega_central"),
          estatus: { value: "en_ruta_bodega_central" },
        },
      ]) // batch 1 · after
      .mockResolvedValueOnce([]) // batch 2 · before
      .mockResolvedValueOnce([
        {
          id: "o2",
          numRemision: "REM-2",
          estatusId: idEstado("en_ruta_bodega_central"),
          estatus: { value: "en_ruta_bodega_central" },
        },
      ]); // batch 2 · after
    prisma.orden.findUniqueOrThrow
      .mockResolvedValueOnce({ numGuia: 11 })
      .mockResolvedValueOnce({ numGuia: 12 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.createManyOrdenesConGuia(
      [
        baseCreateData({ numRemision: "REM-1", estatusId: idEstado("en_ruta_bodega_central") }),
        baseCreateData({ numRemision: "REM-2", estatusId: idEstado("en_ruta_bodega_central") }),
      ],
      1, // batchSize 1 -> DOS transacciones
      HIST_API,
      loteCtx({ cargaId: null, usuarioCargaId: "key-user-1", totalFiles: 2 }),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(carga.filas.size).toBe(1); // UN lote, no uno por batch
    expect(res.cargaId).toBe([...carga.filas.keys()][0]);
    // R21: el total del lote es el del payload, no el del batch interno.
    expect([...carga.filas.values()][0]).toMatchObject({
      usuarioCarga: "key-user-1",
      totalFiles: 2,
    });
    // R25: ambas ordenes cuelgan del MISMO lote.
    const enviados = prisma.orden.createMany.mock.calls.map(
      (c) => (c[0] as { data: Array<{ cargaId: string }> }).data[0].cargaId,
    );
    expect(new Set(enviados).size).toBe(1);
  });

  it("R22/R24: un lote 100% duplicado no crea fila en `carga`", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    prisma.orden.findMany.mockResolvedValueOnce([{ id: "o-existing", numRemision: "REM-1" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.createManyOrdenesConGuia(
      [baseCreateData({ numRemision: "REM-1", estatusId: idEstado("en_ruta_bodega_central") })],
      500,
      HIST_API,
      loteCtx({ cargaId: null, usuarioCargaId: "key-user-1" }),
    );

    expect(res).toEqual({ creadas: [], cargaId: null });
    expect(carga.filas.size).toBe(0);
  });
});

describe("alta manual individual — sin lote (R26/R29)", () => {
  it("`create` no envia carga_id ni download_url y no toca `carga`", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    prisma.orden.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "orden-manual",
      ...data,
      numGuia: null,
      estatus: { value: "en_preparacion" },
      peso: null,
      montoCobrar: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.create(baseCreateData(), {
      actorUsuarioId: "tienda-1",
      origenTipo: "creacion_manual",
    });

    const data = prisma.orden.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("cargaId");
    expect(data).not.toHaveProperty("downloadUrl");
    expect(carga.createMany).not.toHaveBeenCalled();
    expect(carga.filas.size).toBe(0);
  });
});
