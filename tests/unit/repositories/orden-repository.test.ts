import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { NumRemisionDuplicadoError } from "@/lib/interfaces/repositories/IOrdenRepository";

function ordenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ord-1",
    numGuia: 1,
    numRemision: "REM-1",
    estatusId: "os-bodega",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: new Prisma.Decimal("1.500"),
    notas: null,
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    estatus: { value: "en_bodega" },
    mensajeroSugeridoId: null,
    mensajeroAsignadoId: null,
    ...overrides,
  };
}

// R25/R26: fila del LISTADO, que ademas del estatus trae la relacion tienda con
// su nombre legible (Usuario.nombre). create/findById/update NO requieren tienda.
function ordenListRow(overrides: Record<string, unknown> = {}) {
  return {
    ...ordenRow(),
    tienda: { nombre: "Tienda Uno" },
    // Feature 30/R14: el listado incluye la zona (nombre + flag GAM).
    zona: { nombre: "GAM", esGam: true },
    ...overrides,
  };
}

function baseCreateData() {
  return {
    numRemision: "REM-1",
    estatusId: "os-bodega",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    producto: "Caja",
    peso: 1.5,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    orden: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    orderStatus: { findUnique: vi.fn() },
    zona: { findUnique: vi.fn() },
    provincia: { findUnique: vi.fn() },
    canton: { findUnique: vi.fn() },
    distrito: { findUnique: vi.fn() },
    usuario: { findUnique: vi.fn() },
    ...overrides,
  };
}

describe("OrdenRepository.create", () => {
  it("serializa peso Decimal a number y arma OrdenDTO sin deletedAt", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create(baseCreateData());

    expect(dto.peso).toBe(1.5);
    expect(dto.estatusValue).toBe("en_bodega");
    expect(dto).not.toHaveProperty("deletedAt");
  });

  // Feature 17/R2/R8: num_guia se asigna en "Generar guia" (nunca al insertar) y
  // mensajero_asignado_id nace NULL (es un acto posterior del maestro).
  it("no envia num_guia ni mensajero_asignado_id al crear (R2/R8)", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow({ numGuia: null }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.create(baseCreateData());

    const arg = prisma.orden.create.mock.calls[0][0];
    expect(arg.data).not.toHaveProperty("numGuia");
    expect(arg.data).not.toHaveProperty("mensajeroAsignadoId");
  });

  // Feature 17/R30: numGuia NULL se serializa como null (sin romper el DTO).
  it("serializa numGuia NULL como null (R30)", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow({ numGuia: null }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create(baseCreateData());

    expect(dto.numGuia).toBeNull();
  });

  it("traduce P2002 de num_remision a NumRemisionDuplicadoError (R14/R28)", async () => {
    const prisma = buildPrisma();
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "7.8.0",
      meta: { target: ["num_remision"] },
    });
    prisma.orden.create.mockRejectedValue(p2002);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(repo.create(baseCreateData())).rejects.toBeInstanceOf(
      NumRemisionDuplicadoError,
    );
  });
});

describe("OrdenRepository.findById (R34)", () => {
  it("filtra deleted_at IS NULL en el where", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue(ordenRow());
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findById("ord-1");

    const arg = prisma.orden.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "ord-1", deletedAt: null });
  });

  it("devuelve null cuando no hay fila (borrada o inexistente)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findById("x")).toBeNull();
  });
});

describe("OrdenRepository.list (R30/R31/R34)", () => {
  it("devuelve items y total, excluye borradas y mapea el orden de lista blanca", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow(),
      ordenListRow({ id: "ord-2" }),
    ]);
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: { estatusId: "os-bodega" },
      sortBy: "num_guia",
      sortDir: "asc",
      skip: 0,
      take: 20,
    });

    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null, estatusId: "os-bodega" });
    expect(arg.orderBy).toEqual({ numGuia: "asc" }); // R31: columna mapeada
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(20);

    const countArg = prisma.orden.count.mock.calls[0][0];
    expect(countArg.where).toMatchObject({ deletedAt: null });
  });

  it("R25/R26: incluye tienda.nombre en el select y mapea tiendaNombre por item", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow(),
      ordenListRow({ id: "ord-2", tienda: { nombre: "Tienda Dos" } }),
    ]);
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].tiendaNombre).toBe("Tienda Uno");
    expect(res.items[1].tiendaNombre).toBe("Tienda Dos");

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.include).toMatchObject({ tienda: { select: { nombre: true } } });
    // R25: el listado sigue trayendo el value del estatus.
    expect(arg.include).toMatchObject({ estatus: { select: { value: true } } });
  });

  // Feature 17/R20: el modal "Generar guia" agrupa por mensajero sugerido y las
  // secciones en_espera_aceptacion/en_bodega muestran el mensajero asignado.
  it("R20: mapea mensajeroSugeridoId y mensajeroAsignadoId en el DTO del listado", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({ id: "ord-con", mensajeroSugeridoId: "msj-1", mensajeroAsignadoId: "msj-2" }),
      ordenListRow({ id: "ord-sin", mensajeroSugeridoId: null, mensajeroAsignadoId: null }),
    ]);
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].mensajeroSugeridoId).toBe("msj-1");
    expect(res.items[0].mensajeroAsignadoId).toBe("msj-2");
    expect(res.items[1].mensajeroSugeridoId).toBeNull();
    expect(res.items[1].mensajeroAsignadoId).toBeNull();
  });

  // Feature 30/R14/R19: el listado suma zonaNombre/zonaEsGam (columna de zona),
  // sin romper el contrato del listado (tiendaNombre/mensajero* siguen presentes).
  it("R14: incluye zona.{nombre,esGam} en el select y mapea zonaNombre/zonaEsGam por item", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow(),
      ordenListRow({ id: "ord-2", zona: { nombre: "Limón", esGam: false } }),
    ]);
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].zonaNombre).toBe("GAM");
    expect(res.items[0].zonaEsGam).toBe(true);
    expect(res.items[1].zonaNombre).toBe("Limón");
    expect(res.items[1].zonaEsGam).toBe(false);
    // R19: no rompe los campos previos del listado.
    expect(res.items[0].tiendaNombre).toBe("Tienda Uno");

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.include).toMatchObject({ zona: { select: { nombre: true, esGam: true } } });
  });

  it("inyecta tiendaId en el where cuando se pasa (alcance adminTienda)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.list({
      where: { tiendaId: "t1" },
      sortBy: "created_at",
      sortDir: "desc",
      skip: 10,
      take: 5,
    });

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null, tiendaId: "t1" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });
});

