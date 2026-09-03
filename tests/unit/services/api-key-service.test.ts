import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RolValue } from "@prisma/client";
import { ApiKeyService } from "@/lib/services/ApiKeyService";
import { UsuarioDuplicadoError } from "@/lib/interfaces/repositories/IUserRepository";
import type {
  CreateApiKeyConUsuarioData,
  IApiKeyRepository,
  ListApiKeysResult,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";
import { verifyPassword } from "@/lib/utils/password";
import { hashApiKey } from "@/lib/utils/api-key-hash";

// Feature 81 — ApiKeyService. Repositorio mockeado: sin DB (CHECKPOINTS.md).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

/**
 * Feature 82: `IApiKeyRepository` ahora exige `list`/`count`. En los tests de `generar`
 * no deben invocarse nunca: stubs que fallan ruidosamente en vez de devolver un vacio
 * que haria pasar un test por la razon equivocada.
 */
function listStubs(): Pick<IApiKeyRepository, "list" | "count"> {
  return {
    list: vi.fn(async (): Promise<ListApiKeysResult> => {
      throw new Error("list no debe invocarse desde generar");
    }),
    count: vi.fn(async (): Promise<number> => {
      throw new Error("count no debe invocarse desde generar");
    }),
  };
}

/**
 * Feature 302: `IApiKeyRepository` exige `findTiendaDestino`. En los tests que generan SIN
 * tienda destino no debe invocarse (el service ni siquiera lo pregunta cuando el input no la
 * trae): stub que falla ruidosamente, no uno que devuelva `null` en silencio.
 */
function tiendaDestinoStub(): Pick<IApiKeyRepository, "findTiendaDestino"> {
  return {
    findTiendaDestino: vi.fn(async () => {
      throw new Error("findTiendaDestino no debe invocarse sin tiendaDestinoId");
    }),
  };
}

/**
 * Ciclo de vida: `IApiKeyRepository` ahora exige `rotar`/`setEstado`. En los tests de
 * `generar` no deben invocarse: stubs que fallan ruidosamente.
 */
function lifecycleStubs(): Pick<IApiKeyRepository, "rotar" | "setEstado"> {
  return {
    rotar: vi.fn(async () => {
      throw new Error("rotar no debe invocarse desde generar");
    }),
    setEstado: vi.fn(async () => {
      throw new Error("setEstado no debe invocarse desde generar");
    }),
  };
}

function makeRepo() {
  const capturado: CreateApiKeyConUsuarioData[] = [];
  const repo: IApiKeyRepository = {
    ...listStubs(),
    ...lifecycleStubs(),
    ...tiendaDestinoStub(),
    createConUsuario: vi.fn(async (data: CreateApiKeyConUsuarioData) => {
      capturado.push(data);
      return {
        id: `key-${capturado.length}`,
        identificador: data.identificador,
        keyPrefix: data.keyPrefix,
        estado: "activa" as const,
        usuarioId: `u-dedicado-${capturado.length}`,
        // Feature 302: el repositorio devuelve lo que se le pidio guardar y el owner ya resuelto.
        tiendaDestinoId: data.tiendaDestinoId,
        ownerUsuarioId: data.tiendaDestinoId ?? `u-dedicado-${capturado.length}`,
        createdAt: new Date("2026-07-16T12:00:00Z"),
      };
    }),
    // Feature 88: exigido por IApiKeyRepository; no ejercitado por ApiKeyService (generar).
    findByKeyHash: vi.fn(async () => null),
  };
  return { repo, capturado };
}

describe("ApiKeyService.generar — autorizacion (R2)", () => {
  it("R2: rechaza con forbidden cuando el actor no es maestro y no crea filas", async () => {
    // Derivado del enum (no una lista literal paralela): si mañana se añade un rol,
    // este test lo cubre solo y obliga a decidir explicitamente si puede generar keys.
    const noMaestros = Object.values(RolValue).filter((r) => r !== RolValue.maestro);
    expect(noMaestros.length).toBeGreaterThan(0);
    for (const rol of noMaestros) {
      const { repo } = makeRepo();
      const service = new ApiKeyService(repo);
      const r = await service.generar({ identificador: "Tienda Uno" }, { usuarioId: "u1", rol });
      expect(r).toEqual({ status: "forbidden" });
      // No debe tocar la DB: ni usuario ni api_key.
      expect(repo.createConUsuario).not.toHaveBeenCalled();
    }
  });

  it("[D2]: el maestro si puede generar", async () => {
    const { repo } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(r.status).toBe("ok");
  });
});

describe("ApiKeyService.generar — entrada y slug (R5/R6)", () => {
  it("R5: deriva el slug normalizando acentos y simbolos", async () => {
    const { repo, capturado } = makeRepo();
    await new ApiKeyService(repo).generar({ identificador: "Almacén Ñandú S.A." }, MAESTRO);
    expect(capturado[0].slug).toBe("almacen-nandu-s-a");
  });

  it("R6: rechaza con validation_error cuando el slug queda vacio, sin crear filas", async () => {
    for (const identificador of ["!!!", "###$$$", "---"]) {
      const { repo } = makeRepo();
      const r = await new ApiKeyService(repo).generar({ identificador }, MAESTRO);
      expect(r.status).toBe("validation_error");
      if (r.status === "validation_error") {
        expect(r.fieldErrors.identificador).toBeDefined();
      }
      expect(repo.createConUsuario).not.toHaveBeenCalled();
    }
  });
});

describe("ApiKeyService.generar — usuario dedicado (R7/R8/R9/R10/R11/R12)", () => {
  it("R7: crea un usuario nuevo con el nombre derivado del identificador recibido", async () => {
    const { repo, capturado } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(capturado[0].identificador).toBe("Tienda Uno");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.apiKey.usuarioId).toBe("u-dedicado-1");
  });

  it("R8: persiste solo el hash bcrypt de una contrasena aleatoria distinta cada vez", async () => {
    const { repo, capturado } = makeRepo();
    const service = new ApiKeyService(repo);
    await service.generar({ identificador: "Tienda Uno" }, MAESTRO);
    await service.generar({ identificador: "Tienda Dos" }, MAESTRO);

    for (const data of capturado) {
      // bcrypt cost 10 => prefijo $2a$/$2b$ y 60 chars. NUNCA texto plano.
      expect(data.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(data.passwordHash).toHaveLength(60);
    }
    // R8: la contrasena es distinta en cada generacion (hashes bcrypt salados distintos).
    expect(capturado[0].passwordHash).not.toBe(capturado[1].passwordHash);
  });

  it("R9: el resultado no contiene la contrasena en claro del usuario dedicado", async () => {
    const { repo, capturado } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(r.status).toBe("ok");
    // El unico secreto que sale es la KEY. La contrasena no se expone por ningun campo.
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain(capturado[0].passwordHash);
    if (r.status === "ok") {
      expect(Object.keys(r)).toEqual(["status", "apiKey", "plainKey"]);
      // Y la contrasena en claro no es recuperable: nada en el resultado la verifica.
      expect(await verifyPassword(r.plainKey, capturado[0].passwordHash)).toBe(false);
    }
  });

  it("R10: deriva email y cedula al espacio de nombres reservado de api keys", async () => {
    const { repo, capturado } = makeRepo();
    await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(capturado[0].email).toBe("apikey+tienda-uno@apikey.invalid");
    expect(capturado[0].cedula).toBe("APIKEY-tienda-uno");
  });

  it("R11: devuelve conflict cuando el email derivado ya existe", async () => {
    const repo: IApiKeyRepository = {
      ...listStubs(),
      ...lifecycleStubs(),
      ...tiendaDestinoStub(),
      createConUsuario: vi.fn(async () => {
        throw new UsuarioDuplicadoError("email");
      }),
      findByKeyHash: vi.fn(async () => null),
    };
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(r).toEqual({ status: "conflict", campo: "email" });
  });

  it("R11: devuelve conflict cuando la cedula derivada ya existe", async () => {
    const repo: IApiKeyRepository = {
      ...listStubs(),
      ...lifecycleStubs(),
      ...tiendaDestinoStub(),
      createConUsuario: vi.fn(async () => {
        throw new UsuarioDuplicadoError("cedula");
      }),
      findByKeyHash: vi.fn(async () => null),
    };
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(r).toEqual({ status: "conflict", campo: "cedula" });
  });

  it("R12: el rol [D1] y el estado [D5] los fija el repositorio, no el borde", async () => {
    // El service NO acepta rol/estado desde el input: no existen en el contrato. El
    // repositorio los resuelve (rol 'apiKey' por lookup, estado 'activo').
    const { repo, capturado } = makeRepo();
    await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(capturado[0]).not.toHaveProperty("rolId");
    expect(capturado[0]).not.toHaveProperty("estado");
    // Contrato: los campos que SI viajan son exactamente estos.
    expect(Object.keys(capturado[0]).sort()).toEqual(
      [
        "cedula",
        "createdById",
        "email",
        "identificador",
        "keyHash",
        "keyPrefix",
        "passwordHash",
        "slug",
        "tiendaDestinoId", // feature 302: la tienda a cuyo nombre cargara la key (o null)
      ].sort(),
    );
  });
});

describe("ApiKeyService.generar — atomicidad (R13)", () => {
  it("R13: si la creacion transaccional falla, no devuelve ok ni filtra el secreto", async () => {
    const repo: IApiKeyRepository = {
      ...listStubs(),
      ...lifecycleStubs(),
      ...tiendaDestinoStub(),
      createConUsuario: vi.fn(async () => {
        throw new Error("transaccion abortada");
      }),
      findByKeyHash: vi.fn(async () => null),
    };
    // El fallo escala: no hay estado parcial que reportar como ok.
    await expect(
      new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO),
    ).rejects.toThrow("transaccion abortada");
  });

  it("R13: la creacion del usuario y de la key ocurre en UNA sola llamada al repo", async () => {
    // El contrato de una sola llamada es lo que permite envolver ambos INSERT en una
    // unica `$transaction` (la atomicidad real se verifica en el repo/DB).
    const { repo } = makeRepo();
    await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(repo.createConUsuario).toHaveBeenCalledTimes(1);
  });
});

