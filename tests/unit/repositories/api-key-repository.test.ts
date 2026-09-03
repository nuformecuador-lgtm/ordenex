import { conRegistroDeAcciones } from "../../fixtures/registro-de-acciones";
import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";
import {
  CatalogoInvalidoError,
  UsuarioDuplicadoError,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { CreateApiKeyConUsuarioData } from "@/lib/interfaces/repositories/IApiKeyRepository";

// Feature 81 — ApiKeyRepository con Prisma mockeado (sin DB). Aqui se verifica lo que
// el repositorio decide por lookup: rol `apiKey` [D1], tipo `cedula` [D4], estado
// `activo` [D5], y la atomicidad usuario+key (R13).

const DATA: CreateApiKeyConUsuarioData = {
  identificador: "Tienda Uno",
  slug: "tienda-uno",
  email: "apikey+tienda-uno@apikey.invalid",
  cedula: "APIKEY-tienda-uno",
  passwordHash: "$2b$10$hashbcryptdelacontrasenaaleatoria000000000000000000000000",
  keyPrefix: "ordx_abc1234",
  keyHash: "a".repeat(64),
  createdById: "u-maestro",
  tiendaDestinoId: null, // feature 302: sin tienda destino (comportamiento historico)
};

interface MockOpts {
  rol?: { id: string } | null;
  tipo?: { id: string } | null;
  usuarioCreate?: () => unknown;
  apiKeyCreate?: () => unknown;
}

function makePrisma(opts: MockOpts = {}) {
  const usuarioCreate = vi.fn(async (args: unknown) => {
    if (opts.usuarioCreate) return opts.usuarioCreate();
    void args;
    return { id: "u-dedicado" };
  });
  const apiKeyCreate = vi.fn(async (args: unknown) => {
    if (opts.apiKeyCreate) return opts.apiKeyCreate();
    void args;
    return {
      id: "key-1",
      identificador: DATA.identificador,
      keyPrefix: DATA.keyPrefix,
      estado: "activa",
      usuarioId: "u-dedicado",
      createdAt: new Date("2026-07-16T12:00:00Z"),
    };
  });

  // FICHA 362: la `tx` gana el congelado del actor y la tabla del registro.
  const tx = {
    usuario: {
      create: usuarioCreate,
      findUnique: vi.fn(async () => ({
        nombre: "Maestra",
        primerApellido: "Uno",
        rol: { value: "maestro" },
      })),
    },
    apiKey: { create: apiKeyCreate },
    historialAccion: { createMany: vi.fn(async () => ({ count: 1 })) },
  };

  const prisma = {
    rol: {
      findUnique: vi.fn(async () => (opts.rol === undefined ? { id: "rol-apikey" } : opts.rol)),
    },
    tipoIdentificacion: {
      findUnique: vi.fn(async () => (opts.tipo === undefined ? { id: "tipo-cedula" } : opts.tipo)),
    },
    // Reproduce la semantica de $transaction(callback): si el callback lanza, nada se
    // persiste (aqui: la excepcion escala y el repo no devuelve nada).
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  return { prisma, usuarioCreate, apiKeyCreate, tx };
}

function repoDe(prisma: unknown) {
  return new ApiKeyRepository(prisma as never);
}

describe("ApiKeyRepository.createConUsuario — catalogos por lookup ([D1]/[D4])", () => {
  it("[D1]/[D4]: resuelve rol='apiKey' y tipoIdentificacion='cedula' por VALUE, sin ids hardcodeados", async () => {
    const { prisma } = makePrisma();
    await repoDe(prisma).createConUsuario(DATA);

    expect(prisma.rol.findUnique).toHaveBeenCalledWith({
      where: { value: "apiKey" },
      select: { id: true },
    });
    expect(prisma.tipoIdentificacion.findUnique).toHaveBeenCalledWith({
      where: { value: "cedula" },
      select: { id: true },
    });
  });

  it("[D1]: si el rol apiKey no existe (migracion no corrida) falla con CatalogoInvalidoError, sin escribir", async () => {
    const { prisma, usuarioCreate } = makePrisma({ rol: null });
    await expect(repoDe(prisma).createConUsuario(DATA)).rejects.toBeInstanceOf(CatalogoInvalidoError);
    expect(usuarioCreate).not.toHaveBeenCalled();
  });

  it("[D4]: si el tipo 'cedula' no existe falla con CatalogoInvalidoError, sin escribir", async () => {
    const { prisma, usuarioCreate } = makePrisma({ tipo: null });
    await expect(repoDe(prisma).createConUsuario(DATA)).rejects.toBeInstanceOf(CatalogoInvalidoError);
    expect(usuarioCreate).not.toHaveBeenCalled();
  });
});

describe("ApiKeyRepository.createConUsuario — usuario dedicado (R7/R8/R10/R12)", () => {
  it("R12: crea el usuario con el rol apiKey [D1] y estado 'activo' [D5]", async () => {
    const { prisma, usuarioCreate } = makePrisma();
    await repoDe(prisma).createConUsuario(DATA);

    const args = usuarioCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data.rolId).toBe("rol-apikey"); // [D1]
    expect(args.data.estado).toBe("activo"); // [D5]
    expect(args.data.tipoIdentificacionId).toBe("tipo-cedula"); // [D4]
  });

  it("R7/R8/R10: nombre derivado del identificador, hash bcrypt, email/cedula sinteticos", async () => {
    const { prisma, usuarioCreate } = makePrisma();
    await repoDe(prisma).createConUsuario(DATA);

    const args = usuarioCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data.nombre).toBe("Tienda Uno"); // R7
    expect(args.data.passwordHash).toBe(DATA.passwordHash); // R8: solo el hash
    expect(args.data.email).toBe(DATA.email); // R10
    expect(args.data.cedula).toBe(DATA.cedula); // R10
    // [D4]: la cuenta no tiene telefono real ni zona; nunca fulfillment.
    expect(args.data.telefono).toBe("");
    expect(args.data.zonaId).toBeNull();
    expect(args.data.fulfillment).toBe(false);
  });
});

