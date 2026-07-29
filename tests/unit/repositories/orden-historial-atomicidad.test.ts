import { describe, it, expect, vi, beforeEach } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

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

// --- Mecanismo A: create dentro de $transaction (#2) ---
describe("R7 · mecanismo create-en-transaccion (#2)", () => {
  function build() {
    const orden = { create: vi.fn(async () => ({ id: "o1", estatusId: idEstado("en_preparacion"), peso: null })) };
    const ordenHistorialEstado = { createMany: vi.fn() };
    const prisma = {
      orden,
      ordenHistorialEstado,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaObj)),
    };
    const prismaObj = prisma;
    return { prisma, orden, ordenHistorialEstado };
  }

  it("(a) el append falla -> create RECHAZA (nada persiste)", async () => {
    const { prisma, ordenHistorialEstado } = build();
    ordenHistorialEstado.createMany.mockRejectedValue(new Error("append boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await expect(
      repo.create(
        {
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
        },
        HIST_CREACION,
      ),
    ).rejects.toThrow("append boom");
  });

  it("(b) el create falla -> el append NUNCA se ejecuta", async () => {
    const { prisma, orden, ordenHistorialEstado } = build();
    orden.create.mockRejectedValue(new Error("create boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await expect(
      repo.create(
        {
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
        },
        HIST_CREACION,
      ),
    ).rejects.toThrow("create boom");
    expect(ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

// --- Mecanismo B: loop de updates dentro de $transaction (#3/#5) ---
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
        [{ ordenId: "o1", estatusId: idEstado("por_recoger"), mensajeroAsignadoId: null }],
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
        [{ ordenId: "o1", estatusId: idEstado("por_recoger"), mensajeroAsignadoId: null }],
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
      repo.asignarSateliteLote(["o1"], "m", "z", idEstado("por_recoger"), idEstado("en_bodega_satelite"), HIST_ASIGNACION),
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
    await expect(repo.recogerLote(["o1"], "m1", idEstado("por_recoger"), idEstado("en_reparto"))).rejects.toThrow(
      "raw boom",
    );
    expect(ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});
