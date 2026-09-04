import { describe, it, expect, vi } from "vitest";
import { RolValue } from "@prisma/client";
import { ApiKeyService } from "@/lib/services/ApiKeyService";
import type {
  ApiKeyListItem,
  IApiKeyRepository,
  ListApiKeysParams,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
import type { DependenciasCuentaDedicada } from "@/lib/types/api-key";
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";

// Feature 82 — ApiKeyService.listar. Repositorio mockeado: sin DB (R10, CHECKPOINTS.md).
// Que este archivo entero corra sin Prisma ES la prueba de R10.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function item(n: number): ApiKeyListItem {
  return {
    id: `key-${n}`,
    identificador: `Tienda ${n}`,
    keyPrefix: `ordx_abc123${n}`,
    estado: "activa",
    usuarioId: `u-dedicado-${n}`,
    usuarioEmail: `apikey+tienda-${n}@apikey.invalid`,
    tiendaDestinoId: null, // feature 302
    tiendaDestinoNombre: null,
    createdAt: new Date(`2026-07-1${n}T12:00:00Z`),
  };
}

/**
 * FICHA 373 -- el doble de `dependenciasDeCuentasDedicadas`. `dependencias` mapea `usuarioId` ->
 * lo que tiene esa cuenta; lo que no este ahi se resuelve como "sin rastro".
 */
function makeRepo(
  items: ApiKeyListItem[] = [item(1), item(2)],
  total = items.length,
  dependencias: Record<string, DependenciasCuentaDedicada> = {},
) {
  const capturado: ListApiKeysParams[] = [];
  const idsPedidos: string[][] = [];
  const repo: IApiKeyRepository = {
    dependenciasDeCuentasDedicadas: vi.fn(async (usuarioIds: readonly string[]) => {
      idsPedidos.push([...usuarioIds]);
      return new Map(
        usuarioIds
          .filter((id) => dependencias[id] !== undefined)
          .map((id) => [id, dependencias[id]] as const),
      );
    }),
    eliminar: vi.fn(async () => {
      throw new Error("eliminar no debe invocarse desde listar");
    }),
    createConUsuario: vi.fn(async () => {
      throw new Error("createConUsuario no debe invocarse desde listar");
    }),
    list: vi.fn(async (params: ListApiKeysParams) => {
      capturado.push(params);
      return { items, total };
    }),
    count: vi.fn(async () => total),
    // [88] `findByKeyHash` llego con la feature 88 al mergear. Listar no autentica: lanza
    // para delatar cualquier invocacion, mismo criterio que `createConUsuario` arriba.
    findByKeyHash: vi.fn(async () => {
      throw new Error("findByKeyHash no debe invocarse desde listar");
    }),
    // Feature 302: la eleccion de tienda destino es cosa de `generar`; listar no la mira.
    findTiendaDestino: vi.fn(async () => {
      throw new Error("findTiendaDestino no debe invocarse desde listar");
    }),
    // Ciclo de vida: escrituras que listar nunca debe tocar.
    rotar: vi.fn(async () => {
      throw new Error("rotar no debe invocarse desde listar");
    }),
    setEstado: vi.fn(async () => {
      throw new Error("setEstado no debe invocarse desde listar");
    }),
  };
  return { repo, capturado, idsPedidos };
}

describe("ApiKeyService.listar — autorizacion (R2)", () => {
  it("R2: rechaza con forbidden a todo rol que no sea maestro, sin consultar la base", async () => {
    // Derivado del enum, igual que el test de `generar`: un rol nuevo obliga a decidir
    // explicitamente si puede inventariar keys.
    const noMaestros = Object.values(RolValue).filter((r) => r !== RolValue.maestro);
    expect(noMaestros.length).toBeGreaterThan(0);

    for (const rol of noMaestros) {
      const { repo } = makeRepo();
      const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, { usuarioId: "u1", rol });
      expect(r).toEqual({ status: "forbidden" });
      // R2: "sin consultar la base de datos" no es un detalle: es el requisito.
      expect(repo.list).not.toHaveBeenCalled();
    }
  });

  it("el maestro si puede listar", async () => {
    const { repo } = makeRepo();
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);
    expect(r.status).toBe("ok");
  });
});