describe("ApiKeyService.generar — la key (R14..R22)", () => {
  it("R14/R15: genera un secreto de 256 bits con el prefijo ordx_", async () => {
    const { repo } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.plainKey).toMatch(/^ordx_[A-Za-z0-9_-]{43}$/);
    }
  });

  it("R16: persiste el hash SHA-256 de la key y NUNCA el secreto en claro", async () => {
    const { repo, capturado } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    expect(capturado[0].keyHash).toBe(hashApiKey(r.plainKey));
    expect(capturado[0].keyHash).toMatch(/^[0-9a-f]{64}$/);
    // Nada de lo que viaja al repositorio contiene el secreto en claro.
    expect(JSON.stringify(capturado[0])).not.toContain(r.plainKey);
  });

  it("R17: persiste un key_prefix no secreto, consistente con la key devuelta", async () => {
    const { repo, capturado } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(capturado[0].keyPrefix).toBe(r.plainKey.slice(0, 12));
    expect(r.apiKey.keyPrefix).toBe(capturado[0].keyPrefix);
    // El prefijo NO permite reconstruir el secreto.
    expect(capturado[0].keyPrefix.length).toBeLessThan(r.plainKey.length);
  });

  it("R18: devuelve el secreto en claro exactamente UNA vez, en esta respuesta", async () => {
    const { repo } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(typeof r.plainKey).toBe("string");
    // El secreto vive SOLO en `plainKey`: el objeto publico no lo repite ni lo filtra.
    expect(JSON.stringify(r.apiKey)).not.toContain(r.plainKey);
  });

  it("R19: el objeto publico no expone el hash ni ninguna lectura del secreto", async () => {
    const { repo } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.apiKey).not.toHaveProperty("keyHash");
    expect(r.apiKey).not.toHaveProperty("plainKey");
    expect(Object.keys(r.apiKey).sort()).toEqual(
      [
        "createdAt",
        "estado",
        "id",
        "identificador",
        "keyPrefix",
        "ownerUsuarioId", // feature 302: dueno de las ordenes, ya resuelto (no es un secreto)
        "tiendaDestinoId", // feature 302
        "usuarioId",
      ].sort(),
    );
    // [82] La irrecuperabilidad del secreto A NIVEL DEL REPOSITORIO se verifica ahora en
    // `tests/unit/repositories/api-key-repository.secreto.test.ts`, contra la clase real
    // y afirmando sobre lo que cada operacion DEVUELVE. Aqui se elimino
    // `expect(Object.keys(repo)).toEqual(["createConUsuario"])`: medía la CARDINALIDAD de
    // la interfaz (que la 82 amplio legitimamente con `list`/`count`, ninguno de los
    // cuales lee el secreto), no la INTENCION de R19 —la irrecuperabilidad del secreto—;
    // ademas corría sobre el mock, no sobre la clase. El guard nuevo es estrictamente mas
    // fuerte: caza una fuga en CUALQUIER operacion, presente o futura.
    //
    // [88] Al mergear `dev`, la variante por cardinalidad que traia esta rama
    // (`toEqual(["createConUsuario", "findByKeyHash"])`) se DESCARTA a favor de la de
    // arriba: es la mas fuerte de las dos y ademas corre sobre la clase real, no sobre el
    // mock. No se pierde cobertura — `findByKeyHash` queda sujeto a la asercion de fuga
    // por estar registrado en INVOCACIONES de ese guard, que exige cubrir TODO metodo del
    // prototipo, asi que un metodo nuevo sigue sin poder entrar en silencio.
  });

  it("R21: registra el usuario dedicado, el actor que la genero y la fecha de creacion", async () => {
    const { repo, capturado } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(capturado[0].createdById).toBe(MAESTRO.usuarioId); // actor
    expect(r.apiKey.usuarioId).toBe("u-dedicado-1"); // cuenta dedicada
    expect(r.apiKey.createdAt).toBeInstanceOf(Date); // fecha
  });

  it("R22: dos generaciones con el MISMO identificador dan secretos y hashes distintos", async () => {
    const { repo, capturado } = makeRepo();
    const service = new ApiKeyService(repo);
    const a = await service.generar({ identificador: "Tienda Uno" }, MAESTRO);
    const b = await service.generar({ identificador: "Tienda Uno" }, MAESTRO);
    if (a.status !== "ok" || b.status !== "ok") throw new Error("esperaba ok");
    expect(a.plainKey).not.toBe(b.plainKey);
    expect(capturado[0].keyHash).not.toBe(capturado[1].keyHash);
    // El slug si es el mismo: la unicidad efectiva la impone usuario.email (R11).
    expect(capturado[0].slug).toBe(capturado[1].slug);
  });
});

