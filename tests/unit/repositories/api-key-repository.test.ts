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
      usuarioId: "u-dedicado",
      createdAt: new Date("2026-07-16T12:00:00Z"),
    };
  });

  const tx = { usuario: { create: usuarioCreate }, apiKey: { create: apiKeyCreate } };

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
      ["createdAt", "id", "identificador", "keyPrefix", "usuarioId"].sort(),
    );
    expect(out).not.toHaveProperty("keyHash");
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
