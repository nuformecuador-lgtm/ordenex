import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ChatMensajeRepository } from "@/lib/repositories/ChatMensajeRepository";

// Feature 109 — C2 (R14/R8/R7/R22). Tests unit del repositorio de mensajes (mockea Prisma).
// Verifica la persistencia de campos (R14), el dedupe idempotente (R8, skipDuplicates =
// ON CONFLICT DO NOTHING) y el update de estado por wa_message_id (R7).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    chatMensaje: {
      createMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    ...overrides,
  };
}

describe("ChatMensajeRepository", () => {
  it("R6/R8: insertarEntranteIdempotente usa skipDuplicates y reporta si inserto", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.createMany.mockResolvedValue({ count: 1 });
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    const inserto = await repo.insertarEntranteIdempotente({
      conversacionId: "hilo-1",
      tipo: "texto",
      cuerpo: "hola",
      waMessageId: "wamid.IN1",
      ocurridoAt: new Date("2026-07-23T10:00:00.000Z"),
    });

    const arg = prisma.chatMensaje.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true); // R8: ON CONFLICT DO NOTHING
    expect(arg.data[0]).toMatchObject({
      conversacionId: "hilo-1",
      direccion: "entrante",
      tipo: "texto",
      cuerpo: "hola",
      waMessageId: "wamid.IN1",
    });
    expect(inserto).toBe(true);
  });

  it("R8: devuelve false cuando el dedupe omite el insert (count 0)", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.createMany.mockResolvedValue({ count: 0 });
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    const inserto = await repo.insertarEntranteIdempotente({
      conversacionId: "hilo-1",
      tipo: "texto",
      cuerpo: "dup",
      waMessageId: "wamid.DUP",
      ocurridoAt: new Date(),
    });
    expect(inserto).toBe(false);
  });

  it("R14/R20: insertarSaliente persiste direccion/tipo/cuerpo/estado y devuelve el id", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.create.mockResolvedValue({
      id: "msg-1",
      conversacionId: "hilo-1",
      direccion: "saliente",
      tipo: "texto",
      cuerpo: "buenas",
      plantillaId: null,
      waMessageId: "wamid.OUT1",
      estado: "sent",
      ocurridoAt: new Date("2026-07-23T12:00:00.000Z"),
      createdAt: new Date("2026-07-23T12:00:00.000Z"),
    });
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    const dto = await repo.insertarSaliente({
      conversacionId: "hilo-1",
      tipo: "texto",
      cuerpo: "buenas",
      waMessageId: "wamid.OUT1",
      estado: "sent",
      ocurridoAt: new Date("2026-07-23T12:00:00.000Z"),
    });

    const arg = prisma.chatMensaje.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({ direccion: "saliente", estado: "sent", waMessageId: "wamid.OUT1" });
    expect(dto.id).toBe("msg-1");
    expect(dto.waMessageId).toBe("wamid.OUT1");
  });

  it("R7/R8: actualizarEstadoPorWaMessageId filtra por wa_message_id + saliente y devuelve el conteo", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.updateMany.mockResolvedValue({ count: 1 });
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    const n = await repo.actualizarEstadoPorWaMessageId("wamid.OUT1", "delivered");

    expect(prisma.chatMensaje.updateMany).toHaveBeenCalledWith({
      where: { waMessageId: "wamid.OUT1", direccion: "saliente" },
      data: { estado: "delivered" },
    });
    expect(n).toBe(1);
  });

  it("R7: conteo 0 cuando el saliente aun no esta registrado (status adelantado)", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.updateMany.mockResolvedValue({ count: 0 });
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    expect(await repo.actualizarEstadoPorWaMessageId("wamid.DESCONOCIDO", "read")).toBe(0);
  });

  it("R22: listarHilo ordena por ocurrido_at asc", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.findMany.mockResolvedValue([]);
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    await repo.listarHilo("hilo-1");

    const arg = prisma.chatMensaje.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ conversacionId: "hilo-1" });
    expect(arg.orderBy[0]).toEqual({ ocurridoAt: "asc" });
  });
});
