import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { CreateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";
import {
  CargaLoteAjenoError,
  CargaNombreDuplicadoError,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import { buildCargaDelegate, loteCtx, type CargaDelegateFake } from "@/tests/fixtures/carga-lote";

// Feature 141 (T6/T18/T22/T26) — el lote en la capa de repositorio. Cubre:
//   R15/R16 — el `carga_id` escrito en las ordenes es el id GENERADO POR EL SERVIDOR; un
//             token entrante nunca se convierte en el id de una fila nueva.
//   R17/R19 — token propio -> reutiliza; token desconocido/ajeno -> aborta sin crear ordenes.
//   R21/R24 — `name` persistido al crear; nombre repetido -> aborta (409 en el borde).
//   R34     — el lote se resuelve y las ordenes se insertan en la MISMA $transaction.
//   R28/R35 — ningun lote huerfano: un batch sin filas por insertar NO toca `carga`.
//   R36     — TODAS las creadas del batch llevan el MISMO carga_id.
//   R30/R32 — via API key: UN lote por peticion aunque haya varios batches internos.
//   R14/R40 — la carga masiva no envia `num_guia` ni `download_url` en el INSERT.
//   R47/R48 — persistencia POST-COMMIT de las URLs de descarga.

const TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HIST_CARGA = { actorUsuarioId: "tienda-1", origenTipo: "carga_masiva" } as const;
const HIST_API = { actorUsuarioId: "key-user-1", origenTipo: "carga_api" } as const;

function buildPrisma(carga: CargaDelegateFake = buildCargaDelegate()) {
  const prisma = {
    orden: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(async () => ({})),
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

describe("createManyOrdenes — el lote se resuelve en la MISMA transaccion (R34/R36)", () => {
  it("R15/R36: todas las filas del createMany llevan el carga_id GENERADO POR EL SERVIDOR", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    prisma.orden.createMany.mockResolvedValue({ count: 2 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.createManyOrdenes(
      [baseCreateData({ numRemision: "REM-1" }), baseCreateData({ numRemision: "REM-2" })],
      500,
      HIST_CARGA,
      loteCtx({ cargaId: null, usuarioCargaId: "tienda-1", totalFiles: 2 }),
    );

    const idServidor = [...carga.filas.keys()][0];
    expect(res.cargaId).toBe(idServidor);
    const filas = prisma.orden.createMany.mock.calls[0][0].data;
    expect(filas.map((f: { cargaId: string }) => f.cargaId)).toEqual([idServidor, idServidor]);
  });

  it("R34: el lote se resuelve DENTRO del mismo $transaction y ANTES del insert", async () => {
    const orden: string[] = [];
    const carga = buildCargaDelegate();
    const createReal = carga.create as unknown as (args: unknown) => Promise<unknown>;
    carga.create = vi.fn(async (args: unknown) => {
      orden.push("carga.create");
      return createReal(args);
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

    expect(orden).toEqual(["tx.start", "carga.create", "orden.createMany", "tx.end"]);
  });

  it("R34: si el insert de las ordenes falla, el error se propaga (la tx revierte el lote)", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany.mockRejectedValue(new Error("insert boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.createManyOrdenes([baseCreateData()], 500, HIST_CARGA, loteCtx()),
    ).rejects.toThrow("insert boom");
    expect(prisma.orden.createMany).toHaveBeenCalledTimes(1);
  });

  it("R14/R40: la fila insertada no lleva num_guia ni download_url", async () => {
    const prisma = buildPrisma();
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenes([baseCreateData()], 500, HIST_CARGA, loteCtx());

    const fila = prisma.orden.createMany.mock.calls[0][0].data[0];
    expect(fila).not.toHaveProperty("numGuia");
    expect(fila).not.toHaveProperty("downloadUrl");
  });
});

describe("createManyOrdenes — token del lote entrante (R15/R17/R19/R24)", () => {
  it("R17: con un token propio REUTILIZA la fila (no crea otra) y cuelga las ordenes de ella", async () => {
    const carga = buildCargaDelegate([
      { id: TOKEN, usuarioCarga: "tienda-1", name: "enero", totalFiles: 500, downloadUrl: null },
    ]);
    const prisma = buildPrisma(carga);
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.createManyOrdenes(
      [baseCreateData()],
      500,
      HIST_CARGA,
      loteCtx({ cargaId: TOKEN, usuarioCargaId: "tienda-1", totalFiles: 500 }),
    );

    expect(res.cargaId).toBe(TOKEN);
    expect(carga.create).not.toHaveBeenCalled();
    expect(carga.filas.size).toBe(1);
    expect(prisma.orden.createMany.mock.calls[0][0].data[0].cargaId).toBe(TOKEN);
  });

  it("R15/R19: un token INEXISTENTE no crea ninguna fila con ese id y aborta la insercion", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.createManyOrdenes(
        [baseCreateData()],
        500,
        HIST_CARGA,
        loteCtx({ cargaId: TOKEN, usuarioCargaId: "tienda-1" }),
      ),
    ).rejects.toBeInstanceOf(CargaLoteAjenoError);
    expect(carga.filas.has(TOKEN)).toBe(false);
    expect(carga.create).not.toHaveBeenCalled();
    expect(prisma.orden.createMany).not.toHaveBeenCalled(); // ninguna orden persistida
  });

  it("R19: un token de OTRO usuario aborta la insercion sin tocar el lote ajeno", async () => {
    const carga = buildCargaDelegate([
      { id: TOKEN, usuarioCarga: "otra-tienda", name: null, totalFiles: 10, downloadUrl: null },
    ]);
    const prisma = buildPrisma(carga);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.createManyOrdenes(
        [baseCreateData()],
        500,
        HIST_CARGA,
        loteCtx({ cargaId: TOKEN, usuarioCargaId: "tienda-1" }),
      ),
    ).rejects.toBeInstanceOf(CargaLoteAjenoError);
    expect(carga.filas.get(TOKEN)).toMatchObject({ usuarioCarga: "otra-tienda", totalFiles: 10 });
    expect(prisma.orden.createMany).not.toHaveBeenCalled();
  });

  it("R24: un `name` ya usado por el actor aborta la insercion (nada persistido)", async () => {
    const carga = buildCargaDelegate([
      { id: "otro", usuarioCarga: "tienda-1", name: "enero", totalFiles: 5, downloadUrl: null },
    ]);
    const prisma = buildPrisma(carga);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.createManyOrdenes(
        [baseCreateData()],
        500,
        HIST_CARGA,
        loteCtx({ usuarioCargaId: "tienda-1", name: "enero" }),
      ),
    ).rejects.toBeInstanceOf(CargaNombreDuplicadoError);
    expect(prisma.orden.createMany).not.toHaveBeenCalled();
    expect(carga.filas.size).toBe(1);
  });

  it("R21: el `name` del lote llega al INSERT de `carga`", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    prisma.orden.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.createManyOrdenes(
      [baseCreateData()],
      500,
      HIST_CARGA,
      loteCtx({ name: "carga de enero" }),
    );

    expect([...carga.filas.values()][0].name).toBe("carga de enero");
  });
});

describe("createManyOrdenes — sin lotes huerfanos (R28/R35)", () => {
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
      loteCtx(),
    );

    expect(carga.create).not.toHaveBeenCalled();
    expect(carga.filas.size).toBe(0);
    expect(prisma.orden.createMany).not.toHaveBeenCalled();
    // Feature 294: el early-return sigue sin tocar `carga`, pero la fila que se queda fuera YA
    // NO se pierde — sale nombrada en `omitidas`, que es lo que el servicio convierte en
    // `duplicada` en el resumen. Sin esto, la tienda veia «creada» una orden inexistente.
    expect(res).toEqual({ inserted: 0, cargaId: null, omitidas: ["REM-DUP"] });
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
      loteCtx({ totalFiles: 2 }),
    );

    expect(carga.filas.size).toBe(1);
    expect(res.cargaId).toBe([...carga.filas.keys()][0]);
  });
});