describe("ApiKeyRepository.createConUsuario — la key (R16/R17/R19/R21)", () => {
  it("R16/R17/R21: persiste keyHash, keyPrefix, usuario dedicado y creador", async () => {
    const { prisma, apiKeyCreate } = makePrisma();
    await repoDe(prisma).createConUsuario(DATA);

    const args = apiKeyCreate.mock.calls[0][0] as {
      data: Record<string, unknown>;
      select: Record<string, boolean>;
    };
    expect(args.data.keyHash).toBe(DATA.keyHash); // R16
    expect(args.data.keyPrefix).toBe(DATA.keyPrefix); // R17
    expect(args.data.usuarioId).toBe("u-dedicado"); // R21/[D6]: el usuario recien creado
    expect(args.data.createdById).toBe("u-maestro"); // R21
    expect(args.data.slug).toBe("tienda-uno");
  });

  it("R19: el select de retorno NO proyecta keyHash", async () => {
    const { prisma, apiKeyCreate } = makePrisma();
    const out = await repoDe(prisma).createConUsuario(DATA);

    const args = apiKeyCreate.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(args.select).not.toHaveProperty("keyHash");
    expect(Object.keys(args.select).sort()).toEqual(
      [
        "createdAt",
        "estado",
        "id",
        "identificador",
        "keyPrefix",
        "tiendaDestinoId", // feature 302
        "usuarioId",
      ].sort(),
    );
    expect(out).not.toHaveProperty("keyHash");
  });
});

