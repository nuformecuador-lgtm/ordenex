import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GeoRepository } from "@/lib/repositories/GeoRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";

// Feature 144/B2 (R48/R49/R50/R54) — proyecciones planas del catalogo de filtros.
//
// Prisma mockeado: se afirma el `select`/`where`/`orderBy` emitido (que es donde vive el
// contrato de "campos minimos" y "orden determinista") y la forma de la fila devuelta.

describe("GeoRepository — la geografia de UNA zona", () => {
  // Pedido humano (2026-08-19): el adminSatelite filtra por provincia/canton/distrito, pero
  // solo por los de SU zona. La asociacion se lee de la N:M `zona_distrito` (feature 24),
  // unica fuente de verdad desde que `distrito.zona_id` se elimino.
  function prismaConDistritos(rows: unknown[]) {
    return {
      provincia: { findMany: vi.fn() },
      canton: { findMany: vi.fn() },
      distrito: { findMany: vi.fn().mockResolvedValue(rows) },
    };
  }

  /** Una fila de distrito tal como la devuelve el `select` anidado. */
  function fila(
    id: string,
    nombre: string,
    canton: { id: string; nombre: string },
    provincia: { id: string; nombre: string },
  ) {
    return {
      id,
      nombre,
      cantonId: canton.id,
      canton: { ...canton, provinciaId: provincia.id, provincia },
    };
  }

  const LIMON = { id: "p9", nombre: "Limon" };
  const POCOCI = { id: "c9", nombre: "Pococi" };
  const GUACIMO = { id: "c8", nombre: "Guacimo" };

  it("filtra por la N:M y DERIVA cantones y provincias de los distritos de la zona", async () => {
    const prisma = prismaConDistritos([
      fila("d2", "Guapiles", POCOCI, LIMON),
      fila("d1", "Cariari", POCOCI, LIMON),
      fila("d3", "Rio Jimenez", GUACIMO, LIMON),
    ]);
    const repo = new GeoRepository(prisma as unknown as PrismaClient);

    const r = await repo.listGeografiaLitePorZona("z-1");

    // La zona entra por la puente, no por una columna del distrito (que ya no existe).
    const args = prisma.distrito.findMany.mock.calls[0]![0] as {
      where: unknown;
      orderBy: unknown;
    };
    expect(args.where).toEqual({ zonas: { some: { zonaId: "z-1" } } });
    expect(args.orderBy).toEqual({ nombre: "asc" });

    // Los otros dos niveles NO se consultan aparte: «los cantones de la zona» son
    // exactamente los de sus distritos, y dos consultas mas podrian dar otro conjunto.
    expect(prisma.canton.findMany).not.toHaveBeenCalled();
    expect(prisma.provincia.findMany).not.toHaveBeenCalled();

    expect(r.provincias).toEqual([{ id: "p9", nombre: "Limon" }]);
    // Deduplicado (Pococi aparece en dos distritos) y en orden alfabetico.
    expect(r.cantones).toEqual([
      { id: "c8", nombre: "Guacimo", padreId: "p9" },
      { id: "c9", nombre: "Pococi", padreId: "p9" },
    ]);
    expect(r.distritos).toEqual([
      { id: "d1", nombre: "Cariari", padreId: "c9" },
      { id: "d2", nombre: "Guapiles", padreId: "c9" },
      { id: "d3", nombre: "Rio Jimenez", padreId: "c8" },
    ]);
  });

  it("zona sin distritos asociados -> las tres listas vacias, no un error", async () => {
    const prisma = prismaConDistritos([]);
    const repo = new GeoRepository(prisma as unknown as PrismaClient);

    expect(await repo.listGeografiaLitePorZona("z-vacia")).toEqual({
      provincias: [],
      cantones: [],
      distritos: [],
    });
  });
});

