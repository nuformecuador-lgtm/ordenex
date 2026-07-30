import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 16 / 159 R22(d) — cobertura de `findResumenByNumRemisiones`: el resumen
// del lote recien cargado, ACOTADO a la tienda del actor y SIN campos internos.
//
// Procedencia: estos 5 `describe` vivian en `orden-repository.asignacion.test.ts`,
// que la feature 159 borro entero. El archivo tambien cubria
// `asignarMensajeroSugerido` y `countOrdenesDeTienda` —metodos que SI se
// retiraron—, asi que se recupera solo esta parte y el archivo cambia de nombre:
// su asunto ya no es la asignacion, es el resumen (design.md §7).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    orden: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    orderStatus: { findUnique: vi.fn() },
    zona: { findUnique: vi.fn() },
    provincia: { findUnique: vi.fn(), findMany: vi.fn() },
    canton: { findUnique: vi.fn(), findMany: vi.fn() },
    distrito: { findUnique: vi.fn(), findMany: vi.fn() },
    usuario: { findMany: vi.fn() },
    ...overrides,
  };
}

/** Fila cruda tal como la devuelve Prisma con la proyeccion `WITH_RESUMEN`. */
function resumenRow(over: Record<string, unknown> = {}) {
  return {
    id: "ord-1",
    numGuia: 1,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    montoCobrar: null,
    direccion: null,
    zonaId: "z1",
    estatus: { value: "en_preparacion" },
    zona: { nombre: "Norte" },
    ...over,
  };
}

describe("OrdenRepository.findResumenByNumRemisiones (R6, R8, R9, R10)", () => {
  it("filtra por numRemision in, tiendaId y deletedAt:null", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findResumenByNumRemisiones(["REM-1", "REM-2"], "tienda-1");

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      numRemision: { in: ["REM-1", "REM-2"] },
      tiendaId: "tienda-1",
      deletedAt: null,
    });
  });

  it("mapea montoCobrar Decimal -> number, y null se preserva null", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      resumenRow({
        montoCobrar: new Prisma.Decimal("12.50"),
        direccion: "Av. Siempre Viva",
      }),
      resumenRow({
        id: "ord-2",
        numGuia: 2,
        numRemision: "REM-2",
        destinatario: "Carla",
        telefonoDest: "0987654321",
        producto: "Sobre",
        zonaId: "z2",
        zona: { nombre: "Sur" },
      }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findResumenByNumRemisiones(["REM-1", "REM-2"], "tienda-1");

    expect(rows[0].montoCobrar).toBe(12.5);
    expect(rows[0].direccion).toBe("Av. Siempre Viva");
    expect(rows[0].zonaId).toBe("z1");
    expect(rows[0].zonaNombre).toBe("Norte");
    expect(rows[0].estatusValue).toBe("en_preparacion");
    expect(rows[1].montoCobrar).toBeNull();
    expect(rows[1].direccion).toBeNull();
    expect(rows[1].zonaNombre).toBe("Sur");
  });

  it("no expone deletedAt ni otros campos internos en la salida", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([resumenRow()]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findResumenByNumRemisiones(["REM-1"], "tienda-1");

    expect(rows[0]).not.toHaveProperty("deletedAt");
    expect(rows[0]).not.toHaveProperty("passwordHash");
    expect(rows[0]).not.toHaveProperty("tiendaId");
  });

  it("R12/R13 (159): ni el select ni la salida traen dato alguno de mensajero", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([resumenRow()]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findResumenByNumRemisiones(["REM-1"], "tienda-1");

    // El resumen es SOLO LECTURA de la orden creada: no pide ni devuelve mensajero
    // (ni el asignado ni el retirado "sugerido"). Reintroducir el campo en la
    // proyeccion rompe este assert.
    const select = prisma.orden.findMany.mock.calls[0][0].select as Record<string, unknown>;
    const clavesDeMensajero = Object.keys(select).filter((k) => /mensajero/i.test(k));
    expect(clavesDeMensajero).toEqual([]);
    const clavesDeSalida = Object.keys(rows[0]).filter((k) => /mensajero/i.test(k));
    expect(clavesDeSalida).toEqual([]);
  });

  it("preserva la unicidad de num_remision: una fila por remision distinta", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      resumenRow(),
      resumenRow({ id: "ord-2", numRemision: "REM-2", zonaId: "z2", zona: { nombre: "Sur" } }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findResumenByNumRemisiones(["REM-1", "REM-2"], "tienda-1");

    const nums = rows.map((r) => r.numRemision);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it("devuelve [] sin consultar cuando nums esta vacio", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findResumenByNumRemisiones([], "tienda-1");

    expect(rows).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});