describe("ApiKeyRepository.findByKeyHash — lookup por hash sin filtrar el secreto (feature 88/R3/R6)", () => {
  function makePrismaFind(row: unknown) {
    const findUnique = vi.fn(async (_args: unknown) => row);
    const prisma = { apiKey: { findUnique } };
    return { prisma, findUnique };
  }

  it("R3: busca por key_hash (UNIQUE) y su select NUNCA proyecta keyHash ni el secreto", async () => {
    const { prisma, findUnique } = makePrismaFind({
      id: "key-1",
      estado: "activa",
      usuarioId: "u-dedicado",
      usuario: { estado: "activo", rol: { value: "apiKey" } },
      tiendaDestinoId: null,
      tiendaDestino: null,
    });
    const out = await repoDe(prisma).findByKeyHash("a".repeat(64));

    // Lookup por el indice UNIQUE key_hash (nunca por el secreto en claro).
    const args = findUnique.mock.calls[0][0] as { where: Record<string, unknown>; select: Record<string, unknown> };
    expect(args.where).toEqual({ keyHash: "a".repeat(64) });
    // El select NO incluye keyHash ni ningun secreto; solo lo minimo para autorizar.
    expect(args.select).not.toHaveProperty("keyHash");
    expect(Object.keys(args.select).sort()).toEqual(
      // Feature 302: dos claves mas, y ninguna es un secreto — la tienda destino y su estado/rol,
      // que el service necesita para decidir en la MISMA peticion que autentica.
      ["estado", "id", "tiendaDestino", "tiendaDestinoId", "usuario", "usuarioId"].sort(),
    );
    // La proyeccion devuelta tampoco expone keyHash. Incluye el estado PROPIO de la key
    // (apiKeyEstado), insumo de la palanca de revocacion de la feature 88/R7.
    expect(out).toEqual({
      apiKeyId: "key-1",
      usuarioId: "u-dedicado",
      tiendaDestinoId: null,
      tiendaDestinoEstado: null,
      tiendaDestinoRol: null,
      estado: "activo",
      apiKeyEstado: "activa",
      rol: "apiKey",
    });
    expect(out).not.toHaveProperty("keyHash");
  });

  it("302: cuando la key apunta a una tienda, la proyeccion trae su id, su estado y su rol", async () => {
    // Sin estos tres campos, `ApiKeyAuthService` no podria comprobar en cada peticion que la
    // tienda destino sigue siendo una tienda y sigue activa: quedaria una ventana en la que una
    // tienda dada de baja sigue recibiendo carga por su key.
    const { prisma } = makePrismaFind({
      id: "key-1",
      estado: "activa",
      usuarioId: "u-dedicado",
      usuario: { estado: "activo", rol: { value: "apiKey" } },
      tiendaDestinoId: "u-nuform",
      tiendaDestino: { estado: "activo", rol: { value: "adminTienda" } },
    });
    const out = await repoDe(prisma).findByKeyHash("a".repeat(64));
    expect(out).toEqual({
      apiKeyId: "key-1",
      usuarioId: "u-dedicado",
      tiendaDestinoId: "u-nuform",
      tiendaDestinoEstado: "activo",
      tiendaDestinoRol: "adminTienda",
      estado: "activo",
      apiKeyEstado: "activa",
      rol: "apiKey",
    });
  });

  it("R4: devuelve null cuando ninguna fila coincide con el hash", async () => {
    const { prisma } = makePrismaFind(null);
    const out = await repoDe(prisma).findByKeyHash("b".repeat(64));
    expect(out).toBeNull();
  });

  it("proyecta el estado del usuario dedicado (insumo de la palanca de revocacion, R5)", async () => {
    const { prisma } = makePrismaFind({
      id: "key-9",
      estado: "activa",
      usuarioId: "u-9",
      usuario: { estado: "bloqueado", rol: { value: "apiKey" } },
    });
    const out = await repoDe(prisma).findByKeyHash("c".repeat(64));
    expect(out).toMatchObject({ estado: "bloqueado", apiKeyEstado: "activa" });
  });
});

