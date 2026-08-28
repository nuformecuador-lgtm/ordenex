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

// ---------------------------------------------------------------------------
// Feature 308 — C2.T / F2.T (R1/R7/R12/R14/R23). Columnas nuevas y autorizacion del proxy.
// ---------------------------------------------------------------------------

const CONTACTO = {
  nombre: "Ana Perez",
  telefonos: [{ valor: "+506 8888-1111", tipo: "CELL" }],
  correos: [],
  direcciones: [],
  organizacion: null,
  urls: [],
};

/** Fila completa tal como la devuelve el SELECT del repo, con todo a null salvo lo indicado. */
function filaCruda(over: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    conversacionId: "hilo-1",
    direccion: "entrante",
    tipo: "texto",
    cuerpo: null,
    plantillaId: null,
    waMessageId: "wamid.1",
    estado: null,
    latitud: null,
    longitud: null,
    errorCodigo: null,
    errorTitulo: null,
    errorDetalle: null,
    mediaId: null,
    mediaMime: null,
    mediaNombre: null,
    mediaTamanoBytes: null,
    reaccionAWaMessageId: null,
    reaccionEmoji: null,
    contactosJson: null,
    sistemaTelefonoAnterior: null,
    sistemaTelefonoNuevo: null,
    ocurridoAt: new Date("2026-08-27T10:00:00.000Z"),
    createdAt: new Date("2026-08-27T10:00:00.000Z"),
    ...over,
  };
}

describe("Feature 308 · ChatMensajeRepository — columnas nuevas (R1/R7)", () => {
  it("R1: un entrante de imagen persiste media_id y media_mime", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.createMany.mockResolvedValue({ count: 1 });
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    await repo.insertarEntranteIdempotente({
      conversacionId: "hilo-1",
      tipo: "imagen",
      cuerpo: "mira",
      waMessageId: "wamid.IMG",
      mediaId: "MEDIA-1",
      mediaMime: "image/jpeg",
      mediaNombre: null,
      mediaTamanoBytes: null,
      ocurridoAt: new Date(),
    });

    const data = prisma.chatMensaje.createMany.mock.calls[0][0].data[0];
    expect(data).toMatchObject({
      tipo: "imagen",
      mediaId: "MEDIA-1",
      mediaMime: "image/jpeg",
      cuerpo: "mira",
    });
  });

  it("R4/R5: una reaccion RETIRADA persiste el objetivo con emoji NULL", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.createMany.mockResolvedValue({ count: 1 });
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    await repo.insertarEntranteIdempotente({
      conversacionId: "hilo-1",
      tipo: "reaccion",
      cuerpo: null,
      waMessageId: "wamid.R",
      reaccionAWaMessageId: "wamid.OBJ",
      reaccionEmoji: null,
      ocurridoAt: new Date(),
    });

    const data = prisma.chatMensaje.createMany.mock.calls[0][0].data[0];
    expect(data.reaccionAWaMessageId).toBe("wamid.OBJ");
    expect(data.reaccionEmoji).toBeNull();
  });

  it("R12: el dedupe por wa_message_id sigue arbitrando CON las columnas nuevas", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.createMany.mockResolvedValue({ count: 0 }); // reenvio de Meta
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    const inserto = await repo.insertarEntranteIdempotente({
      conversacionId: "hilo-1",
      tipo: "imagen",
      cuerpo: null,
      waMessageId: "wamid.YA-REGISTRADO",
      mediaId: "MEDIA-1",
      ocurridoAt: new Date(),
    });

    expect(inserto).toBe(false);
    expect(prisma.chatMensaje.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it("R7: al leer, un contactos_json valido llega tipado al DTO", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.findMany.mockResolvedValue([
      filaCruda({ tipo: "contactos", contactosJson: [CONTACTO] }),
    ]);
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    const [dto] = await repo.listarHilo("hilo-1");
    expect(dto.contactos).toEqual([CONTACTO]);
  });

  it("R14: un contactos_json CORRUPTO se lee como null y no rompe el hilo", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.findMany.mockResolvedValue([
      filaCruda({ tipo: "contactos", contactosJson: { formato: "viejo" } }),
      filaCruda({ id: "msg-2", cuerpo: "sigo aqui" }),
    ]);
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    const dtos = await repo.listarHilo("hilo-1");
    expect(dtos).toHaveLength(2); // el hilo entero sigue en pie
    expect(dtos[0].contactos).toBeNull();
    expect(dtos[1].cuerpo).toBe("sigo aqui");
  });

  it("el SELECT del hilo trae las nueve columnas nuevas", async () => {
    const prisma = buildPrisma();
    prisma.chatMensaje.findMany.mockResolvedValue([]);
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);
    await repo.listarHilo("hilo-1");

    const select = prisma.chatMensaje.findMany.mock.calls[0][0].select;
    for (const campo of [
      "mediaId",
      "mediaMime",
      "mediaNombre",
      "mediaTamanoBytes",
      "reaccionAWaMessageId",
      "reaccionEmoji",
      "contactosJson",
      "sistemaTelefonoAnterior",
      "sistemaTelefonoNuevo",
    ]) {
      expect(select[campo], `falta ${campo} en el SELECT`).toBe(true);
    }
  });
});

describe("Feature 308 · findMediaParaMensajero — autorizacion del proxy (R23)", () => {
  function prismaConFilas(filas: unknown[]) {
    const queryRaw = vi.fn().mockResolvedValue(filas);
    return Object.assign(buildPrisma(), { $queryRaw: queryRaw });
  }

  it("devuelve el registro con su media cuando la orden es del mensajero", async () => {
    const prisma = prismaConFilas([
      {
        media_id: "MEDIA-1",
        media_mime: "image/jpeg",
        media_nombre: null,
        orden_id: "orden-1",
      },
    ]);
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    expect(await repo.findMediaParaMensajero("msg-1", "men-1")).toEqual({
      mediaId: "MEDIA-1",
      mediaMime: "image/jpeg",
      mediaNombre: null,
      ordenId: "orden-1",
    });
  });

  it("devuelve null cuando el mensaje es de una orden de OTRO mensajero", async () => {
    const prisma = prismaConFilas([]); // el WHERE con el scope no casa
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);

    expect(await repo.findMediaParaMensajero("msg-1", "men-ajeno")).toBeNull();
  });

  it("el scope va como PARAMETRO del WHERE, no interpolado en el texto del SQL", async () => {
    const prisma = prismaConFilas([]);
    const repo = new ChatMensajeRepository(prisma as unknown as PrismaClient);
    await repo.findMediaParaMensajero("msg-1", "men-1");

    const arg = prisma.$queryRaw.mock.calls[0][0] as {
      strings: readonly string[];
      values: unknown[];
    };
    const texto = arg.strings.join("?");
    expect(texto).toContain("o.mensajero_asignado_id");
    expect(texto).toContain("o.deleted_at IS NULL");
    // Ni el id del mensaje ni el del mensajero aparecen en el texto: viajan como valores.
    expect(texto).not.toContain("men-1");
    expect(texto).not.toContain("msg-1");
    expect(arg.values).toContain("men-1");
    expect(arg.values).toContain("msg-1");
  });
});