describe("OrdenRepository.softDelete (R39/R40)", () => {
  it("fija deleted_at solo si la orden no estaba borrada", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.softDelete("ord-1")).toBe(true);
    const arg = prisma.orden.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "ord-1", deletedAt: null });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });

  it("devuelve false si no habia fila que borrar (R40)", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.softDelete("x")).toBe(false);
  });
});

describe("OrdenRepository.update (R36/R37)", () => {
  it("aplica cambios solo sobre no borradas y devuelve el DTO", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    prisma.orden.findFirst.mockResolvedValue(ordenRow({ estatusId: "os-entregada" }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const dto = await repo.update("ord-1", { estatusId: "os-entregada" });

    const arg = prisma.orden.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "ord-1", deletedAt: null });
    expect(dto?.estatusId).toBe("os-entregada");
  });

  it("devuelve null si no existe o esta borrada (R36)", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.update("x", { producto: "Otro" })).toBeNull();
  });
});

describe("OrdenRepository.existsGeo / existsEstatus / findEstatusIdByValue", () => {
  it("existsGeo marca distrito=true cuando no se consulta (opcional)", async () => {
    const prisma = buildPrisma();
    prisma.zona.findUnique.mockResolvedValue({ id: "z1" });
    prisma.provincia.findUnique.mockResolvedValue({ id: "p1" });
    prisma.canton.findUnique.mockResolvedValue({ id: "c1" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const geo = await repo.existsGeo({ zonaId: "z1", provinciaId: "p1", cantonId: "c1" });
    expect(geo).toEqual({ zona: true, provincia: true, canton: true, distrito: true });
    expect(prisma.distrito.findUnique).not.toHaveBeenCalled();
  });

  it("existsGeo detecta geografia inexistente", async () => {
    const prisma = buildPrisma();
    prisma.zona.findUnique.mockResolvedValue(null);
    prisma.provincia.findUnique.mockResolvedValue({ id: "p1" });
    prisma.canton.findUnique.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const geo = await repo.existsGeo({ zonaId: "z9", provinciaId: "p1", cantonId: "c9" });
    expect(geo.zona).toBe(false);
    expect(geo.canton).toBe(false);
    expect(geo.provincia).toBe(true);
  });

  it("findEstatusIdByValue resuelve el id por value", async () => {
    const prisma = buildPrisma();
    prisma.orderStatus.findUnique.mockResolvedValue({ id: "os-bodega", value: "en_bodega" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findEstatusIdByValue("en_bodega")).toBe("os-bodega");
  });

  it("existsEstatus devuelve false cuando no existe", async () => {
    const prisma = buildPrisma();
    prisma.orderStatus.findUnique.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.existsEstatus("os-x")).toBe(false);
  });
});

describe("OrdenRepository.findUsuarioFulfillment (feature 27/R15/R16/R17)", () => {
  it("devuelve el flag fulfillment de la tienda que carga", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ fulfillment: true });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioFulfillment("store-1")).toBe(true);
    const arg = prisma.usuario.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "store-1" });
    expect(arg.select).toEqual({ fulfillment: true }); // R14: nunca passwordHash
  });

  it("devuelve false cuando el flag es false (R17)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ fulfillment: false });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioFulfillment("store-1")).toBe(false);
  });

  it("default false cuando el usuario no resuelve", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioFulfillment("desconocido")).toBe(false);
  });
});