describe("ApiKeyRepository.rotar / setEstado — ciclo de vida (R2/R3/R4/R6)", () => {
  function makePrismaUpdate(row: unknown, throwErr?: unknown) {
    const update = vi.fn(async (args: unknown) => {
      if (throwErr) throw throwErr;
      void args;
      return row;
    });
    // FICHA 362: `rotar` y `setEstado` corren dentro de `$transaction` y registran su accion.
    const prisma = conRegistroDeAcciones({
      apiKey: { update, findUnique: vi.fn().mockResolvedValue({ estado: "activa" }) },
    });
    return { prisma, update };
  }

  const PUBLIC_ROW = {
    id: "key-1",
    identificador: "Tienda Uno",
    keyPrefix: "ordx_nuevo12",
    estado: "activa",
    usuarioId: "u-dedicado",
    tiendaDestinoId: null, // feature 302: fila SIN tienda destino
    createdAt: new Date("2026-07-16T12:00:00Z"),
  };

  function p2025() {
    return new Prisma.PrismaClientKnownRequestError("Record to update not found", {
      code: "P2025",
      clientVersion: "7.8.0",
    });
  }

  it("R2: rotar reemplaza keyPrefix+keyHash por id, sin tocar usuario ni estado, y su select no pide keyHash (R6)", async () => {
    const { prisma, update } = makePrismaUpdate(PUBLIC_ROW);
    const out = await repoDe(prisma).rotar("key-1", { keyPrefix: "ordx_nuevo12", keyHash: "f".repeat(64) }, "actor-1");

    const args = update.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
      select: Record<string, boolean>;
    };
    expect(args.where).toEqual({ id: "key-1" });
    expect(args.data).toEqual({ keyPrefix: "ordx_nuevo12", keyHash: "f".repeat(64) });
    // No toca el usuario dedicado ni el estado propio de la key.
    expect(args.data).not.toHaveProperty("usuarioId");
    expect(args.data).not.toHaveProperty("estado");
    // R6/R19: el retorno nunca proyecta keyHash.
    expect(args.select).not.toHaveProperty("keyHash");
    expect(out).not.toHaveProperty("keyHash");
    // Feature 302: la forma publica anade `ownerUsuarioId` (el dueno de las ordenes, ya resuelto).
    // Sin tienda destino es la propia cuenta dedicada: identico al comportamiento historico.
    expect(out).toEqual({ ...PUBLIC_ROW, ownerUsuarioId: "u-dedicado" });
  });

  it("302: si la fila trae tienda destino, el ownerUsuarioId publico es LA TIENDA", async () => {
    const { prisma } = makePrismaUpdate({ ...PUBLIC_ROW, tiendaDestinoId: "u-nuform" });
    const out = await repoDe(prisma).rotar(
      "key-1",
      { keyPrefix: "ordx_nuevo12", keyHash: "f".repeat(64) },
      "actor-1",
    );
    // Es el id del que cuelga el webhook de la key: si aqui saliera `u-dedicado`, la suscripcion
    // se colgaria de una cuenta que no recibe ninguna orden y no llegaria un solo evento.
    expect(out?.ownerUsuarioId).toBe("u-nuform");
    expect(out?.usuarioId).toBe("u-dedicado"); // la credencial NO cambia de dueno
  });

  it("R3: rotar de un id inexistente (P2025) devuelve null", async () => {
    const { prisma } = makePrismaUpdate(null, p2025());
    expect(await repoDe(prisma).rotar("no-existe", { keyPrefix: "ordx_x", keyHash: "a".repeat(64) }, "actor-1")).toBeNull();
  });

  it("R4: setEstado escribe el estado destino por id y devuelve la forma publica sin keyHash", async () => {
    const { prisma, update } = makePrismaUpdate({ ...PUBLIC_ROW, estado: "inactiva" });
    const out = await repoDe(prisma).setEstado("key-1", "inactiva", "actor-1");

    const args = update.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
      select: Record<string, boolean>;
    };
    expect(args.where).toEqual({ id: "key-1" });
    expect(args.data).toEqual({ estado: "inactiva" });
    expect(args.select).not.toHaveProperty("keyHash");
    expect(out).toMatchObject({ estado: "inactiva" });
  });

  it("R3: setEstado de un id inexistente (P2025) devuelve null", async () => {
    const { prisma } = makePrismaUpdate(null, p2025());
    expect(await repoDe(prisma).setEstado("no-existe", "activa", "actor-1")).toBeNull();
  });

  it("un error que NO es P2025 se re-lanza tal cual (no se disfraza de not_found)", async () => {
    const { prisma } = makePrismaUpdate(null, new Error("conexion perdida"));
    await expect(repoDe(prisma).setEstado("key-1", "activa", "actor-1")).rejects.toThrow("conexion perdida");
  });
});

