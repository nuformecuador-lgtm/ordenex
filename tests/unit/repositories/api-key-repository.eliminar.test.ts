import { describe, it, expect, vi } from "vitest";
import { Prisma, type EstadoApiKey } from "@prisma/client";

import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 373 / C2 (R2/R3/R11/R15/R21/R22/R24) — EL ORDEN DE LA TRANSACCION, CON UN DOBLE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** PRUEBA, y conviene decirlo antes que nada: el `WHERE`. Un doble no
// ve el SQL — esta MEDIDO cuatro veces en este repo que una mutacion del `WHERE` deja los tests de
// doble en verde—. Por eso el guard de esta ficha (los `EXISTS`) y el borrado real viven en
// `tests/integration/db/api-key-eliminabilidad.test.ts` y `…/api-key-eliminar.test.ts`, contra
// Postgres de verdad.
//
// LO QUE SI PRUEBA, y solo se puede probar aqui: EL ORDEN. Que la lectura y el guard van ANTES de
// la primera escritura (R15), que una key `activa` no llega ni a ejecutar el `EXISTS` (R11), y que
// no se toca ninguna tabla que no sea de esa key (R3).

const ID = "11111111-1111-1111-1111-111111111111";
const USUARIO = "u-dedicado-1";
const ACTOR = "u-maestro";

interface OpcionesDoble {
  /** `null` = la key no existe (R21). */
  fila?: { id: string; identificador: string; estado: EstadoApiKey; usuarioId: string } | null;
  /** Lo que devuelve el `EXISTS` para la cuenta dedicada. */
  dependencias?: { ordenes: boolean; dinero: boolean; tarifas: boolean };
  /** Error que lanza `apiKey.delete` (para probar el mapeo de P2025/P2003). */
  errorAlBorrar?: unknown;
}

function makePrisma(opts: OpcionesDoble = {}) {
  const fila =
    opts.fila === undefined
      ? { id: ID, identificador: "integracion-erp", estado: "inactiva" as EstadoApiKey, usuarioId: USUARIO }
      : opts.fila;
  const dependencias = opts.dependencias ?? { ordenes: false, dinero: false, tarifas: false };

  /** El registro ORDENADO de todo lo que el repositorio le pidio al cliente. */
  const llamadas: string[] = [];
  const anota = <T>(nombre: string, valor: T) => {
    llamadas.push(nombre);
    return valor;
  };

  const doble = {
    apiKey: {
      findUnique: vi.fn(async () => anota("apiKey.findUnique", fila)),
      delete: vi.fn(async () => {
        llamadas.push("apiKey.delete");
        if (opts.errorAlBorrar) throw opts.errorAlBorrar;
        return { id: ID };
      }),
      // Ni `update` ni `create` deben tocarse: eliminar no reescribe nada.
      update: vi.fn(async () => anota("apiKey.update", {})),
      create: vi.fn(async () => anota("apiKey.create", {})),
    },
    usuario: {
      delete: vi.fn(async () => anota("usuario.delete", { id: USUARIO })),
      // Lo consulta `resolverActorCongelado` para congelar nombre y rol (R24).
      findUnique: vi.fn(async () =>
        anota("usuario.findUnique", {
          nombre: "Ana",
          primerApellido: "Solis",
          rol: { value: "maestro" },
        }),
      ),
      update: vi.fn(async () => anota("usuario.update", {})),
    },
    webhookSuscripcion: {
      deleteMany: vi.fn(async () => anota("webhookSuscripcion.deleteMany", { count: 1 })),
    },
    historialAccion: {
      createMany: vi.fn(async () => anota("historialAccion.createMany", { count: 1 })),
    },
    $queryRaw: vi.fn(async () =>
      anota("$queryRaw", [{ usuarioId: USUARIO, ...dependencias }]),
    ),
    $transaction: vi.fn(async (fn: unknown) => {
      llamadas.push("$transaction");
      return typeof fn === "function" ? await (fn as (tx: unknown) => unknown)(doble) : undefined;
    }),
  };

  return { prisma: doble as never, doble, llamadas };
}

/** Las filas que se le pasaron a `historialAccion.createMany`. */
function filasDeRegistro(doble: ReturnType<typeof makePrisma>["doble"]) {
  const llamadas = doble.historialAccion.createMany.mock.calls as unknown as {
    data?: Record<string, unknown>[];
  }[][];
  return llamadas[0]?.[0]?.data ?? [];
}

