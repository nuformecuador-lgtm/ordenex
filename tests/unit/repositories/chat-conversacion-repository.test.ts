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
    // El conteo de no leidos y el sellado de lectura tambien van raw: correlacionan
    // `chat_mensaje.ocurrido_at` con `chat_conversacion.mensajero_leido_at`.
    $executeRaw: vi.fn(),
    ...overrides,
  };
}

/**
 * Texto del SQL de una plantilla `Prisma.sql`, con los parametros sustituidos por `?`. Los
 * valores viajan aparte (`.values`), que es justo lo que hace falta comprobar: el scope no
 * esta interpolado en el texto.
 */
function sqlTexto(arg: { strings: readonly string[] }): string {
  return arg.strings.join("?");
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

// Indicador de mensajes sin leer: el conteo se DERIVA de `mensajero_leido_at`, no de un
// contador guardado. Estos tests fijan las tres decisiones que hacen que el numero sea
// correcto: solo entrantes, `NULL` = nunca leido (cuentan todos) y el scope por mensajero
// como PARAMETRO (nunca interpolado en el texto del SQL).
describe("ChatConversacionRepository · no leidos del chat", () => {
  it("cuenta SOLO entrantes posteriores a la marca de lectura, scopeado por mensajero", async () => {
    const prisma = buildPrisma();
    prisma.$queryRaw.mockResolvedValue([
      { orden_id: "orden-1", no_leidos: 3 },
      { orden_id: "orden-2", no_leidos: 1 },
    ]);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    const res = await repo.contarNoLeidosPorMensajero("men-1");

    const arg = prisma.$queryRaw.mock.calls[0][0];
    const texto = sqlTexto(arg);
    expect(texto).toMatch(/m\.direccion = 'entrante'/);
    expect(texto).toMatch(/m\.ocurrido_at > c\.mensajero_leido_at/);
    // NULL = nunca abrio el hilo -> cuentan todos los entrantes.
    expect(texto).toMatch(/c\.mensajero_leido_at IS NULL/);
    expect(texto).toMatch(/GROUP BY c\.orden_id/);
    // El scope viaja como parametro, no concatenado (sin esto seria inyectable).
    expect(texto).toContain("c.mensajero_id = ?");
    expect(arg.values).toEqual(["men-1"]);

    expect(res).toEqual([
      { ordenId: "orden-1", noLeidos: 3 },
      { ordenId: "orden-2", noLeidos: 1 },
    ]);
  });

  it("castea el COUNT a int: el BigInt de Postgres no cruza a la UI", async () => {
    const prisma = buildPrisma();
    prisma.$queryRaw.mockResolvedValue([{ orden_id: "orden-1", no_leidos: 2 }]);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    const res = await repo.contarNoLeidosPorMensajero("men-1");

    expect(sqlTexto(prisma.$queryRaw.mock.calls[0][0])).toMatch(/COUNT\(m\.id\)::int/);
    expect(typeof res[0].noLeidos).toBe("number");
    expect(JSON.stringify(res)).toContain('"noLeidos":2'); // serializable, no BigInt
  });

  it("sin pendientes -> lista vacia (la ausencia es el cero)", async () => {
    const prisma = buildPrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    expect(await repo.contarNoLeidosPorMensajero("men-1")).toEqual([]);
  });

  it("sella la lectura con el ULTIMO entrante del hilo, no con la hora del servidor", async () => {
    const prisma = buildPrisma();
    prisma.$executeRaw.mockResolvedValue(1);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    await repo.marcarLeidoHastaUltimoEntrante("orden-1", "men-1");

    const texto = sqlTexto(prisma.$executeRaw.mock.calls[0][0]);
    // La marca sale del hilo: `now()` daria por leido un entrante que el mensajero no vio.
    expect(texto).toMatch(/mensajero_leido_at = GREATEST/);
    expect(texto).toMatch(/SELECT MAX\(m\.ocurrido_at\)/);
    expect(texto).toMatch(/m\.direccion = 'entrante'/);
    expect(texto).not.toMatch(/mensajero_leido_at = NOW\(\)/);
  });

  it("el sellado va scopeado por (orden, mensajero): nadie marca el hilo de otro", async () => {
    const prisma = buildPrisma();
    prisma.$executeRaw.mockResolvedValue(0);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    await repo.marcarLeidoHastaUltimoEntrante("orden-1", "men-1");

    const arg = prisma.$executeRaw.mock.calls[0][0];
    expect(sqlTexto(arg)).toContain("c.orden_id = ?");
    expect(sqlTexto(arg)).toContain("c.mensajero_id = ?");
    expect(arg.values).toEqual(["orden-1", "men-1"]);
  });
});

// ---------------------------------------------------------------------------
// Feature 308 — C3.T (R16/R18). `migrarTelefono`: el cliente cambio de numero.
// ---------------------------------------------------------------------------

describe("Feature 308 · migrarTelefono (R16/R18)", () => {
  it("R16: reescribe telefono_e164 del hilo y devuelve las filas migradas", async () => {
    const prisma = buildPrisma();
    prisma.$executeRaw.mockResolvedValue(1);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    const migradas = await repo.migrarTelefono("50688887777", "50699996666");

    expect(migradas).toBe(1);
    const arg = prisma.$executeRaw.mock.calls[0][0] as {
      strings: readonly string[];
      values: unknown[];
    };
    const texto = sqlTexto(arg);
    expect(texto).toContain("UPDATE chat_conversacion");
    expect(texto).toContain("SET telefono_e164");
    // Los numeros viajan como PARAMETROS, nunca interpolados en el texto.
    expect(texto).not.toContain("50699996666");
    expect(arg.values).toContain("50699996666");
    expect(arg.values).toContain("50688887777");
  });

  it("R18/P5: si la orden YA tiene hilo con el numero nuevo, no migra y devuelve 0 sin lanzar", async () => {
    // El `NOT EXISTS` del WHERE deja fuera esa fila: `$executeRaw` devuelve 0 filas afectadas.
    const prisma = buildPrisma();
    prisma.$executeRaw.mockResolvedValue(0);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    await expect(repo.migrarTelefono("50688887777", "50699996666")).resolves.toBe(0);
    expect(sqlTexto(prisma.$executeRaw.mock.calls[0][0])).toContain("NOT EXISTS");
  });

  it("R17: el UPDATE escribe SOLO en chat_conversacion (ni orden ni cliente)", async () => {
    const prisma = buildPrisma();
    prisma.$executeRaw.mockResolvedValue(1);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);
    await repo.migrarTelefono("50688887777", "50699996666");

    const texto = sqlTexto(prisma.$executeRaw.mock.calls[0][0]);
    expect(texto).not.toMatch(/UPDATE\s+orden/i);
    expect(texto).not.toMatch(/UPDATE\s+cliente/i);
    expect(texto).not.toMatch(/telefono_dest/i);
    expect(prisma.orden.findFirst).not.toHaveBeenCalled();
  });

  it("normaliza ambos numeros: `+506 8888-7777` y `88887777` son el MISMO hilo", async () => {
    const prisma = buildPrisma();
    prisma.$executeRaw.mockResolvedValue(1);
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    await repo.migrarTelefono("+506 8888-7777", "9999-6666");

    const arg = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(arg.values).toContain("50688887777");
    expect(arg.values).toContain("50699996666");
  });

  it("mismo numero a ambos lados o numero vacio: 0 sin tocar la base", async () => {
    const prisma = buildPrisma();
    const repo = new ChatConversacionRepository(prisma as unknown as PrismaClient);

    expect(await repo.migrarTelefono("50688887777", "+506 8888-7777")).toBe(0);
    expect(await repo.migrarTelefono("", "50699996666")).toBe(0);
    expect(await repo.migrarTelefono("50688887777", "")).toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
