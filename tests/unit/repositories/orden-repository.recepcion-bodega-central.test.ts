import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 138 + 139 (STATE-AWARE) — repo de la recepcion en la BODEGA CENTRAL. Prisma se mockea con
// dobles simples (patron orden-repository.recepcion-satelite.test.ts): sin DB real, se verifica la
// forma de la query (where/data) y la atomicidad del append. Espejo de `recibirEnSatelite` SIN la
// guarda de zona/tienda: la UNICA guarda es el estado de ORIGEN (`origenValue`, pasado por el service)
// + no borrada (R11). El par ORIGEN->DESTINO lo resuelve el service; el repo solo guarda por el origen
// recibido y persiste el destino recibido. Feature 49/#21: envuelve el updateMany guardado en
// `$transaction` (pre-lectura del origen + append en la misma tx). El fake `$transaction` pasa el
// propio prisma como `tx`.
beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia es de fallo CERRADO
});

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

// Contexto de historial: actor = el maestro/admin que recibe por QR; tipo `recepcion_bodega_central`
// (ambos casos: 138 y 139).
const HIST_RECEPCION = {
  actorUsuarioId: "u-maestro",
  origenTipo: "recepcion_bodega_central",
} as const;

describe("OrdenRepository.recibirEnBodegaCentral (R2/R3/R9/R18 · STATE-AWARE 138+139)", () => {
  // --- Caso 138: en_ruta_bodega_central -> en_bodega_central ---

  it("R2/R11/R18 (138): UPDATE guardado por id+deletedAt+origen (SIN zona/tienda); true si afecto 1 fila", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: idEstado("en_ruta_bodega_central") });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const ok = await repo.recibirEnBodegaCentral(
      "o1",
      "en_ruta_bodega_central",
      idEstado("en_bodega_central"),
      HIST_RECEPCION,
    );

    expect(ok).toBe(true);
    const arg = prisma.orden.updateMany.mock.calls[0][0];
    // R11: guarda SOLO por estado de origen (el recibido) + no borrada. SIN zonaId ni tiendaId.
    expect(arg.where).toEqual({
      id: "o1",
      deletedAt: null,
      estatus: { value: "en_ruta_bodega_central" },
    });
    expect(arg.where).not.toHaveProperty("zonaId");
    expect(arg.where).not.toHaveProperty("tiendaId");
    // R18: solo fija estatusId; NO toca mensajeroAsignadoId ni numGuia.
    expect(arg.data).toEqual({ estatusId: idEstado("en_bodega_central") });
    expect(arg.data).not.toHaveProperty("mensajeroAsignadoId");
    expect(arg.data).not.toHaveProperty("numGuia");
  });

  it("R11 (138): la pre-lectura del origen tampoco acota por zona/tienda", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: idEstado("en_ruta_bodega_central") });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.recibirEnBodegaCentral(
      "o1",
      "en_ruta_bodega_central",
      idEstado("en_bodega_central"),
      HIST_RECEPCION,
    );

    const arg = prisma.orden.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({
      id: "o1",
      deletedAt: null,
      estatus: { value: "en_ruta_bodega_central" },
    });
    expect(arg.where).not.toHaveProperty("zonaId");
    expect(arg.where).not.toHaveProperty("tiendaId");
  });

  it("R3/R17 (138): recepcion deja 1 historial con origen pre-leido y tipo recepcion_bodega_central", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: idEstado("en_ruta_bodega_central") });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.recibirEnBodegaCentral(
      "o1",
      "en_ruta_bodega_central",
      idEstado("en_bodega_central"),
      HIST_RECEPCION,
    );

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_ruta_bodega_central"),
        estatusDestinoId: idEstado("en_bodega_central"),
        actorUsuarioId: "u-maestro",
        origenTipo: "recepcion_bodega_central",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  // --- Caso 139: devolviendo_a_bodega_central -> por_devolver_a_tienda ---

  it("R17 (139): guarda por el origen `devolviendo_a_bodega_central` y persiste `por_devolver_a_tienda`", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: idEstado("devolviendo_a_bodega_central") });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const ok = await repo.recibirEnBodegaCentral(
      "o9",
      "devolviendo_a_bodega_central",
      idEstado("por_devolver_a_tienda"),
      HIST_RECEPCION,
    );

    expect(ok).toBe(true);
    // El repo guarda por el origen RECIBIDO (139), no por el hardcode 138.
    expect(prisma.orden.updateMany.mock.calls[0][0].where).toEqual({
      id: "o9",
      deletedAt: null,
      estatus: { value: "devolviendo_a_bodega_central" },
    });
    expect(prisma.orden.updateMany.mock.calls[0][0].data).toEqual({
      estatusId: idEstado("por_devolver_a_tienda"),
    });
    // El historial usa el origen pre-leido y el mismo tipo `recepcion_bodega_central`.
    expect(prisma.ordenHistorialEstado.createMany.mock.calls[0][0].data).toEqual([
      {
        ordenId: "o9",
        estatusOrigenId: idEstado("devolviendo_a_bodega_central"),
        estatusDestinoId: idEstado("por_devolver_a_tienda"),
        actorUsuarioId: "u-maestro",
        origenTipo: "recepcion_bodega_central",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  // --- Comun ---

  it("R9/R3: false si el UPDATE no afecto filas (race); NO deja rastro", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue(null);
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(
      await repo.recibirEnBodegaCentral(
        "o1",
        "en_ruta_bodega_central",
        idEstado("en_bodega_central"),
        HIST_RECEPCION,
      ),
    ).toBe(false);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R3: envuelve el updateMany + append en UNA transaccion (atomicidad)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: idEstado("en_ruta_bodega_central") });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.recibirEnBodegaCentral(
      "o1",
      "en_ruta_bodega_central",
      idEstado("en_bodega_central"),
      HIST_RECEPCION,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