describe("ApiKeyService.listar — resultado (R4/R5/R7)", () => {
  it("R4: devuelve status ok con items, page, pageSize y el total real", async () => {
    const { repo } = makeRepo([item(1), item(2)], 7);
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(Object.keys(r).sort()).toEqual(["items", "page", "pageSize", "status", "total"].sort());
      expect(r.items).toHaveLength(2);
      expect(r.page).toBe(1);
      expect(r.pageSize).toBe(25);
      expect(r.total).toBe(7);
    }
  });

  it("R5: cada item trae exactamente los campos del contrato", async () => {
    const { repo } = makeRepo([item(1)]);
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    if (r.status !== "ok") throw new Error("se esperaba ok");
    expect(Object.keys(r.items[0]).sort()).toEqual(
      [
        "createdAt",
        "estado",
        "id",
        "identificador",
        "keyPrefix",
        "tiendaDestinoId", // feature 302
        "tiendaDestinoNombre", // feature 302
        "usuarioEmail",
        "usuarioId",
        "eliminable", // ficha 373
        "motivoNoEliminable", // ficha 373
      ].sort(),
    );
    expect(r.items[0].usuarioEmail).toBe("apikey+tienda-1@apikey.invalid"); // [D1]
  });

  it("R7: preserva el orden que entrega el repositorio (createdAt desc), sin reordenar", async () => {
    // El orden lo fija la query (R7 se verifica en el repositorio). Aqui se comprueba
    // que el service no lo altera ni lo re-implementa.
    const { repo } = makeRepo([item(3), item(2), item(1)], 3);
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    if (r.status !== "ok") throw new Error("se esperaba ok");
    expect(r.items.map((i) => i.id)).toEqual(["key-3", "key-2", "key-1"]);
  });
});

describe("ApiKeyService.listar — el secreto no existe en este camino (R6)", () => {
  it("R6: ningun item devuelto contiene keyHash ni plainKey", async () => {
    const { repo } = makeRepo([item(1), item(2)]);
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    if (r.status !== "ok") throw new Error("se esperaba ok");
    for (const i of r.items) {
      expect(Object.keys(i)).not.toContain("keyHash");
      expect(Object.keys(i)).not.toContain("plainKey");
    }
  });

  it("R6: el resultado serializado hacia el cliente no menciona el secreto", async () => {
    // La forma en que esto viaja al cliente es serializado: se verifica ahi, que es
    // donde una fuga seria real.
    const { repo } = makeRepo([item(1)]);
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain("keyHash");
    expect(serializado).not.toContain("plainKey");
    // Lo que SI viaja es el prefijo publico (81/R17).
    expect(serializado).toContain("ordx_abc1231");
  });
});

describe("ApiKeyService.listar — paginacion (R9)", () => {
  it("traduce page/pageSize a skip/take para el repositorio", async () => {
    const { repo, capturado } = makeRepo();
    await new ApiKeyService(repo).listar({ page: 3, pageSize: 25 }, MAESTRO);
    expect(capturado[0]).toEqual({ skip: 50, take: 25 });
  });

  it("la primera pagina arranca en skip 0", async () => {
    const { repo, capturado } = makeRepo();
    await new ApiKeyService(repo).listar({ page: 1, pageSize: 10 }, MAESTRO);
    expect(capturado[0]).toEqual({ skip: 0, take: 10 });
  });

  it("R9: una pagina mas alla del ultimo registro devuelve items vacios y el total real", async () => {
    const { repo } = makeRepo([], 7);
    const r = await new ApiKeyService(repo).listar({ page: 99, pageSize: 25 }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items).toEqual([]);
      expect(r.total).toBe(7); // el total no se falsea por pedir una pagina vacia
      expect(r.page).toBe(99);
    }
  });
});

// =================================================================================================
// FICHA 373 -- la eliminabilidad viaja con cada fila, y cuesta UNA consulta por pagina (R38)
// =================================================================================================

