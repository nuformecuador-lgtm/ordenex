import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 33 — repo de la bodega satelite. Prisma se mockea con dobles simples
// (patron orden-repository.guia.test.ts): sin DB real, se verifica la forma de la
// query (where/select) y el mapeo de filas.
// Feature 49/#6: recibirEnSatelite envuelve el updateMany guardado en `$transaction`
// (pre-lectura del origen + append en la misma tx). El fake `$transaction` pasa el
// propio prisma como `tx`.
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    usuario: {
      findUnique: vi.fn(),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

// Feature 49/#6: contexto de historial (actor = el adminSatelite que recibe por QR).
const HIST_RECEPCION = { actorUsuarioId: "adminsat-1", origenTipo: "recepcion_satelite" } as const;

describe("OrdenRepository.findUsuarioZonaId (R4/R5)", () => {
  it("R4: devuelve la zona del adminSatelite (select zonaId por usuarioId)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ zonaId: "z-limon" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioZonaId("u1")).toBe("z-limon");
    const arg = prisma.usuario.findUnique.mock.calls[0][0];
    expect(arg).toEqual({ where: { id: "u1" }, select: { zonaId: true } });
  });

  it("R5: null si el usuario no tiene zona (zonaId NULL)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ zonaId: null });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioZonaId("u1")).toBeNull();
  });

  it("R5: null si el usuario no resuelve", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioZonaId("nope")).toBeNull();
  });
});

describe("OrdenRepository.findRecepcionSateliteByZona (R6/R8/R9)", () => {
  function ordenRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "o1",
      numGuia: 10,
      numRemision: "R-1",
      destinatario: "Ana",
      telefonoDest: "099",
      direccion: "calle 1",
      producto: "caja",
      montoCobrar: new Prisma.Decimal(25),
      estatus: { value: "en_ruta_bodega_satelite" },
      tienda: { nombre: "Tienda X" },
      zona: { nombre: "Limon" },
      provincia: { nombre: "Prov" },
      canton: { nombre: "Canton" },
      distrito: { nombre: "Distrito" },
      ...overrides,
    };
  }

  it("R6/R8: filtra zona + estatus IN + no borradas; mapea nombres y Decimal->number", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenRow(),
      ordenRow({ id: "o2", estatus: { value: "en_bodega_satelite" }, distrito: null, montoCobrar: null }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findRecepcionSateliteByZona("z-limon", [
      "en_ruta_bodega_satelite",
      "en_bodega_satelite",
    ]);

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      zonaId: "z-limon",
      deletedAt: null, // R6: excluye borradas
      estatus: { value: { in: ["en_ruta_bodega_satelite", "en_bodega_satelite"] } },
    });
    expect(rows[0]).toEqual({
      id: "o1",
      numGuia: 10,
      numRemision: "R-1",
      estatusValue: "en_ruta_bodega_satelite",
      destinatario: "Ana",
      telefonoDest: "099",
      direccion: "calle 1",
      producto: "caja",
      montoCobrar: 25,
      tiendaNombre: "Tienda X",
      zonaNombre: "Limon",
      provinciaNombre: "Prov",
      cantonNombre: "Canton",
      distritoNombre: "Distrito",
    });
    // R9: estatusValue distingue "Recibidas"; distrito/monto nullable resueltos.
    expect(rows[1].estatusValue).toBe("en_bodega_satelite");
    expect(rows[1].distritoNombre).toBeNull();
    expect(rows[1].montoCobrar).toBeNull();
  });

  it("devuelve vacio sin consultar cuando estatusValues esta vacio", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findRecepcionSateliteByZona("z-limon", [])).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.recibirEnSatelite (R11/R18 · feature 49/#6)", () => {
  it("R11/R18: UPDATE guardado por id+zona+deletedAt+origen; true si afecto 1 fila", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: "os-ruta" });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const ok = await repo.recibirEnSatelite("o1", "z-limon", "os-recibida", HIST_RECEPCION);

    expect(ok).toBe(true);
    const arg = prisma.orden.updateMany.mock.calls[0][0];
    // Guardia por estado de origen + zona + no borrada en la propia escritura.
    expect(arg.where).toEqual({
      id: "o1",
      zonaId: "z-limon",
      deletedAt: null,
      estatus: { value: "en_ruta_bodega_satelite" },
    });
    // R11: solo fija estatusId; NO toca mensajeroAsignadoId ni numGuia.
    expect(arg.data).toEqual({ estatusId: "os-recibida" });
    expect(arg.data).not.toHaveProperty("mensajeroAsignadoId");
    expect(arg.data).not.toHaveProperty("numGuia");
  });

  // Feature 49/#6 (R14/R7): al recibir, 1 historial (origen en_ruta -> en_bodega_satelite).
  it("R14: recepcion deja 1 historial con origen pre-leido y tipo recepcion_satelite", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: "os-ruta" });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.recibirEnSatelite("o1", "z-limon", "os-recibida", HIST_RECEPCION);

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-ruta",
        estatusDestinoId: "os-recibida",
        actorUsuarioId: "adminsat-1",
        origenTipo: "recepcion_satelite",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("R18/R8: false si el UPDATE no afecto filas (race); NO deja rastro", async () => {
    const prisma = buildPrisma();
    // Perdio la carrera: la pre-lectura ya no encuentra la orden en el origen (o cambio).
    prisma.orden.findFirst.mockResolvedValue(null);
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.recibirEnSatelite("o1", "z-limon", "os-recibida", HIST_RECEPCION)).toBe(false);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});
