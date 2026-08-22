import { describe, it, expect, vi, beforeEach } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import { buildCargaDelegate, loteCtx } from "@/tests/fixtures/carga-lote";

// Feature 49 — T5.1 (R7): ATOMICIDAD del cambio de estado + su rastro. Por cada MECANISMO
// de escritura (transaccion con create/loop de updates, updateMany-envuelto, raw con
// RETURNING) se prueba que:
//   (a) si el APPEND del historial falla, la operacion completa RECHAZA (Prisma revierte la
//       tx: nunca queda un cambio de estado sin su rastro), y
//   (b) si el CAMBIO DE ESTADO falla, el append NUNCA se ejecuta (no hay rastro sin estado).
// Los dobles simulan la tx: `$transaction` ejecuta el callback; un throw del callback se
// propaga como rechazo (equivalente al rollback real).

const HIST_GUIA = { actorUsuarioId: "u", origenTipo: "generacion_guia" } as const;
const HIST_CREACION = { actorUsuarioId: "u", origenTipo: "creacion_manual" } as const;
const HIST_RECEPCION = { actorUsuarioId: "u", origenTipo: "recepcion_satelite" } as const;
const HIST_ASIGNACION = { actorUsuarioId: "u", origenTipo: "asignacion_satelite" } as const;

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia es de fallo CERRADO
});