describe("ApiKeyService.listar -- eliminabilidad de cada fila (373/R38)", () => {
  it("R38: pide las dependencias UNA vez, con la lista de ids de la pagina entera", async () => {
    // La mutacion que este caso caza: resolver la eliminabilidad fila a fila (N+1). Con 25 filas
    // habria 25 llamadas; el contrato dice UNA con 25 ids.
    const items = Array.from({ length: 25 }, (_, i) => item(i + 1));
    const { repo, idsPedidos } = makeRepo(items, 25);
    await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    expect(repo.dependenciasDeCuentasDedicadas).toHaveBeenCalledTimes(1);
    expect(idsPedidos).toHaveLength(1);
    expect(idsPedidos[0]).toEqual(items.map((i) => i.usuarioId));
  });

  it("R38: una pagina de 1 fila hace las MISMAS llamadas que una de 25", async () => {
    const una = makeRepo([item(1)], 1);
    await new ApiKeyService(una.repo).listar({ page: 1, pageSize: 25 }, MAESTRO);
    const veinticinco = makeRepo(
      Array.from({ length: 25 }, (_, i) => item(i + 1)),
      25,
    );
    await new ApiKeyService(veinticinco.repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    expect(una.repo.list).toHaveBeenCalledTimes(1);
    expect(veinticinco.repo.list).toHaveBeenCalledTimes(1);
    expect(una.repo.dependenciasDeCuentasDedicadas).toHaveBeenCalledTimes(1);
    expect(veinticinco.repo.dependenciasDeCuentasDedicadas).toHaveBeenCalledTimes(1);
  });

  it("R11: una fila `activa` y SIN ningun dato sale NO eliminable, con motivo `activa`", async () => {
    // Es el caso literal de "API Nuform" medido en produccion: 0 ordenes, 0 dinero, 0 tarifas y
    // aun asi no borrable. Sin R11 el guard por datos la daria por eliminable.
    const { repo } = makeRepo([item(1)], 1);
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    if (r.status !== "ok") throw new Error("se esperaba ok");
    expect(r.items[0].estado).toBe("activa");
    expect(r.items[0].eliminable).toBe(false);
    expect(r.items[0].motivoNoEliminable).toBe("activa");
  });

  it("la MISMA fila, desactivada y sin datos, sale eliminable con motivo `null`", async () => {
    const { repo } = makeRepo([{ ...item(1), estado: "inactiva" }], 1);
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    if (r.status !== "ok") throw new Error("se esperaba ok");
    expect(r.items[0].eliminable).toBe(true);
    expect(r.items[0].motivoNoEliminable).toBeNull();
  });

  it("cada fila recibe SUS dependencias, no las de su vecina", async () => {
    // La mutacion que caza: aplicar la primera entrada del `Map` a todas las filas.
    const filas = [
      { ...item(1), estado: "inactiva" as const }, // sin rastro -> eliminable
      { ...item(2), estado: "inactiva" as const }, // con ordenes
      { ...item(3), estado: "inactiva" as const }, // con tarifas
    ];
    const { repo } = makeRepo(filas, 3, {
      "u-dedicado-2": { ordenes: true, dinero: false, tarifas: false },
      "u-dedicado-3": { ordenes: false, dinero: false, tarifas: true },
    });
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    if (r.status !== "ok") throw new Error("se esperaba ok");
    expect(r.items.map((i) => i.motivoNoEliminable)).toEqual([null, "ordenes", "tarifas"]);
    expect(r.items.map((i) => i.eliminable)).toEqual([true, false, false]);
  });

  it("R13: con ordenes Y dinero Y tarifas Y activa a la vez, el motivo que viaja es `ordenes`", async () => {
    const { repo } = makeRepo([item(1)], 1, {
      "u-dedicado-1": { ordenes: true, dinero: true, tarifas: true },
    });
    const r = await new ApiKeyService(repo).listar({ page: 1, pageSize: 25 }, MAESTRO);

    if (r.status !== "ok") throw new Error("se esperaba ok");
    expect(r.items[0].motivoNoEliminable).toBe("ordenes");
  });

  it("una pagina VACIA sigue preguntando, pero con la lista vacia", async () => {
    // El repositorio real corta ahi sin consultar; el service no tiene que saberlo.
    const { repo, idsPedidos } = makeRepo([], 7);
    const r = await new ApiKeyService(repo).listar({ page: 99, pageSize: 25 }, MAESTRO);

    if (r.status !== "ok") throw new Error("se esperaba ok");
    expect(r.items).toEqual([]);
    expect(idsPedidos).toEqual([[]]);
  });
});