describe("ApiKeyRepository.createConUsuario — atomicidad (R13)", () => {
  it("R13: ambos INSERT ocurren DENTRO de la misma $transaction", async () => {
    const { prisma, usuarioCreate, apiKeyCreate } = makePrisma();
    await repoDe(prisma).createConUsuario(DATA);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Los dos creates se invocan sobre el cliente transaccional `tx`, no sobre prisma.
    expect(usuarioCreate).toHaveBeenCalledTimes(1);
    expect(apiKeyCreate).toHaveBeenCalledTimes(1);
  });

  it("R13: si falla la creacion de la KEY, la excepcion escala (la tx revierte el usuario)", async () => {
    const { prisma, usuarioCreate } = makePrisma({
      apiKeyCreate: () => {
        throw new Error("fallo el insert de api_key");
      },
    });
    await expect(repoDe(prisma).createConUsuario(DATA)).rejects.toThrow("fallo el insert de api_key");
    // El usuario se intento crear, pero al lanzar dentro del callback la $transaction
    // hace ROLLBACK: no queda usuario huerfano sin key.
    expect(usuarioCreate).toHaveBeenCalledTimes(1);
  });

  it("R13: si falla la creacion del USUARIO, la key nunca se intenta", async () => {
    const { prisma, apiKeyCreate } = makePrisma({
      usuarioCreate: () => {
        throw new Error("fallo el insert de usuario");
      },
    });
    await expect(repoDe(prisma).createConUsuario(DATA)).rejects.toThrow("fallo el insert de usuario");
    expect(apiKeyCreate).not.toHaveBeenCalled();
  });
});

describe("ApiKeyRepository.createConUsuario — duplicados (R11)", () => {
  function p2002(constraint: string) {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.8.0",
      meta: { target: [constraint] },
    });
  }

  it("R11: P2002 sobre usuario_email_key -> UsuarioDuplicadoError('email')", async () => {
    const { prisma } = makePrisma({
      usuarioCreate: () => {
        throw p2002("usuario_email_key");
      },
    });
    await expect(repoDe(prisma).createConUsuario(DATA)).rejects.toMatchObject({
      name: "UsuarioDuplicadoError",
      campo: "email",
    });
  });

  it("R11: P2002 sobre usuario_cedula_key -> UsuarioDuplicadoError('cedula')", async () => {
    const { prisma } = makePrisma({
      usuarioCreate: () => {
        throw p2002("usuario_cedula_key");
      },
    });
    const err = await repoDe(prisma).createConUsuario(DATA).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsuarioDuplicadoError);
  });

  it("R11: tambien disambigua bajo el driver adapter (meta.driverAdapterError)", async () => {
    const adapterErr = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.8.0",
      meta: {
        driverAdapterError: {
          cause: {
            originalMessage:
              'llave duplicada viola restriccion de unicidad «usuario_email_key»',
          },
        },
      },
    });
    const { prisma } = makePrisma({
      usuarioCreate: () => {
        throw adapterErr;
      },
    });
    await expect(repoDe(prisma).createConUsuario(DATA)).rejects.toMatchObject({ campo: "email" });
  });

  it("un error que NO es P2002 se re-lanza tal cual (no se disfraza de duplicado)", async () => {
    const { prisma } = makePrisma({
      usuarioCreate: () => {
        throw new Error("conexion perdida");
      },
    });
    await expect(repoDe(prisma).createConUsuario(DATA)).rejects.toThrow("conexion perdida");
  });
});
