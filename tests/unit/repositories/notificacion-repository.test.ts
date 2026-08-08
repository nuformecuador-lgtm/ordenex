import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";

// Feature 146 — B6. Tests unit del repositorio (mockea Prisma, sin DB real): forma de las
// consultas, traduccion del destinatario a las columnas del CHECK XOR, no-op ante la
// violacion del indice de dedupe (R27) e idempotencia de marcar/descartar (R37/R33).

function buildPrisma() {
  return {
    notificacion: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    notificacionLectura: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
  };
}

function repoCon(prisma: ReturnType<typeof buildPrisma>) {
  return new NotificacionRepository(prisma as unknown as PrismaClient);
}

const ACTOR = { usuarioId: "u-1", rol: "adminSatelite" as const, zonaId: "z-1" };
const AHORA = new Date("2026-07-27T12:00:00.000Z");

describe("crear — traduce el destinatario a las columnas del XOR", () => {
  it("una notificacion de rol acotada a una zona deja el destinatario de usuario en null", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.create.mockResolvedValue({ id: "n-1" });

    const creada = await repoCon(prisma).crear({
      tipo: "warning",
      evento: "cierre_dia_por_aprobar",
      descripcion: "Un mensajero envió su cierre del día para aprobación.",
      anexo: "Zona Norte",
      entidadTipo: "cierre_dia",
      entidadId: "c-1",
      destinatario: { tipo: "rol", rol: "adminSatelite", zonaId: "z-1" },
    });

    expect(creada).toBe(true);
    expect(prisma.notificacion.create.mock.calls[0][0].data).toMatchObject({
      destinatarioRol: "adminSatelite",
      destinatarioUsuarioId: null,
      tiendaId: null,
      zonaId: "z-1",
      entidadId: "c-1",
    });
  });

  it("una notificacion dirigida a un usuario deja el rol y AMBOS alcances en null", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.create.mockResolvedValue({ id: "n-2" });

    await repoCon(prisma).crear({
      tipo: "box",
      evento: "carga_masiva_terminada",
      descripcion: "Carga masiva terminada: 12 órdenes cargadas.",
      entidadTipo: "carga",
      entidadId: "lote-1",
      destinatario: { tipo: "usuario", usuarioId: "u-9" },
    });

    expect(prisma.notificacion.create.mock.calls[0][0].data).toMatchObject({
      destinatarioRol: null,
      destinatarioUsuarioId: "u-9",
      tiendaId: null,
      zonaId: null,
    });
  });

  it("escribe en el `tx` recibido cuando la emision es transaccional", async () => {
    const prisma = buildPrisma();
    const tx = buildPrisma();
    tx.notificacion.create.mockResolvedValue({ id: "n-3" });

    await repoCon(prisma).crear(
      {
        tipo: "alert",
        evento: "orden_rechazada",
        descripcion: "Una orden fue rechazada por el destinatario.",
        entidadTipo: "orden",
        entidadId: "o-1",
        destinatario: { tipo: "rol", rol: "maestro" },
      },
      tx as unknown as PrismaClient,
    );

    expect(tx.notificacion.create).toHaveBeenCalledTimes(1);
    expect(prisma.notificacion.create).not.toHaveBeenCalled();
  });
});

describe("R27 — la violacion del indice de dedupe es un no-op, no un error", () => {
  it("devuelve false sin lanzar cuando el create choca con notificacion_dedupe_key", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "7.8.0",
      }),
    );

    const creada = await repoCon(prisma).crear({
      tipo: "alert",
      evento: "orden_rechazada",
      descripcion: "Una orden fue rechazada por el destinatario.",
      entidadTipo: "orden",
      entidadId: "o-1",
      destinatario: { tipo: "rol", rol: "maestro" },
    });

    expect(creada).toBe(false);
  });

  it("propaga cualquier otro error (el productor transaccional debe revertir, R21)", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.create.mockRejectedValue(new Error("conexion caida"));

    await expect(
      repoCon(prisma).crear({
        tipo: "alert",
        evento: "orden_rechazada",
        descripcion: "x",
        entidadTipo: "orden",
        entidadId: "o-1",
        destinatario: { tipo: "rol", rol: "maestro" },
      }),
    ).rejects.toThrow("conexion caida");
  });

  it("la guardia previa busca por (evento, entidad, destinatario) SIN lectura que la marque leida", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.findFirst.mockResolvedValue({ id: "n-1" });

    const existe = await repoCon(prisma).existeNoLeidaPara(
      "cierre_dia_por_aprobar",
      "c-1",
      { tipo: "rol", rol: "admin" },
    );

    expect(existe).toBe(true);
    expect(prisma.notificacion.findFirst.mock.calls[0][0].where).toEqual({
      evento: "cierre_dia_por_aprobar",
      entidadId: "c-1",
      destinatarioRol: "admin",
      destinatarioUsuarioId: null,
      lecturas: { none: { leidaAt: { not: null } } },
    });
  });
});

