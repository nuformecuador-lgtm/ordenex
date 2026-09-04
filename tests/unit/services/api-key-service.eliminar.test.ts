import { describe, it, expect, vi } from "vitest";
import { RolValue } from "@prisma/client";

import { ApiKeyService } from "@/lib/services/ApiKeyService";
import type {
  EliminarApiKeyRepoResult,
  IApiKeyRepository,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 373 / D1 (R7/R11/R12/R18/R21) — LA REGLA DE NEGOCIO DEL BORRADO, SIN BASE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Que este archivo entero corra sin Prisma ES la prueba de que la autorizacion y la traduccion del
// motivo viven en el servicio y no en la base. Lo que NO se prueba aqui —y esta escrito en el test
// de repositorio— es el `WHERE`: para eso estan los de `tests/integration/db/`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ID = "11111111-1111-1111-1111-111111111111";

function makeRepo(resultado: EliminarApiKeyRepoResult) {
  const eliminar = vi.fn(async () => resultado);
  const repo: IApiKeyRepository = {
    eliminar,
    // Nada mas debe tocarse desde `eliminar`: todos lanzan para delatar una invocacion.
    createConUsuario: vi.fn(async () => {
      throw new Error("createConUsuario no debe invocarse desde eliminar");
    }),
    list: vi.fn(async () => {
      throw new Error("list no debe invocarse desde eliminar");
    }),
    count: vi.fn(async () => {
      throw new Error("count no debe invocarse desde eliminar");
    }),
    findByKeyHash: vi.fn(async () => {
      throw new Error("findByKeyHash no debe invocarse desde eliminar");
    }),
    findTiendaDestino: vi.fn(async () => {
      throw new Error("findTiendaDestino no debe invocarse desde eliminar");
    }),
    rotar: vi.fn(async () => {
      throw new Error("rotar no debe invocarse desde eliminar");
    }),
    setEstado: vi.fn(async () => {
      throw new Error("setEstado no debe invocarse desde eliminar");
    }),
    // El guard vive DENTRO de la transaccion del repositorio (R15): el servicio no lo pre-consulta,
    // porque una respuesta leida fuera de la tx ya estaria rancia al llegar al borrado.
    dependenciasDeCuentasDedicadas: vi.fn(async () => {
      throw new Error("dependenciasDeCuentasDedicadas no debe invocarse desde eliminar");
    }),
  };
  return { repo, eliminar };
}

const OK: EliminarApiKeyRepoResult = { status: "ok", identificador: "integracion-erp" };

function bloqueada(
  estado: "activa" | "inactiva",
  d: { ordenes: boolean; dinero: boolean; tarifas: boolean },
): EliminarApiKeyRepoResult {
  return { status: "bloqueada", estado, dependencias: d };
}

describe("373/R18 — autorizacion: solo `maestro`, y antes de tocar la base", () => {
  it("⭑ todo rol que no sea maestro -> forbidden SIN llamar al repositorio", async () => {
    // Derivado del enum, no de una lista paralela: un rol nuevo obliga a decidir si puede borrar.
    const noMaestros = Object.values(RolValue).filter((r) => r !== RolValue.maestro);
    expect(noMaestros.length).toBeGreaterThan(0);

    for (const rol of noMaestros) {
      const { repo, eliminar } = makeRepo(OK);
      const r = await new ApiKeyService(repo).eliminar({ id: ID }, { usuarioId: "u1", rol });
      expect(r, `el rol ${rol} no deberia poder eliminar`).toEqual({ status: "forbidden" });
      expect(eliminar, `el rol ${rol} llego al repositorio`).not.toHaveBeenCalled();
    }
  });

  it("el maestro si puede, y el repositorio recibe el id y QUIEN borra", async () => {
    const { repo, eliminar } = makeRepo(OK);
    const r = await new ApiKeyService(repo).eliminar({ id: ID }, MAESTRO);

    expect(r).toEqual({ status: "ok", identificador: "integracion-erp" });
    expect(eliminar).toHaveBeenCalledWith(ID, "u-maestro");
  });

  it("usa el MISMO guard de rol que generar/listar/rotar (no una copia)", async () => {
    // Si alguien abriera el borrado a `admin` sin abrir la generacion, seria una escalada
    // silenciosa: quien no puede crear una credencial tampoco puede destruirla.
    const { repo } = makeRepo(OK);
    const servicio = new ApiKeyService(repo);
    const admin: Actor = { usuarioId: "a1", rol: "admin" };
    expect(await servicio.eliminar({ id: ID }, admin)).toEqual({ status: "forbidden" });
    expect((await servicio.listar({ page: 1, pageSize: 25 }, admin)).status).toBe("forbidden");
  });
});

describe("373/R21 — la key ya no existe", () => {
  it("id inexistente -> not_found, sin lanzar", async () => {
    const { repo } = makeRepo({ status: "not_found" });
    expect(await new ApiKeyService(repo).eliminar({ id: ID }, MAESTRO)).toEqual({
      status: "not_found",
    });
  });
});

describe("373/R12/R13 — bloqueada, con el motivo que dicta la precedencia", () => {
  it.each([
    ["ordenes", bloqueada("inactiva", { ordenes: true, dinero: false, tarifas: false })],
    ["dinero", bloqueada("inactiva", { ordenes: false, dinero: true, tarifas: false })],
    ["tarifas", bloqueada("inactiva", { ordenes: false, dinero: false, tarifas: true })],
  ] as const)("motivo `%s`", async (motivo, resultado) => {
    const { repo } = makeRepo(resultado);
    expect(await new ApiKeyService(repo).eliminar({ id: ID }, MAESTRO)).toEqual({
      status: "bloqueada",
      motivo,
    });
  });

  it("⭑ R11: `activa` y con CERO datos -> bloqueada con motivo `activa`", async () => {
    // El caso literal de «API Nuform»: recien creada, en uso, 0 ordenes. El guard por datos la
    // daria por borrable; R11 no.
    const { repo } = makeRepo(bloqueada("activa", { ordenes: false, dinero: false, tarifas: false }));
    expect(await new ApiKeyService(repo).eliminar({ id: ID }, MAESTRO)).toEqual({
      status: "bloqueada",
      motivo: "activa",
    });
  });

  it("⭑ R11: la MISMA key, desactivada, se elimina", async () => {
    const { repo } = makeRepo(OK);
    expect(await new ApiKeyService(repo).eliminar({ id: ID }, MAESTRO)).toEqual({
      status: "ok",
      identificador: "integracion-erp",
    });
  });

  it("R13: con ordenes Y dinero Y tarifas Y activa a la vez, el motivo es `ordenes`", async () => {
    const { repo } = makeRepo(bloqueada("activa", { ordenes: true, dinero: true, tarifas: true }));
    expect(await new ApiKeyService(repo).eliminar({ id: ID }, MAESTRO)).toEqual({
      status: "bloqueada",
      motivo: "ordenes",
    });
  });

  it("⭑ R16: la red de las FK (P2003) llega como `otros_datos`", async () => {
    // Es el UNICO productor de `otros_datos`: algo que el guard no mira apunta a la cuenta y
    // Postgres lo paro. No hay diagnostico que dar, y decirlo asi es mas honesto que inventarlo.
    const { repo } = makeRepo({ status: "bloqueada", estado: null, dependencias: null });
    expect(await new ApiKeyService(repo).eliminar({ id: ID }, MAESTRO)).toEqual({
      status: "bloqueada",
      motivo: "otros_datos",
    });
  });
});

describe("373/R7 — el borrado es irreversible: no hay nada que lo deshaga", () => {
  it("⭑ el servicio no expone ningun metodo de restauracion", async () => {
    const { repo } = makeRepo(OK);
    const servicio = new ApiKeyService(repo);
    const metodos = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(servicio)),
      ...Object.keys(servicio),
    ];

    // Anti-vacuidad: si el listado de metodos saliera vacio, el `not.toContain` pasaria solo.
    expect(metodos).toContain("eliminar");
    for (const prohibido of ["restaurar", "recuperar", "deshacer", "undelete", "reactivar"]) {
      expect(metodos, `existe un metodo \`${prohibido}\``).not.toContain(prohibido);
    }
  });

  it("`ok` devuelve el identificador y NADA de la key borrada (R36)", async () => {
    // Ni prefijo, ni hash, ni email sintetico: la fila ya no existe y no hay nada que mostrar.
    const { repo } = makeRepo(OK);
    const r = await new ApiKeyService(repo).eliminar({ id: ID }, MAESTRO);

    expect(Object.keys(r).sort()).toEqual(["identificador", "status"]);
    expect(JSON.stringify(r)).not.toContain("ordx_");
  });
});
