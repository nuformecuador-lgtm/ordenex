import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 148 (T16) — proyeccion del manifiesto en el repositorio. Se verifican el
// WHERE (deleted_at / tienda) y el mapeo de la fila; el fake de prisma devuelve la
// forma cruda que produciria `WITH_MANIFIESTO`.

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    orden: { findMany: vi.fn().mockResolvedValue([]) },
    usuario: { findUnique: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

function buildRepo(prisma: ReturnType<typeof buildPrisma>) {
  return new OrdenRepository(prisma as unknown as PrismaClient);
}

// Fila CRUDA tal como la devuelve el `select` de WITH_MANIFIESTO (Decimal + relaciones).
function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    tiendaId: "tienda-1",
    numGuia: 501,
    numRemision: "REM-1",
    destinatario: "Juan Perez",
    telefonoDest: "88880000",
    direccion: "Av. Siempre Viva 742",
    producto: "Camiseta talla M",
    montoCobrar: new Prisma.Decimal("25.50"),
    tienda: { nombre: "Tienda Uno" },
    zona: { nombre: "Cartago", esCentral: false },
    mensajeroAsignado: { nombre: "Carlos Mensajero" },
    ...overrides,
  };
}

describe("R4 — findManifiestoByIds proyecta los datos de la orden para el manifiesto", () => {
  it("proyecta guia, remision, destinatario, telefono y direccion de la orden", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([rawRow()]);

    const rows = await buildRepo(prisma).findManifiestoByIds(["o1"]);

    expect(rows).toEqual([
      {
        id: "o1",
        tiendaId: "tienda-1",
        numGuia: 501,
        numRemision: "REM-1",
        destinatario: "Juan Perez",
        direccion: "Av. Siempre Viva 742",
        telefonoDest: "88880000",
        producto: "Camiseta talla M", // dato propio de la orden (160/R28)
        montoCobrar: 25.5, // R7: Decimal -> number
        tiendaNombre: "Tienda Uno",
        zonaNombre: "Cartago", // R6: NOMBRE, no id
        zonaEsCentral: false,
        mensajeroAsignadoNombre: "Carlos Mensajero", // R9
      },
    ]);
  });

  it("R5/R9: sin guia y sin mensajero asignado -> null, la fila NO se descarta", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      rawRow({ numGuia: null, mensajeroAsignado: null, montoCobrar: null, direccion: null }),
    ]);

    const rows = await buildRepo(prisma).findManifiestoByIds(["o1"]);

    expect(rows).toHaveLength(1);
    expect(rows[0].numGuia).toBeNull();
    expect(rows[0].mensajeroAsignadoNombre).toBeNull();
    expect(rows[0].montoCobrar).toBeNull(); // R7
    expect(rows[0].direccion).toBeNull();
  });

  it("R11: la proyeccion NO pide deleted_at, notas ni geografia", async () => {
    const prisma = buildPrisma();
    await buildRepo(prisma).findManifiestoByIds(["o1"]);

    const select = prisma.orden.findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual(
      [
        "direccion",
        "destinatario",
        "id",
        "mensajeroAsignado",
        "montoCobrar",
        "numGuia",
        "numRemision",
        "producto",
        "telefonoDest",
        "tienda",
        "tiendaId",
        "zona",
      ].sort(),
    );
    for (const prohibido of ["deletedAt", "notas", "provincia", "canton", "distrito"]) {
      expect(select).not.toHaveProperty(prohibido);
    }
  });

  it("no consulta la base con una lista vacia de ids", async () => {
    const prisma = buildPrisma();
    const rows = await buildRepo(prisma).findManifiestoByIds([]);

    expect(rows).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

describe("R12 — las ordenes borradas quedan fuera del manifiesto", () => {
  it("excluye las ordenes borradas (where deleted_at IS NULL) al buscar por ids", async () => {
    const prisma = buildPrisma();
    await buildRepo(prisma).findManifiestoByIds(["o1", "o2"]);

    expect(prisma.orden.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["o1", "o2"] }, deletedAt: null } }),
    );
  });

  it("excluye las ordenes borradas tambien al buscar por num_remision", async () => {
    const prisma = buildPrisma();
    await buildRepo(prisma).findManifiestoByRemisiones(["REM-1"], "tienda-1");

    const where = prisma.orden.findMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.deletedAt).toBeNull();
  });
});

describe("R29 — acotacion por tienda de la via por num_remision", () => {
  it("acota por tienda al buscar por num_remision", async () => {
    const prisma = buildPrisma();
    await buildRepo(prisma).findManifiestoByRemisiones(["REM-1", "REM-2"], "tienda-1");

    expect(prisma.orden.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          numRemision: { in: ["REM-1", "REM-2"] },
          tiendaId: "tienda-1",
          deletedAt: null,
        },
      }),
    );
  });

  it("no consulta la base con una lista vacia de remisiones", async () => {
    const prisma = buildPrisma();
    const rows = await buildRepo(prisma).findManifiestoByRemisiones([], "tienda-1");

    expect(rows).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });

  it("mapea las filas por remision con el mismo serializador", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([rawRow({ numRemision: "REM-9" })]);

    const rows = await buildRepo(prisma).findManifiestoByRemisiones(["REM-9"], "tienda-1");

    expect(rows[0].numRemision).toBe("REM-9");
    expect(rows[0].zonaNombre).toBe("Cartago");
  });
});

describe("R9 — nombre del actor que ejecuto la operacion", () => {
  it("devuelve usuario.nombre por id", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ nombre: "Ana Maestra" });

    const nombre = await buildRepo(prisma).findUsuarioNombre("u-1");

    expect(nombre).toBe("Ana Maestra");
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
      where: { id: "u-1" },
      select: { nombre: true },
    });
  });

  it("null si el usuario no resuelve", async () => {
    const prisma = buildPrisma();
    expect(await buildRepo(prisma).findUsuarioNombre("u-x")).toBeNull();
  });
});
