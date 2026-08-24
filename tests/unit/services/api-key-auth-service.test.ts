import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiKeyAuthService } from "@/lib/services/ApiKeyAuthService";
import type {
  ApiKeyAutenticada,
  IApiKeyRepository,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
import { hashApiKey } from "@/lib/utils/api-key-hash";

// Feature 88 — ApiKeyAuthService.autenticar. Repo mockeado: sin DB (CHECKPOINTS.md).

const RAW_KEY = "ordx_secretovivo1234567890";

function makeRepo(findResult: ApiKeyAutenticada | null): IApiKeyRepository {
  return {
    createConUsuario: vi.fn(),
    findByKeyHash: vi.fn(async () => findResult),
    // [88+82] `list`/`count` llegaron con la feature 82 al mergear `dev`. La autenticacion
    // no debe tocarlas: lanzan para que, si algun dia las invocara, el test lo delate en
    // vez de pasar en silencio.
    list: vi.fn(async () => {
      throw new Error("list no debe invocarse desde la autenticacion");
    }),
    count: vi.fn(async () => {
      throw new Error("count no debe invocarse desde la autenticacion");
    }),
    // Ciclo de vida: la autenticacion es de solo lectura; nunca escribe.
    rotar: vi.fn(async () => {
      throw new Error("rotar no debe invocarse desde la autenticacion");
    }),
    setEstado: vi.fn(async () => {
      throw new Error("setEstado no debe invocarse desde la autenticacion");
    }),
  };
}

function activa(overrides: Partial<ApiKeyAutenticada> = {}): ApiKeyAutenticada {
  return {
    apiKeyId: "key-1",
    usuarioId: "u-dedicado-1",
    estado: "activo",
    apiKeyEstado: "activa",
    rol: "apiKey",
    ...overrides,
  };
}

describe("ApiKeyAuthService.autenticar — sin secreto (R2)", () => {
  it("rawKey null -> unauthenticated SIN tocar la DB", async () => {
    const repo = makeRepo(null);
    const r = await new ApiKeyAuthService(repo).autenticar(null);
    expect(r).toEqual({ status: "unauthenticated" });
    expect(repo.findByKeyHash).not.toHaveBeenCalled();
  });

  it("rawKey vacio/espacios -> unauthenticated SIN tocar la DB", async () => {
    const repo = makeRepo(null);
    const r = await new ApiKeyAuthService(repo).autenticar("   ");
    expect(r).toEqual({ status: "unauthenticated" });
    expect(repo.findByKeyHash).not.toHaveBeenCalled();
  });
});

describe("ApiKeyAuthService.autenticar — lookup por hash (R3/R4)", () => {
  it("R3: busca por el hash SHA-256 hex del secreto (mismo hashApiKey de la 81), nunca en claro", async () => {
    const repo = makeRepo(activa());
    await new ApiKeyAuthService(repo).autenticar(RAW_KEY);
    // El argumento pasado al repo es EXACTAMENTE hashApiKey(rawKey), no el secreto.
    expect(repo.findByKeyHash).toHaveBeenCalledWith(hashApiKey(RAW_KEY));
    const arg = (repo.findByKeyHash as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).not.toBe(RAW_KEY);
    expect(arg).toMatch(/^[0-9a-f]{64}$/);
  });

  it("R4: ninguna fila coincide -> unauthenticated", async () => {
    const repo = makeRepo(null);
    const r = await new ApiKeyAuthService(repo).autenticar(RAW_KEY);
    expect(r).toEqual({ status: "unauthenticated" });
  });
});

describe("ApiKeyAuthService.autenticar — estado del usuario (R5)", () => {
  it.each(["pendiente", "inactivo", "bloqueado"] as const)(
    "estado %s -> forbidden (palanca de revocacion)",
    async (estado) => {
      const repo = makeRepo(activa({ estado }));
      const r = await new ApiKeyAuthService(repo).autenticar(RAW_KEY);
      expect(r).toEqual({ status: "forbidden" });
    },
  );

  it("R3/R5: usuario activo -> ok con el actor del usuario dedicado", async () => {
    const repo = makeRepo(activa({ usuarioId: "u-dedicado-9", rol: "apiKey", apiKeyId: "key-9" }));
    const r = await new ApiKeyAuthService(repo).autenticar(RAW_KEY);
    expect(r).toEqual({
      status: "ok",
      apiKeyId: "key-9",
      actor: { usuarioId: "u-dedicado-9", rol: "apiKey" },
    });
  });
});

describe("ApiKeyAuthService.autenticar — estado PROPIO de la key (R7)", () => {
  it("R7: key desactivada (apiKeyEstado='inactiva') -> forbidden aunque el usuario este activo", async () => {
    // El usuario dedicado SIGUE activo; la revocacion vive en el estado de la key.
    const repo = makeRepo(activa({ estado: "activo", apiKeyEstado: "inactiva" }));
    const r = await new ApiKeyAuthService(repo).autenticar(RAW_KEY);
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R7: key activa + usuario activo -> ok", async () => {
    const repo = makeRepo(activa({ estado: "activo", apiKeyEstado: "activa" }));
    const r = await new ApiKeyAuthService(repo).autenticar(RAW_KEY);
    expect(r.status).toBe("ok");
  });

  it("R5+R7: usuario no activo Y key inactiva -> forbidden (cualquiera de las dos palancas basta)", async () => {
    const repo = makeRepo(activa({ estado: "bloqueado", apiKeyEstado: "inactiva" }));
    const r = await new ApiKeyAuthService(repo).autenticar(RAW_KEY);
    expect(r).toEqual({ status: "forbidden" });
  });
});

describe("ApiKeyAuthService.autenticar — rol del usuario dedicado (267, defensa en profundidad)", () => {
  // El actor se construia con un CAST del rol de la fila (`encontrada.rol as RolValue`), sin
  // comprobar nada, pese a que `ApiKeyAutenticada.rol` documenta que «el service revalida».
  // El alta de una key SIEMPRE fija el rol `apiKey` por lookup
  // (`ApiKeyRepository.createConUsuario`), asi que una fila con otro rol es una cuenta mal
  // configurada: en una frontera multi-tenant eso CIERRA el canal, no lo amplia.
  it.each(["maestro", "admin", "adminTienda", "adminSatelite", "mensajero", "", "APIKEY"])(
    "una fila cuyo usuario dedicado tiene rol %s -> forbidden, aunque todo lo demas este activo",
    async (rol) => {
      const repo = makeRepo(activa({ estado: "activo", apiKeyEstado: "activa", rol }));
      const r = await new ApiKeyAuthService(repo).autenticar(RAW_KEY);
      expect(r).toEqual({ status: "forbidden" });
    },
  );

  it("y el rol correcto sigue concediendo: la guarda no cierra el canal entero", async () => {
    const repo = makeRepo(activa({ estado: "activo", apiKeyEstado: "activa", rol: "apiKey" }));
    const r = await new ApiKeyAuthService(repo).autenticar(RAW_KEY);
    expect(r.status).toBe("ok");
  });

  it("el forbidden por rol es INDISTINGUIBLE del de una key revocada", async () => {
    const porRol = await new ApiKeyAuthService(makeRepo(activa({ rol: "maestro" }))).autenticar(
      RAW_KEY,
    );
    const porRevocacion = await new ApiKeyAuthService(
      makeRepo(activa({ apiKeyEstado: "inactiva" })),
    ).autenticar(RAW_KEY);
    expect(porRol).toEqual(porRevocacion);
  });
});

describe("ApiKeyAuthService.autenticar — seguridad (R6)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("no loguea el secreto ni su hash en ninguna ruta (ok/unauthenticated/forbidden)", async () => {
    const hash = hashApiKey(RAW_KEY);
    await new ApiKeyAuthService(makeRepo(activa())).autenticar(RAW_KEY); // ok
    await new ApiKeyAuthService(makeRepo(null)).autenticar(RAW_KEY); // unauthenticated
    await new ApiKeyAuthService(makeRepo(activa({ estado: "bloqueado" }))).autenticar(RAW_KEY); // forbidden

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const texto = call.map((a: unknown) => String(a)).join(" ");
        expect(texto).not.toContain(RAW_KEY);
        expect(texto).not.toContain(hash);
      }
    }
  });
});
