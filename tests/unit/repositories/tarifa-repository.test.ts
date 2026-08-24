import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { TarifaRepository } from "@/lib/repositories/TarifaRepository";
import type { CreateTarifaData } from "@/lib/interfaces/repositories/ITarifaRepository";
import { ROLES_TARIFABLES } from "@/lib/types/tarifa";

function tarifaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cob-1",
    tiendaId: "tienda-1",
    status: "activo",
    valorFlete: new Prisma.Decimal("10.00"),
    valorFleteDevuelto: new Prisma.Decimal("5.00"),
    valorFleteGam: new Prisma.Decimal("8.00"),
    valorFleteDevueltoGam: new Prisma.Decimal("4.00"),
    fulfillment: new Prisma.Decimal("3.00"),
    comisionCod: new Prisma.Decimal("2.50"),
    ivaFlete: new Prisma.Decimal("15.00"),
    ivaComisionCod: new Prisma.Decimal("15.00"),
    tarifaEspecial: null,
    zonaId: null,
    isDefault: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function baseCreateData(): CreateTarifaData {
  return {
    tiendaId: "tienda-1",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    tarifa: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    usuario: {
      findFirst: vi.fn(),
    },
    ...overrides,
  };
}

describe("TarifaRepository.create (R16/R27)", () => {
  it("convierte numbers a Prisma.Decimal y serializa la respuesta a TarifaDTO", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.create.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create(baseCreateData());

    const arg = prisma.tarifa.create.mock.calls[0][0];
    expect(arg.data.valorFlete).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data.valorFlete.toString()).toBe("10");
    expect(arg.data.tiendaId).toBe("tienda-1"); // FK obligatoria a usuario (adminTienda)
    // `status` no viaja en create: nace `activo` por default de DB.
    expect(arg.data).not.toHaveProperty("status");

    expect(dto.tiendaId).toBe("tienda-1");
    expect(dto.status).toBe("activo");
    expect(dto.valorFlete).toBe(10);
    expect(dto.ivaComisionCod).toBe(15);
    expect(dto).not.toHaveProperty("deletedAt");
  });
});

describe("TarifaRepository.findById", () => {
  // La tabla borra en FISICO: no queda `deleted_at` que filtrar, y el test lo afirma
  // con `toEqual` para que reintroducir el filtro se vea aqui y no pase de largo.
  it("busca por id y NO filtra por deletedAt", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await repo.findById("cob-1");

    const arg = prisma.tarifa.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "cob-1" });
  });

  it("devuelve null cuando no hay fila", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(null);
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.findById("x")).toBeNull();
  });
});

describe("TarifaRepository.list (R18/R27)", () => {
  it("devuelve items/total, orderBy created_at desc y skip/take, sin filtro de borrados", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([tarifaRow(), tarifaRow({ id: "cob-2" })]);
    prisma.tarifa.count.mockResolvedValue(2);
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({ skip: 0, take: 20 });

    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);
    expect(res.items[0].tiendaId).toBe("tienda-1");
    expect(res.items[0].status).toBe("activo");
    expect(res.items[0]).not.toHaveProperty("deletedAt");

    const arg = prisma.tarifa.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({});
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(20);

    // `count` y `findMany` DEBEN compartir el where, o `total` no casa con `items`.
    const countArg = prisma.tarifa.count.mock.calls[0][0];
    expect(countArg.where).toEqual(arg.where);
  });
});

describe("TarifaRepository.update (R21/R22)", () => {
  it("aplica cambios por id y devuelve el DTO", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockResolvedValue({ count: 1 });
    prisma.tarifa.findFirst.mockResolvedValue(
      tarifaRow({ tiendaId: "tienda-2", status: "inactivo" }),
    );
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    const dto = await repo.update("cob-1", { tiendaId: "tienda-2", status: "inactivo" });

    const arg = prisma.tarifa.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "cob-1" });
    expect(arg.data.tiendaId).toBe("tienda-2");
    expect(arg.data.status).toBe("inactivo"); // enum: pasa tal cual, no Decimal
    expect(dto?.tiendaId).toBe("tienda-2");
    expect(dto?.status).toBe("inactivo");
  });

  it("convierte montos/porcentajes provistos a Prisma.Decimal", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockResolvedValue({ count: 1 });
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await repo.update("cob-1", { valorFlete: 20, ivaFlete: 10 });

    const arg = prisma.tarifa.updateMany.mock.calls[0][0];
    expect(arg.data.valorFlete).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data.ivaFlete).toBeInstanceOf(Prisma.Decimal);
  });

  it("devuelve null si no existe (R21)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockResolvedValue({ count: 0 });
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.update("x", { tiendaId: "tienda-2" })).toBeNull();
  });
});

describe("TarifaRepository.hardDelete", () => {
  // Lo que este describe protege NO es "que borre", es QUE BORRE DE VERDAD: si alguien
  // reintroduce el soft delete, `tarifa.delete` deja de llamarse y el primer test cae.
  it("borra la fila FISICAMENTE (delete, no updateMany)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.delete.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.hardDelete("cob-1")).toBe("ok");
    expect(prisma.tarifa.delete).toHaveBeenCalledWith({ where: { id: "cob-1" } });
    expect(prisma.tarifa.updateMany).not.toHaveBeenCalled();
  });

  it("not_found si la fila ya no estaba (P2025)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("no existe", {
        code: "P2025",
        clientVersion: "test",
      }),
    );
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.hardDelete("x")).toBe("not_found");
  });

  // FK RESTRICT desde `cierre_detail.tarifa_id`: la tarifa quedo congelada en un cierre.
  it("referenced si un cierre liquido contra esa tarifa (P2003)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", {
        code: "P2003",
        clientVersion: "test",
      }),
    );
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.hardDelete("cob-1")).toBe("referenced");
  });

  it("propaga cualquier otro error", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.delete.mockRejectedValue(new Error("boom"));
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await expect(repo.hardDelete("cob-1")).rejects.toThrow("boom");
  });
});