// --- Mecanismo A: insercion dentro de $transaction (#2) ---
// REAPUNTADO 2026-08-07 (tanda 2 del chore de deuda de superficie): este bloque se escribia
// sobre `OrdenRepository.create` (alta individual), borrado al quedarse sin llamador. El
// MECANISMO no ha muerto —insertar y anexar historial en la misma tx sigue siendo como nacen
// TODAS las ordenes—, solo cambia de puerta: hoy es `createManyOrdenes`. Se reapunta en vez de
// borrarse porque este archivo es un CENSO POR MECANISMO: quitar una fila dejaria la insercion,
// que esta viva, sin auditar la atomicidad de su rastro.
describe("R7 · mecanismo insercion-en-transaccion (#2)", () => {
  function build() {
    const orden = {
      createMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: "o1", estatusId: idEstado("en_preparacion"), direccion: null },
        ]),
    };
    const ordenHistorialEstado = { createMany: vi.fn(async () => ({ count: 1 })) };
    const prisma = {
      orden,
      ordenHistorialEstado,
      carga: buildCargaDelegate(),
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaObj)),
      $queryRaw: vi.fn(async () => []),
      $executeRaw: vi.fn(async () => 0),
    };
    const prismaObj = prisma;
    return { prisma, orden, ordenHistorialEstado };
  }

  const FILA = {
    numRemision: "R",
    estatusId: idEstado("en_preparacion"),
    destinatario: "A",
    telefonoDest: "0",
    tiendaId: "t",
    zonaId: "z",
    provinciaId: "p",
    cantonId: "c",
    producto: "x",
    peso: null,
  };

  it("(a) el append falla -> la insercion RECHAZA (nada persiste)", async () => {
    const { prisma, ordenHistorialEstado } = build();
    ordenHistorialEstado.createMany.mockRejectedValue(new Error("append boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await expect(
      repo.createManyOrdenes([FILA], 100, HIST_CREACION, loteCtx()),
    ).rejects.toThrow("append boom");
  });

  it("(b) la insercion falla -> el append NUNCA se ejecuta", async () => {
    const { prisma, orden, ordenHistorialEstado } = build();
    orden.createMany.mockRejectedValue(new Error("insert boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await expect(
      repo.createManyOrdenes([FILA], 100, HIST_CREACION, loteCtx()),
    ).rejects.toThrow("insert boom");
    expect(ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("R7 · mecanismo loop-de-updates-en-transaccion (#3)", () => {
  function build() {
    const orden = {
      findMany: vi.fn(async () => [{ id: "o1", estatusId: idEstado("en_preparacion") }]),
      update: vi.fn(async () => ({ numGuia: 1 })),
    };
    const ordenHistorialEstado = { createMany: vi.fn() };
    const prisma = {
      orden,
      ordenHistorialEstado,
      $executeRawUnsafe: vi.fn(),
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaObj)),
    };
    const prismaObj = prisma;
    return { prisma, orden, ordenHistorialEstado };
  }

  it("(a) el append falla -> generarGuiaLote RECHAZA", async () => {
    const { prisma, ordenHistorialEstado } = build();
    ordenHistorialEstado.createMany.mockRejectedValue(new Error("append boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await expect(
      repo.generarGuiaLote(
        // Feature 156: el destino de generar guia es `en_bodega_central`. Antes este caso
        // usaba `por_recoger` (arista #4, retirada del grafo) y la guardia de fallo CERRADO
        // del choke point lo rechazaba antes de llegar al fallo que se quiere probar. El
        // mecanismo bajo prueba —append fallido revierte el lote— es exactamente el mismo.
        [{ ordenId: "o1", estatusId: idEstado("en_bodega_central"), mensajeroAsignadoId: null }],
        HIST_GUIA,
      ),
    ).rejects.toThrow("append boom");
  });

  it("(b) el update de estado falla -> el append NUNCA se ejecuta", async () => {
    const { prisma, orden, ordenHistorialEstado } = build();
    orden.update.mockRejectedValue(new Error("update boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await expect(
      repo.generarGuiaLote(
        // Feature 156: el destino de generar guia es `en_bodega_central`. Antes este caso
        // usaba `por_recoger` (arista #4, retirada del grafo) y la guardia de fallo CERRADO
        // del choke point lo rechazaba antes de llegar al fallo que se quiere probar. El
        // mecanismo bajo prueba —append fallido revierte el lote— es exactamente el mismo.
        [{ ordenId: "o1", estatusId: idEstado("en_bodega_central"), mensajeroAsignadoId: null }],
        HIST_GUIA,
      ),
    ).rejects.toThrow("update boom");
    expect(ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

// --- Mecanismo C: updateMany-envuelto en $transaction (#6/#10) ---
describe("R7 · mecanismo updateMany-envuelto (#6 recibir, #10 liberar)", () => {
  it("(a) recibirEnSatelite: el append falla -> RECHAZA", async () => {
    const ordenHistorialEstado = { createMany: vi.fn().mockRejectedValue(new Error("append boom")) };
    const prisma = {
      orden: {
        findFirst: vi.fn(async () => ({ estatusId: idEstado("en_ruta_bodega_satelite") })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      ordenHistorialEstado,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaObj)),
    };
    const prismaObj = prisma;
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await expect(repo.recibirEnSatelite("o1", "z", idEstado("en_bodega_satelite"), HIST_RECEPCION)).rejects.toThrow(
      "append boom",
    );
  });

  it("(b) liberarOrden: el updateMany falla -> el append NUNCA se ejecuta", async () => {
    const ordenHistorialEstado = { createMany: vi.fn() };
    const prisma = {
      orden: { updateMany: vi.fn().mockRejectedValue(new Error("update boom")) },
      ordenHistorialEstado,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaObj)),
    };
    const prismaObj = prisma;
    const repo = new LiberacionReprogramadaRepository(prisma as unknown as PrismaClient);
    await expect(
      repo.liberarOrden({
        ordenId: "o1",
        destinoEstatusId: idEstado("en_bodega_central"),
        estatusReprogramadaId: idEstado("reprogramada"),
        corridaAt: new Date(),
      }),
    ).rejects.toThrow("update boom");
    expect(ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

// --- Mecanismo D: raw con RETURNING en $transaction (#7 asignarSatelite, #8 recoger) ---
describe("R7 · mecanismo raw-RETURNING (#7 asignarSatelite, #8 recoger)", () => {
  it("(a) asignarSateliteLote: el append falla -> RECHAZA", async () => {
    const ordenHistorialEstado = { createMany: vi.fn().mockRejectedValue(new Error("append boom")) };
    const prisma = {
      $queryRaw: vi.fn(async () => [{ id: "o1" }]),
      ordenHistorialEstado,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaObj)),
    };
    const prismaObj = prisma;
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await expect(
      repo.asignarSateliteLote(
        ["o1"],
        "m",
        "z",
        idEstado("por_recoger"),
        idEstado("en_bodega_satelite"),
        HIST_ASIGNACION,
        // Feature 246 (T3.3): el dia de reparto YA RESUELTO. Este caso mide la atomicidad del
        // append, no el dia; basta con que el parametro exista para que la firma cuadre.
        new Date("2026-08-20T00:00:00.000Z"),
      ),
    ).rejects.toThrow("append boom");
  });

  it("(b) recogerLote: el UPDATE raw falla -> el append NUNCA se ejecuta", async () => {
    const ordenHistorialEstado = { createMany: vi.fn() };
    const tx = {
      $queryRaw: vi.fn(async () => {
        throw new Error("raw boom");
      }),
      ordenHistorialEstado,
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const repo = new GestionOrdenRepository(prisma as never);
    await expect(
      // Feature 261 (B5): 5.º argumento = el dia de Costa Rica en curso, ya resuelto.
      repo.recogerLote(
        ["o1"],
        "m1",
        idEstado("por_recoger"),
        idEstado("en_reparto"),
        new Date("2026-07-20T00:00:00.000Z"),
      ),
    ).rejects.toThrow("raw boom");
    expect(ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});