function errorPrisma(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("forzado por el test", {
    code,
    clientVersion: "test",
  });
}

describe("373/R15 — el guard se evalua DENTRO de la tx y ANTES de cualquier escritura", () => {
  it("⭑ el orden de llamadas es: leer → guard → actor → borrar → registrar", async () => {
    const { prisma, llamadas } = makePrisma();
    const r = await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    expect(r).toEqual({ status: "ok", identificador: "integracion-erp" });
    expect(llamadas).toEqual([
      "$transaction",
      "apiKey.findUnique", // 1 — congela identificador y estado antes de que dejen de existir
      "$queryRaw", // 2 — el guard, dentro de la tx
      "usuario.findUnique", // 3 — actor congelado
      "webhookSuscripcion.deleteMany", // 4
      "apiKey.delete", // 5 — antes que el usuario: `api_key.usuario_id` es Restrict
      "usuario.delete", // 6 — libera email y cedula sinteticos (R6)
      "historialAccion.createMany", // 7 — en ESTA transaccion (R22)
    ]);
  });

  it("⭑ el guard va antes que la PRIMERA escritura, no solo antes del `delete`", async () => {
    // La mutacion que caza: mover el `EXISTS` detras del `deleteMany` del webhook «porque el
    // webhook se borra igual». Eso ya seria un efecto de un borrado que se va a rechazar.
    const { prisma, llamadas } = makePrisma();
    await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    const escrituras = ["webhookSuscripcion.deleteMany", "apiKey.delete", "usuario.delete"];
    const primeraEscritura = Math.min(...escrituras.map((e) => llamadas.indexOf(e)));
    expect(llamadas.indexOf("$queryRaw")).toBeLessThan(primeraEscritura);
    expect(llamadas.indexOf("apiKey.findUnique")).toBeLessThan(primeraEscritura);
  });

  it("todo ocurre DENTRO del callback de `$transaction` (R2/R4)", async () => {
    const { prisma, doble } = makePrisma();
    await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);
    expect(doble.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("373/R11 — una key `activa` no llega ni a preguntar por sus datos", () => {
  it("⭑ corta con `bloqueada` SIN ejecutar el `EXISTS` y sin escribir nada", async () => {
    const { prisma, doble, llamadas } = makePrisma({
      fila: { id: ID, identificador: "integracion-erp", estado: "activa", usuarioId: USUARIO },
    });
    const r = await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    expect(r).toEqual({
      status: "bloqueada",
      estado: "activa",
      dependencias: { ordenes: false, dinero: false, tarifas: false },
    });
    // Coste cero: no se pregunta por las dependencias de una key que ya esta bloqueada.
    expect(doble.$queryRaw).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["$transaction", "apiKey.findUnique"]);
  });

  it("cero escrituras: ni webhook, ni key, ni usuario, ni fila de registro", async () => {
    const { prisma, doble } = makePrisma({
      fila: { id: ID, identificador: "integracion-erp", estado: "activa", usuarioId: USUARIO },
    });
    await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    expect(doble.webhookSuscripcion.deleteMany).not.toHaveBeenCalled();
    expect(doble.apiKey.delete).not.toHaveBeenCalled();
    expect(doble.usuario.delete).not.toHaveBeenCalled();
    expect(doble.historialAccion.createMany).not.toHaveBeenCalled();
  });
});

describe("373/R12 — bloqueada por datos: se sale sin haber escrito", () => {
  it.each([
    ["ordenes", { ordenes: true, dinero: false, tarifas: false }],
    ["dinero", { ordenes: false, dinero: true, tarifas: false }],
    ["tarifas", { ordenes: false, dinero: false, tarifas: true }],
  ] as const)("con %s -> bloqueada y CERO escrituras", async (_nombre, dependencias) => {
    const { prisma, doble } = makePrisma({ dependencias });
    const r = await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    expect(r).toEqual({ status: "bloqueada", estado: "inactiva", dependencias });
    expect(doble.webhookSuscripcion.deleteMany).not.toHaveBeenCalled();
    expect(doble.apiKey.delete).not.toHaveBeenCalled();
    expect(doble.usuario.delete).not.toHaveBeenCalled();
    expect(doble.historialAccion.createMany).not.toHaveBeenCalled();
  });

  it("el repositorio NO clasifica: devuelve estado y dependencias crudos", async () => {
    // La regla vive en el servicio (docs/architecture.md). Si el repositorio devolviera un
    // «motivo», habria dos traducciones capaces de divergir.
    const { prisma } = makePrisma({ dependencias: { ordenes: true, dinero: true, tarifas: true } });
    const r = await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);
    expect(r).not.toHaveProperty("motivo");
  });
});

describe("373/R3 — se borra EXACTAMENTE lo de esa key y nada mas", () => {
  it("⭑ el webhook se borra acotado a la CUENTA DEDICADA, no por cualquier otro criterio", async () => {
    // La mutacion que caza: quitarle el `where` al `deleteMany`, que se llevaria por delante las
    // suscripciones de todo el mundo. El `WHERE` real se mide ademas contra Postgres.
    const { prisma, doble } = makePrisma();
    await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    expect(doble.webhookSuscripcion.deleteMany).toHaveBeenCalledWith({
      where: { ownerUsuarioId: USUARIO },
    });
  });

  it("los dos `delete` van por id, y por el de ESTA key y SU cuenta", async () => {
    const { prisma, doble } = makePrisma();
    await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    expect(doble.apiKey.delete).toHaveBeenCalledWith({ where: { id: ID } });
    expect(doble.usuario.delete).toHaveBeenCalledWith({ where: { id: USUARIO } });
  });

  it("no se ACTUALIZA nada: eliminar no es un cambio de estado encubierto", async () => {
    const { prisma, doble } = makePrisma();
    await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    expect(doble.apiKey.update).not.toHaveBeenCalled();
    expect(doble.usuario.update).not.toHaveBeenCalled();
    expect(doble.apiKey.create).not.toHaveBeenCalled();
  });
});

describe("373/R22/R23/R24 — la fila de auditoria", () => {
  it("⭑ escribe EXACTAMENTE UNA fila, con la accion y la entidad de la ficha", async () => {
    const { prisma, doble } = makePrisma();
    await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    const filas = filasDeRegistro(doble);
    expect(filas).toHaveLength(1);
    expect(filas[0].accion).toBe("api_key_eliminada");
    expect(filas[0].entidadTipo).toBe("api_key");
    expect(filas[0].entidadId).toBe(ID);
  });

  it("⭑ R23: la etiqueta es el IDENTIFICADOR visible; no hay hash, prefijo ni email", async () => {
    const { prisma, doble } = makePrisma();
    await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    const fila = filasDeRegistro(doble)[0];
    expect(String(fila.entidadEtiqueta)).toContain("integracion-erp");
    const serializada = JSON.stringify(fila);
    expect(serializada).not.toContain("ordx_");
    expect(serializada).not.toContain("keyHash");
    expect(serializada).not.toContain("key_hash");
    expect(serializada).not.toContain("apikey.invalid");
  });

  it("R24: congela nombre y rol del actor, y lleva el estado PREVIO en `valorAnterior`", async () => {
    const { prisma, doble } = makePrisma();
    await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    const fila = filasDeRegistro(doble)[0];
    expect(fila.actorUsuarioId).toBe(ACTOR);
    expect(fila.actorNombre).toBe("Ana Solis");
    expect(fila.actorRol).toBe("maestro");
    expect(fila.valorAnterior).toBe("inactiva");
    expect(fila.valorNuevo).toBeNull();
  });
});

describe("373/R21/R16 — los desenlaces que no son ni `ok` ni el guard", () => {
  it("R21: id inexistente -> `not_found`, sin escribir y sin lanzar", async () => {
    const { prisma, doble, llamadas } = makePrisma({ fila: null });
    const r = await new ApiKeyRepository(prisma).eliminar(ID, ACTOR);

    expect(r).toEqual({ status: "not_found" });
    expect(llamadas).toEqual(["$transaction", "apiKey.findUnique"]);
    expect(doble.historialAccion.createMany).not.toHaveBeenCalled();
  });

  it("R21: un P2025 en el borrado (carrera) tambien es `not_found`, no un 500", async () => {
    const { prisma } = makePrisma({ errorAlBorrar: errorPrisma("P2025") });
    expect(await new ApiKeyRepository(prisma).eliminar(ID, ACTOR)).toEqual({
      status: "not_found",
    });
  });

  it("⭑ R16: un P2003 (FK que el guard no mira) -> `bloqueada` sin diagnostico", async () => {
    const { prisma } = makePrisma({ errorAlBorrar: errorPrisma("P2003") });
    expect(await new ApiKeyRepository(prisma).eliminar(ID, ACTOR)).toEqual({
      status: "bloqueada",
      estado: null,
      dependencias: null,
    });
  });

  it("⭑⭑ R16: la forma REAL del error bajo el driver adapter tambien es `bloqueada`", async () => {
    // ⚠️ MEDIDO EL 2026-09-04 CONTRA POSTGRES: con `@prisma/adapter-pg` una violacion de FK
    // `RESTRICT` NO llega como `PrismaClientKnownRequestError` P2003. Llega como
    // `DriverAdapterError` con `cause.code = "23001"` y SIN codigo de Prisma. Con el detector
    // ingenuo (`code === "P2003"`), este `catch` no la veria y R16 seria un 500.
    const comoLlegaDeVerdad = Object.assign(
      new Error(
        'update or delete on table "usuario" violates RESTRICT setting of foreign key constraint ' +
          '"orden_habilitacion_api_actor_usuario_id_fkey" on table "orden_habilitacion_api"',
      ),
      { name: "DriverAdapterError", cause: { code: "23001" } },
    );
    const { prisma } = makePrisma({ errorAlBorrar: comoLlegaDeVerdad });
    expect(await new ApiKeyRepository(prisma).eliminar(ID, ACTOR)).toEqual({
      status: "bloqueada",
      estado: null,
      dependencias: null,
    });
  });

  it("R16: la otra forma (`23503`, FK diferida o NO ACTION) tambien es `bloqueada`", async () => {
    const otra = Object.assign(new Error("foreign key violation"), {
      name: "DriverAdapterError",
      cause: { code: "23503" },
    });
    const { prisma } = makePrisma({ errorAlBorrar: otra });
    expect((await new ApiKeyRepository(prisma).eliminar(ID, ACTOR)).status).toBe("bloqueada");
  });

  it("un SQLSTATE que NO es de FK se propaga (no se disfraza de `bloqueada`)", async () => {
    // `40001` es un fallo de serializacion: reintentable, y desde luego no «tiene datos».
    const otro = Object.assign(new Error("could not serialize access"), {
      name: "DriverAdapterError",
      cause: { code: "40001" },
    });
    const { prisma } = makePrisma({ errorAlBorrar: otro });
    await expect(new ApiKeyRepository(prisma).eliminar(ID, ACTOR)).rejects.toThrow(
      "could not serialize access",
    );
  });

  it("cualquier otro error se PROPAGA: no se traga un fallo desconocido", async () => {
    const { prisma } = makePrisma({ errorAlBorrar: new Error("la base se cayo") });
    await expect(new ApiKeyRepository(prisma).eliminar(ID, ACTOR)).rejects.toThrow(
      "la base se cayo",
    );
  });
});

describe("373/R38 — `dependenciasDeCuentasDedicadas` no consulta de mas", () => {
  it("con la lista VACIA devuelve un Map vacio SIN tocar la base", async () => {
    const { prisma, doble } = makePrisma();
    const mapa = await new ApiKeyRepository(prisma).dependenciasDeCuentasDedicadas([]);

    expect(mapa.size).toBe(0);
    expect(doble.$queryRaw).not.toHaveBeenCalled();
  });

  it("con N ids hace UNA sola consulta (no una por id)", async () => {
    const { prisma, doble } = makePrisma();
    await new ApiKeyRepository(prisma).dependenciasDeCuentasDedicadas([USUARIO, "u-2", "u-3"]);
    expect(doble.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("indexa por `usuarioId` lo que devuelve la consulta", async () => {
    const { prisma } = makePrisma({ dependencias: { ordenes: true, dinero: false, tarifas: true } });
    const mapa = await new ApiKeyRepository(prisma).dependenciasDeCuentasDedicadas([USUARIO]);
    expect(mapa.get(USUARIO)).toEqual({ ordenes: true, dinero: false, tarifas: true });
  });
});