describe("ApiKeyService.generar — no filtra secretos por logs (R9/R20)", () => {
  const metodos = ["log", "info", "warn", "error", "debug", "trace"] as const;
  const espias: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    for (const m of metodos) espias.push(vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    espias.length = 0;
  });

  it("R20: no loguea el secreto en claro ni su hash en ningun nivel", async () => {
    const { repo, capturado } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    const salida = espias
      .flatMap((e) => e.mock.calls)
      .flat()
      .map((a) => String(a))
      .join(" ");
    expect(salida).not.toContain(r.plainKey);
    expect(salida).not.toContain(capturado[0].keyHash);
    expect(salida).not.toContain(capturado[0].passwordHash);
    // De hecho, el service no loguea NADA en el camino feliz.
    for (const e of espias) expect(e).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Ciclo de vida — rotar / activar / desactivar
// ---------------------------------------------------------------------------

/** Forma publica que devuelve el repo de rotar/setEstado (con `estado`, sin keyHash). */
function apiKeyPublico(estado: "activa" | "inactiva" = "activa") {
  return {
    id: "key-1",
    identificador: "Tienda Uno",
    keyPrefix: "ordx_abc1234",
    estado: estado as "activa" | "inactiva",
    usuarioId: "u-dedicado-1",
    tiendaDestinoId: null, // feature 302: key sin tienda destino
    ownerUsuarioId: "u-dedicado-1",
    createdAt: new Date("2026-07-16T12:00:00Z"),
  };
}

/**
 * Repo para el ciclo de vida. `rotar`/`setEstado` devuelven la forma publica (o null si
 * `notFound`). El resto de metodos lanza: no deben tocarse desde estas operaciones.
 */
function makeLifecycleRepo(opts: { notFound?: boolean } = {}) {
  const repo: IApiKeyRepository = {
    createConUsuario: vi.fn(async () => {
      throw new Error("createConUsuario no debe invocarse desde el ciclo de vida");
    }),
    findByKeyHash: vi.fn(async () => {
      throw new Error("findByKeyHash no debe invocarse desde el ciclo de vida");
    }),
    ...tiendaDestinoStub(),
    ...listStubs(),
    rotar: vi.fn(async () => (opts.notFound ? null : apiKeyPublico())),
    setEstado: vi.fn(async (_id: string, estado: "activa" | "inactiva") =>
      opts.notFound ? null : apiKeyPublico(estado),
    ),
  };
  return repo;
}

describe("ApiKeyService — ciclo de vida: autorizacion (R1)", () => {
  it.each(["rotar", "activar", "desactivar"] as const)(
    "R1: %s rechaza con forbidden a todo rol != maestro, sin tocar la DB",
    async (metodo) => {
      const noMaestros = Object.values(RolValue).filter((r) => r !== RolValue.maestro);
      for (const rol of noMaestros) {
        const repo = makeLifecycleRepo();
        const service = new ApiKeyService(repo);
        const r = await service[metodo]({ id: "key-1" }, { usuarioId: "u1", rol });
        expect(r).toEqual({ status: "forbidden" });
        expect(repo.rotar).not.toHaveBeenCalled();
        expect(repo.setEstado).not.toHaveBeenCalled();
      }
    },
  );
});

describe("ApiKeyService.rotar (R2/R3)", () => {
  it("R2: genera un secreto nuevo, persiste solo su hash y lo devuelve en claro UNA vez", async () => {
    const repo = makeLifecycleRepo();
    const r = await new ApiKeyService(repo).rotar({ id: "key-1" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // El secreto en claro nuevo con el formato de la 81.
    expect(r.plainKey).toMatch(/^ordx_[A-Za-z0-9_-]{43}$/);
    // El repo recibe keyPrefix+keyHash derivados del secreto; el hash es SHA-256 del claro.
    const args = (repo.rotar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[0]).toBe("key-1");
    expect(args[1].keyHash).toBe(hashApiKey(r.plainKey));
    expect(args[1].keyPrefix).toBe(r.plainKey.slice(0, 12));
    // El claro NO viaja al repo (solo su hash) ni se repite en el objeto publico.
    expect(JSON.stringify(args[1])).not.toContain(r.plainKey);
    expect(JSON.stringify(r.apiKey)).not.toContain(r.plainKey);
  });

  it("R2: no cambia el usuario dedicado ni el estado (el repo no recibe esos campos)", async () => {
    const repo = makeLifecycleRepo();
    await new ApiKeyService(repo).rotar({ id: "key-1" }, MAESTRO);
    const args = (repo.rotar as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["keyHash", "keyPrefix"].sort());
  });

  it("R3: id inexistente -> not_found (el repo devuelve null)", async () => {
    const repo = makeLifecycleRepo({ notFound: true });
    const r = await new ApiKeyService(repo).rotar({ id: "no-existe" }, MAESTRO);
    expect(r).toEqual({ status: "not_found" });
  });
});

describe("ApiKeyService.activar / desactivar (R3/R4)", () => {
  it("R4: activar fija estado='activa' y devuelve la key publica actualizada", async () => {
    const repo = makeLifecycleRepo();
    const r = await new ApiKeyService(repo).activar({ id: "key-1" }, MAESTRO);
    expect(repo.setEstado).toHaveBeenCalledWith("key-1", "activa", expect.any(String)); // 362
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.apiKey.estado).toBe("activa");
  });

  it("R4: desactivar fija estado='inactiva' y devuelve la key publica actualizada", async () => {
    const repo = makeLifecycleRepo();
    const r = await new ApiKeyService(repo).desactivar({ id: "key-1" }, MAESTRO);
    expect(repo.setEstado).toHaveBeenCalledWith("key-1", "inactiva", expect.any(String)); // 362
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.apiKey.estado).toBe("inactiva");
  });

  it("R4: activar es idempotente — activar una key ya activa es ok", async () => {
    // El repo (Postgres) trata fijar el estado actual como no-op valido; el service no
    // distingue ni exige un estado previo: siempre devuelve ok con la fila resultante.
    const repo = makeLifecycleRepo();
    const r = await new ApiKeyService(repo).activar({ id: "key-1" }, MAESTRO);
    expect(r.status).toBe("ok");
  });

  it("R3: activar/desactivar de un id inexistente -> not_found", async () => {
    const repo = makeLifecycleRepo({ notFound: true });
    const service = new ApiKeyService(repo);
    expect(await service.activar({ id: "x" }, MAESTRO)).toEqual({ status: "not_found" });
    expect(await service.desactivar({ id: "x" }, MAESTRO)).toEqual({ status: "not_found" });
  });

  it("R4: la key publica devuelta nunca expone keyHash ni secreto", async () => {
    const repo = makeLifecycleRepo();
    const r = await new ApiKeyService(repo).desactivar({ id: "key-1" }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.apiKey).not.toHaveProperty("keyHash");
    expect(JSON.stringify(r)).not.toContain("keyHash");
  });
});