// El unico `(zona_id, tienda_id)` vive en SQL (NULLS NOT DISTINCT); si su violacion
// escapara cruda, la Server Action devolveria un 500 en vez de un conflicto.
describe("TarifaRepository: unico (zona_id, tienda_id)", () => {
  function p2002(target: string) {
    return new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
      meta: { target },
    });
  }

  it("create traduce el par duplicado a ConflictError", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.create.mockRejectedValue(p2002("tarifas_zona_id_tienda_id_key"));
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await expect(repo.create(baseCreateData())).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("update traduce el par duplicado a ConflictError", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockRejectedValue(p2002("tarifas_zona_id_tienda_id_key"));
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await expect(repo.update("cob-1", { zonaId: "z-1" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  // Un P2002 de OTRO indice no es este conflicto: se propaga tal cual para no
  // etiquetar como "par duplicado" algo que no lo es.
  it("no traduce el P2002 de otro indice", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.create.mockRejectedValue(p2002("otro_indice_key"));
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await expect(repo.create(baseCreateData())).rejects.toMatchObject({ code: "P2002" });
  });
});

// `tienda_id` es opcional desde la migracion tarifa_zona_is_default: NULL = la tarifa
// no esta acotada a ninguna tienda. El repo debe dejarlo viajar, no degradarlo.
describe("TarifaRepository: tienda opcional", () => {
  it("create persiste tiendaId null cuando no viene", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.create.mockResolvedValue(tarifaRow({ tiendaId: null }));
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    const { tiendaId: _omitida, ...sinTienda } = baseCreateData();
    const dto = await repo.create(sinTienda);

    expect(prisma.tarifa.create.mock.calls[0][0].data.tiendaId).toBeNull();
    expect(dto.tiendaId).toBeNull();
  });
});

// Metodo nuevo del modelo: respalda la invariante "el duenno debe tener un rol
// tarifable" que el service consulta en crear/actualizar.
describe("TarifaRepository.esTiendaAsignable", () => {
  it("true si el usuario existe y tiene un rol tarifable", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findFirst.mockResolvedValue({ id: "tienda-1" });
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.esTiendaAsignable("tienda-1")).toBe(true);

    const arg = prisma.usuario.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "tienda-1" });
    // El filtro admite AMBOS roles: la tienda humana y la cuenta de una API key.
    expect(arg.where.rol.value.in).toEqual(expect.arrayContaining(["adminTienda", "apiKey"]));
  });

  // El motivo de la feature: una API key factura sus propias ordenes, asi que
  // su cuenta dedicada tiene que poder llevar tarifa como cualquier tienda.
  it("la consulta acepta la cuenta dedicada de una API key", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findFirst.mockResolvedValue({ id: "usuario-de-la-key" });
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.esTiendaAsignable("usuario-de-la-key")).toBe(true);
    expect(ROLES_TARIFABLES).toContain("apiKey");
  });

  it("false si el usuario no existe o su rol no es tarifable", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findFirst.mockResolvedValue(null);
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.esTiendaAsignable("x")).toBe(false);
  });
});

// Tarifa especial: la unica columna nullable de la tabla. El repositorio tiene
// que conservar la distincion entre "sin pacto especial" (null) y "pacto de 0".
describe("TarifaRepository — tarifa especial (columna opcional)", () => {
  it("una fila sin tarifa especial sale del DTO como null, no como 0", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow({ tarifaEspecial: null }));
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    const dto = await repo.findById("cob-1");

    expect(dto?.tarifaEspecial).toBeNull();
    expect(dto?.tarifaEspecial).not.toBe(0);
  });

  it("una fila con tarifa especial la expone como number", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(
      tarifaRow({ tarifaEspecial: new Prisma.Decimal("1250.50") }),
    );
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect((await repo.findById("cob-1"))?.tarifaEspecial).toBe(1250.5);
  });

  it("crear sin tarifa especial escribe null en la columna", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.create.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await repo.create(baseCreateData());

    expect(prisma.tarifa.create.mock.calls[0][0].data.tarifaEspecial).toBeNull();
  });

  it("crear con tarifa especial la escribe como Decimal", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.create.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await repo.create({ ...baseCreateData(), tarifaEspecial: 1250.5 });

    const escrito = prisma.tarifa.create.mock.calls[0][0].data.tarifaEspecial;
    expect(escrito).toBeInstanceOf(Prisma.Decimal);
    expect(escrito.toString()).toBe("1250.5");
  });

  it("actualizar sin el campo NO toca la columna; con null la limpia", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockResolvedValue({ count: 1 });
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await repo.update("cob-1", { fulfillment: 9 });
    expect(prisma.tarifa.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      "tarifaEspecial",
    );

    await repo.update("cob-1", { tarifaEspecial: null });
    expect(prisma.tarifa.updateMany.mock.calls[1][0].data.tarifaEspecial).toBeNull();
  });
});