describe("listarParaUsuario — ventana, orden, limite y lectura por actor", () => {
  it("ordena por fecha descendente, acota al limite y excluye lo que el actor descarto", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.findMany.mockResolvedValue([]);

    await repoCon(prisma).listarParaUsuario({ actor: ACTOR, desde: AHORA, limite: 50 });

    const arg = prisma.notificacion.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.take).toBe(50);
    expect(arg.where.AND).toContainEqual({ createdAt: { gte: AHORA } });
    expect(arg.where.AND).toContainEqual({
      lecturas: { none: { usuarioId: "u-1", descartadaAt: { not: null } } },
    });
    // el estado de lectura se proyecta SOLO para el actor (R3/R30).
    expect(arg.select.lecturas.where).toEqual({ usuarioId: "u-1" });
  });

  it("deriva `leida` de la fila de lectura del actor", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.findMany.mockResolvedValue([
      {
        id: "n-1",
        tipo: "alert",
        descripcion: "a",
        anexo: null,
        createdAt: AHORA,
        lecturas: [{ leidaAt: AHORA }],
      },
      {
        id: "n-2",
        tipo: "box",
        descripcion: "b",
        anexo: "Lote #1",
        createdAt: AHORA,
        lecturas: [],
      },
    ]);

    const filas = await repoCon(prisma).listarParaUsuario({
      actor: ACTOR,
      desde: AHORA,
      limite: 50,
    });

    expect(filas.map((f) => f.leida)).toEqual([true, false]);
    expect(filas[1].anexo).toBe("Lote #1");
  });
});

describe("verificarVisible — distingue no_existe de no_visible (R35)", () => {
  it("devuelve visible cuando la notificacion pasa el predicado", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.findFirst.mockResolvedValue({ id: "n-1" });

    expect(await repoCon(prisma).verificarVisible("n-1", ACTOR)).toBe("visible");
    expect(prisma.notificacion.findUnique).not.toHaveBeenCalled();
  });

  it("devuelve no_visible cuando existe pero no pasa el predicado", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.findFirst.mockResolvedValue(null);
    prisma.notificacion.findUnique.mockResolvedValue({ id: "n-1" });

    expect(await repoCon(prisma).verificarVisible("n-1", ACTOR)).toBe("no_visible");
  });

  it("devuelve no_existe cuando la fila no esta", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.findFirst.mockResolvedValue(null);
    prisma.notificacion.findUnique.mockResolvedValue(null);

    expect(await repoCon(prisma).verificarVisible("n-x", ACTOR)).toBe("no_existe");
  });
});

describe("R37 — marcar y descartar son idempotentes y dejan UNA sola fila", () => {
  it("descartar sella descartada_at y garantiza leida_at, sin borrar la notificacion (R33)", async () => {
    const prisma = buildPrisma();
    prisma.notificacionLectura.upsert.mockResolvedValue({});
    prisma.notificacionLectura.updateMany.mockResolvedValue({ count: 0 });

    await repoCon(prisma).descartar("n-1", "u-1", AHORA);

    const arg = prisma.notificacionLectura.upsert.mock.calls[0][0];
    expect(arg.create).toEqual({
      notificacionId: "n-1",
      usuarioId: "u-1",
      leidaAt: AHORA,
      descartadaAt: AHORA,
    });
    expect(arg.update).toEqual({ descartadaAt: AHORA });
    // COALESCE(leida_at, now()): descartar implica leer.
    expect(prisma.notificacionLectura.updateMany).toHaveBeenCalledWith({
      where: { notificacionId: "n-1", usuarioId: "u-1", leidaAt: null },
      data: { leidaAt: AHORA },
    });
  });
});

describe("R32 — marcarTodasLeidas inserta con ON CONFLICT DO NOTHING", () => {
  it("no toca la DB cuando no queda ninguna por leer", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.findMany.mockResolvedValue([]);

    expect(await repoCon(prisma).marcarTodasLeidas(ACTOR, AHORA, AHORA)).toBe(0);
    expect(prisma.notificacionLectura.createMany).not.toHaveBeenCalled();
  });

  it("inserta una lectura por cada visible no leida y no descartada del actor", async () => {
    const prisma = buildPrisma();
    prisma.notificacion.findMany.mockResolvedValue([{ id: "n-1" }, { id: "n-2" }]);
    prisma.notificacionLectura.createMany.mockResolvedValue({ count: 2 });

    const marcadas = await repoCon(prisma).marcarTodasLeidas(ACTOR, AHORA, AHORA);

    expect(marcadas).toBe(2);
    const arg = prisma.notificacionLectura.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toEqual([
      { notificacionId: "n-1", usuarioId: "u-1", leidaAt: AHORA },
      { notificacionId: "n-2", usuarioId: "u-1", leidaAt: AHORA },
    ]);
    // el conjunto es el del listado MENOS las ya leidas, para que el contador quede en cero.
    expect(prisma.notificacion.findMany.mock.calls[0][0].where.AND).toContainEqual({
      lecturas: { none: { usuarioId: "u-1", leidaAt: { not: null } } },
    });
  });
});
