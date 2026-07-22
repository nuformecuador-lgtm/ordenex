import { describe, it, expect, vi } from "vitest";
import { RolValue } from "@prisma/client";
import { ApiKeyService } from "@/lib/services/ApiKeyService";
import type {
  ApiKeyListItem,
  IApiKeyRepository,
  ListApiKeysParams,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
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
    createdAt: new Date(`2026-07-1${n}T12:00:00Z`),
  };
}

function makeRepo(items: ApiKeyListItem[] = [item(1), item(2)], total = items.length) {
  const capturado: ListApiKeysParams[] = [];
  const repo: IApiKeyRepository = {
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
    // Ciclo de vida: escrituras que listar nunca debe tocar.
    rotar: vi.fn(async () => {
      throw new Error("rotar no debe invocarse desde listar");
    }),
    setEstado: vi.fn(async () => {
      throw new Error("setEstado no debe invocarse desde listar");
    }),
  };
  return { repo, capturado };
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
      ["createdAt", "estado", "id", "identificador", "keyPrefix", "usuarioEmail", "usuarioId"].sort(),
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