describe("GeoRepository — catalogo plano (R48/R49)", () => {
  function buildPrisma() {
    return {
      provincia: { findMany: vi.fn().mockResolvedValue([]) },
      canton: { findMany: vi.fn().mockResolvedValue([]) },
      distrito: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }

  it("R49: las provincias se piden `{id,nombre}` ordenadas por nombre asc", async () => {
    const prisma = buildPrisma();
    prisma.provincia.findMany.mockResolvedValue([
      { id: "p1", nombre: "Alajuela" },
      { id: "p2", nombre: "San Jose" },
    ]);
    const repo = new GeoRepository(prisma as unknown as PrismaClient);

    const r = await repo.listProvinciasLite();

    expect(prisma.provincia.findMany).toHaveBeenCalledWith({
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
    expect(r).toEqual([
      { id: "p1", nombre: "Alajuela" },
      { id: "p2", nombre: "San Jose" },
    ]);
  });

  it("R48: cada canton trae su PADRE (provincia) como `padreId`", async () => {
    const prisma = buildPrisma();
    prisma.canton.findMany.mockResolvedValue([
      { id: "c1", nombre: "Central", provinciaId: "p1" },
      { id: "c2", nombre: "Escazu", provinciaId: "p1" },
    ]);
    const repo = new GeoRepository(prisma as unknown as PrismaClient);

    const r = await repo.listCantonesLite();

    expect(prisma.canton.findMany).toHaveBeenCalledWith({
      select: { id: true, nombre: true, provinciaId: true },
      orderBy: { nombre: "asc" },
    });
    expect(r).toEqual([
      { id: "c1", nombre: "Central", padreId: "p1" },
      { id: "c2", nombre: "Escazu", padreId: "p1" },
    ]);
  });

  it("R48: cada distrito trae su PADRE (canton) como `padreId`, sin la zona", async () => {
    const prisma = buildPrisma();
    prisma.distrito.findMany.mockResolvedValue([
      { id: "d1", nombre: "Carmen", cantonId: "c1" },
    ]);
    const repo = new GeoRepository(prisma as unknown as PrismaClient);

    const r = await repo.listDistritosLite();

    // Sin `zonas`: la zona de la ORDEN esta congelada en `orden.zona_id`.
    expect(prisma.distrito.findMany).toHaveBeenCalledWith({
      select: { id: true, nombre: true, cantonId: true },
      orderBy: { nombre: "asc" },
    });
    expect(r).toEqual([{ id: "d1", nombre: "Carmen", padreId: "c1" }]);
    expect(Object.keys(r[0]).sort()).toEqual(["id", "nombre", "padreId"]);
  });

  it("R49: la misma entrada produce el mismo orden (determinista)", async () => {
    const prisma = buildPrisma();
    const filas = [
      { id: "c1", nombre: "Alajuelita", provinciaId: "p1" },
      { id: "c2", nombre: "Belen", provinciaId: "p2" },
    ];
    prisma.canton.findMany.mockResolvedValue(filas);
    const repo = new GeoRepository(prisma as unknown as PrismaClient);
    expect(await repo.listCantonesLite()).toEqual(await repo.listCantonesLite());
  });
});

describe("ZonaRepository.listLite (R48/R49)", () => {
  it("R48/R49: `{id,nombre}` de TODAS las zonas, por nombre asc", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "z1", nombre: "GAM" },
      { id: "z2", nombre: "Zona Norte" },
    ]);
    const repo = new ZonaRepository({ zona: { findMany } } as unknown as PrismaClient);

    const r = await repo.listLite();

    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
    expect(r).toEqual([
      { id: "z1", nombre: "GAM" },
      { id: "z2", nombre: "Zona Norte" },
    ]);
  });
});

describe("UserRepository.listCuentasTienda (R50/R54/R49)", () => {
  function buildRepo(rows: unknown[]) {
    const findMany = vi.fn().mockResolvedValue(rows);
    const repo = new UserRepository({ usuario: { findMany } } as unknown as PrismaClient);
    return { repo, findMany };
  }

  const FILAS = [
    { id: "t1", nombre: "Tienda Activa", estado: "activo", rol: { value: "adminTienda" } },
    { id: "t2", nombre: "Tienda Inactiva", estado: "inactivo", rol: { value: "adminTienda" } },
    { id: "k1", nombre: "Integracion X", estado: "activo", rol: { value: "apiKey" } },
    { id: "k2", nombre: "Integracion Vieja", estado: "inactivo", rol: { value: "apiKey" } },
  ];

  it("R50: consulta los DOS roles dueños posibles (`adminTienda` y `apiKey`)", async () => {
    const { repo, findMany } = buildRepo(FILAS);
    await repo.listCuentasTienda();
    expect(findMany.mock.calls[0][0].where).toEqual({
      rol: { value: { in: ["adminTienda", "apiKey"] } },
    });
  });

  it("R50: NO filtra por `estado` — las cuentas inactivas se incluyen", async () => {
    const { repo, findMany } = buildRepo(FILAS);
    const r = await repo.listCuentasTienda();
    expect(findMany.mock.calls[0][0].where.estado).toBeUndefined();
    expect(r.map((c) => c.id)).toEqual(["t1", "t2", "k1", "k2"]);
    expect(r.find((c) => c.id === "t2")?.activa).toBe(false);
  });

  it("R50/R51: expone las DOS banderas (`esApiKey`, `activa`) por cuenta", async () => {
    const { repo } = buildRepo(FILAS);
    const r = await repo.listCuentasTienda();
    expect(r).toEqual([
      { id: "t1", nombre: "Tienda Activa", esApiKey: false, activa: true },
      { id: "t2", nombre: "Tienda Inactiva", esApiKey: false, activa: false },
      { id: "k1", nombre: "Integracion X", esApiKey: true, activa: true },
      { id: "k2", nombre: "Integracion Vieja", esApiKey: true, activa: false },
    ]);
  });

  it("R54: no pide ni devuelve PII (email/telefono/cedula/hash)", async () => {
    const { repo, findMany } = buildRepo(FILAS);
    const r = await repo.listCuentasTienda();
    const select = findMany.mock.calls[0][0].select;
    expect(select).toEqual({
      id: true,
      nombre: true,
      estado: true,
      rol: { select: { value: true } },
    });
    for (const campo of ["email", "telefono", "cedula", "passwordHash"]) {
      expect(select[campo]).toBeUndefined();
      expect(Object.keys(r[0])).not.toContain(campo);
    }
    expect(Object.keys(r[0]).sort()).toEqual(["activa", "esApiKey", "id", "nombre"]);
  });

  it("R49: orden determinista por nombre asc", async () => {
    const { repo, findMany } = buildRepo(FILAS);
    await repo.listCuentasTienda();
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ nombre: "asc" });
  });
});