describe("createManyOrdenesConGuia — un lote por peticion (R30/R32/R36)", () => {
  it("R30: dos batches internos comparten UN solo lote (id generado una vez por el servidor)", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    prisma.orden.findMany
      .mockResolvedValueOnce([]) // batch 1 · before
      .mockResolvedValueOnce([
        {
          id: "o1",
          numRemision: "REM-1",
          estatusId: idEstado("por_recolectar_en_tienda"),
          estatus: { value: "por_recolectar_en_tienda" },
        },
      ]) // batch 1 · after
      .mockResolvedValueOnce([]) // batch 2 · before
      .mockResolvedValueOnce([
        {
          id: "o2",
          numRemision: "REM-2",
          estatusId: idEstado("por_recolectar_en_tienda"),
          estatus: { value: "por_recolectar_en_tienda" },
        },
      ]); // batch 2 · after
    prisma.orden.findUniqueOrThrow
      .mockResolvedValueOnce({ numGuia: 11 })
      .mockResolvedValueOnce({ numGuia: 12 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.createManyOrdenesConGuia(
      [
        baseCreateData({ numRemision: "REM-1", estatusId: idEstado("por_recolectar_en_tienda") }),
        baseCreateData({ numRemision: "REM-2", estatusId: idEstado("por_recolectar_en_tienda") }),
      ],
      1, // batchSize 1 -> DOS transacciones
      HIST_API,
      loteCtx({ cargaId: null, usuarioCargaId: "key-user-1", totalFiles: 2, name: "lote api" }),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(carga.filas.size).toBe(1); // UN lote, no uno por batch
    expect(carga.create).toHaveBeenCalledTimes(1);
    expect(res.cargaId).toBe([...carga.filas.keys()][0]);
    // R32/R21: el total es el del payload (no el del batch interno) y el nombre se persiste.
    expect([...carga.filas.values()][0]).toMatchObject({
      usuarioCarga: "key-user-1",
      totalFiles: 2,
      name: "lote api",
    });
    // R36: ambas ordenes cuelgan del MISMO lote.
    const enviados = prisma.orden.createMany.mock.calls.map(
      (c) => (c[0] as { data: Array<{ cargaId: string }> }).data[0].cargaId,
    );
    expect(new Set(enviados).size).toBe(1);
  });

  it("R33/R35: un lote 100% duplicado no crea fila en `carga`", async () => {
    const carga = buildCargaDelegate();
    const prisma = buildPrisma(carga);
    prisma.orden.findMany.mockResolvedValueOnce([{ id: "o-existing", numRemision: "REM-1" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.createManyOrdenesConGuia(
      [baseCreateData({ numRemision: "REM-1", estatusId: idEstado("por_recolectar_en_tienda") })],
      500,
      HIST_API,
      loteCtx({ cargaId: null, usuarioCargaId: "key-user-1" }),
    );

    // Feature 294: misma regla que en la ruta sin guia — lo que no entra, se nombra.
    expect(res).toEqual({ creadas: [], cargaId: null, omitidas: ["REM-1"] });
    expect(carga.filas.size).toBe(0);
  });
});

// BORRADO 2026-08-07 (tanda 2 del chore de deuda de superficie): aqui vivia el caso del ALTA
// MANUAL INDIVIDUAL, que afirmaba que `create` no enviaba `carga_id`/`download_url` ni tocaba
// `carga`. `create` se borro al quedarse sin llamador, asi que la afirmacion es hoy vacua: no
// existe alta manual de la que aislar el lote. R40 conserva testigo en "R14/R40: la fila
// insertada no lleva num_guia ni download_url", arriba. R37 se retira CON la capacidad que
// describia — era un requisito DEL alta manual, no del lote.
