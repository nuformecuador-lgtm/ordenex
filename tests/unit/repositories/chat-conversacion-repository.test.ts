import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ChatConversacionRepository } from "@/lib/repositories/ChatConversacionRepository";

// Feature 109 — C2 (R13/R16/R25). Tests unit del repositorio del hilo (mockea Prisma, sin
// DB real). Verifica la query scopeada (R16), el upsert por orden+numero (R13) y la
// resolucion D4 del entrante (R25).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    chatConversacion: {
      upsert: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    orden: {
      findFirst: vi.fn(),
    },
    // R25/D4: la resolucion del entrante matchea el telefono NORMALIZADO en ambos lados via SQL
    // crudo (`regexp_replace`), porque Prisma no puede normalizar la columna en el WHERE.
    $queryRaw: vi.fn(),
    ...overrides,
  };
}

const HILO = {
  id: "hilo-1",
  telefonoE164: "573001112233",
  ordenId: "orden-1",
  mensajeroId: "men-1",
  ultimoEntranteAt: new Date("2026-07-23T10:00:00.000Z"),
};

describe("ChatConversacionRepository", () => {
  it("R13: upsertParaOrden usa el unico (ordenId, telefonoE164) y crea con el mensajero", async () => {
    const prisma = buildPrisma();
    prisma.chatConversacion.upsert.mockResolvedValue(HILO);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    const dto = await repo.upsertParaOrden({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "573001112233",
    });

    const arg = prisma.chatConversacion.upsert.mock.calls[0][0];
    expect(arg.where.ordenId_telefonoE164).toEqual({
      ordenId: "orden-1",
      telefonoE164: "573001112233",
    });
    expect(arg.create.mensajeroId).toBe("men-1");
    expect(dto).toMatchObject({ id: "hilo-1", ordenId: "orden-1", mensajeroId: "men-1" });
  });

  it("R13: marcarUltimoEntrante sella ultimo_entrante_at por id", async () => {
    const prisma = buildPrisma();
    prisma.chatConversacion.update.mockResolvedValue({});
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    const at = new Date("2026-07-23T11:00:00.000Z");
    await repo.marcarUltimoEntrante("hilo-1", at);

    expect(prisma.chatConversacion.update).toHaveBeenCalledWith({
      where: { id: "hilo-1" },
      data: { ultimoEntranteAt: at },
    });
  });

  it("R16: findByOrdenParaMensajero scopea por (ordenId, mensajeroId)", async () => {
    const prisma = buildPrisma();
    prisma.chatConversacion.findFirst.mockResolvedValue(HILO);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    await repo.findByOrdenParaMensajero("orden-1", "men-1");

    expect(prisma.chatConversacion.findFirst.mock.calls[0][0].where).toEqual({
      ordenId: "orden-1",
      mensajeroId: "men-1",
    });
  });

  it("R16: devuelve null cuando la orden es de otro mensajero", async () => {
    const prisma = buildPrisma();
    prisma.chatConversacion.findFirst.mockResolvedValue(null);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    expect(await repo.findByOrdenParaMensajero("orden-1", "otro")).toBeNull();
  });

  it("R25/D4: resuelve la orden activa asignada MAS RECIENTE del numero", async () => {
    const prisma = buildPrisma();
    // Filas crudas snake_case tal como las devuelve `$queryRaw` sobre la tabla `orden`; la
    // primera es la MAS RECIENTE (el ORDER BY asignado_at DESC ... LIMIT 1 vive en el SQL).
    prisma.$queryRaw.mockResolvedValue([
      { id: "orden-9", mensajero_asignado_id: "men-9", telefono_dest: "573001112233" },
    ]);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    const res = await repo.resolverOrdenActivaPorNumero("573001112233");

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      ordenId: "orden-9",
      mensajeroId: "men-9",
      telefonoE164: "573001112233",
    });
  });

  it("R25: devuelve null cuando el numero no mapea a orden activa asignada", async () => {
    const prisma = buildPrisma();
    prisma.$queryRaw.mockResolvedValue([]); // ninguna orden viva/asignada matchea el numero
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    expect(await repo.resolverOrdenActivaPorNumero("573999")).toBeNull();
  });
});
