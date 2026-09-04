import { describe, it, expect, vi } from "vitest";
import { ApiKeyService } from "@/lib/services/ApiKeyService";
import type {
  ApiKeyListItem,
  IApiKeyRepository,
  ListApiKeysParams,
  ListApiKeysResult,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";
import { listarApiKeysCompletoSchema, listarApiKeysSchema } from "@/lib/types/api-key";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 170 / T B.1 (R9/R11/R17/R19/R21/R27/R29) — inventario COMPLETO de API keys.
//
// Es el listado con más riesgo de la Tanda B, así que además de los casos comunes hay uno
// propio: que ninguna fila del dataset completo contenga `keyHash` ni el secreto (R21). No
// puede contenerlos porque el DTO no los declara, pero eso es exactamente la clase de
// invariante que conviene comprobar en vez de suponer.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

/** Contraprueba de R17: ninguno de éstos ve el inventario; `MAESTRO` sí (test aparte). */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "a1", rol: "admin" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

const LIMITE = descargaConfig.MAX_FILAS;

function apiKey(over: Partial<ApiKeyListItem> & { id: string }): ApiKeyListItem {
  return {
    identificador: `Tienda ${over.id}`,
    keyPrefix: `ordx_${over.id}`,
    estado: "activa",
    usuarioId: `u-${over.id}`,
    usuarioEmail: `apikey+${over.id}@apikey.invalid`,
    tiendaDestinoId: null, // feature 302
    tiendaDestinoNombre: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

/**
 * Ficha 373: la descarga enriquece cada fila con `eliminable`/`motivoNoEliminable`, asi que el
 * doble tiene que responder a la consulta de dependencias. Devuelve un `Map` VACIO —ninguna
 * cuenta con rastro—, que es el caso neutro: el motivo lo decide entonces el `estado`.
 */
const dependenciasDeCuentasDedicadas = vi.fn(async () => new Map());

/** Repositorio en memoria: como el real, ordena `createdAt desc` y recorta con skip/take. */
function repoEnMemoria(filas: ApiKeyListItem[]) {
  const list = vi.fn(async (params: ListApiKeysParams): Promise<ListApiKeysResult> => {
    const ordenadas = [...filas].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: ordenadas.slice(params.skip, params.skip + params.take),
      total: ordenadas.length,
    };
  });
  return {
    repo: { list, dependenciasDeCuentasDedicadas } as unknown as IApiKeyRepository,
    list,
  };
}

/** Stub que declara un `total` cualquiera sin materializar más de `take` filas. */
function repoStub(total: number) {
  const list = vi.fn(async (params: ListApiKeysParams): Promise<ListApiKeysResult> => ({
    items: Array.from({ length: Math.min(total, params.take) }, (_, i) => apiKey({ id: `k${i}` })),
    total,
  }));
  return {
    repo: { list, dependenciasDeCuentasDedicadas } as unknown as IApiKeyRepository,
    list,
  };
}

function servicio(repo: IApiKeyRepository) {
  return new ApiKeyService(repo);
}

function input() {
  return listarApiKeysCompletoSchema.parse({});
}

function ids(items: ApiKeyListItem[]): string[] {
  return items.map((k) => k.id);
}

describe("ApiKeyService.listarCompleto — inventario sin paginacion", () => {
  it("devuelve todas las filas del inventario, sin recorte por pagina (R9)", async () => {
    const filas = Array.from({ length: 75 }, (_, i) =>
      apiKey({ id: `k${String(i).padStart(3, "0")}`, createdAt: new Date(2026, 0, 1 + i) }),
    );
    const svc = servicio(repoEnMemoria(filas).repo);

    const paginado = await svc.listar(listarApiKeysSchema.parse({ pageSize: 20 }), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    if (paginado.status !== "ok") return;
    expect(paginado.items).toHaveLength(20);

    expect(completo.status).toBe("ok");
    if (completo.status !== "ok") return;
    expect(completo.items).toHaveLength(75);
    expect(completo.total).toBe(75);
  });

  it("devuelve forbidden y ninguna fila a todo rol que no sea maestro (R17)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, list } = repoEnMemoria([apiKey({ id: "k1" })]);
      const r = await servicio(repo).listarCompleto(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(list, `rol ${actor.rol}`).not.toHaveBeenCalled();
    }
  });

  it("CONTRAPRUEBA de R17: el maestro SI recibe las filas", async () => {
    const { repo, list } = repoEnMemoria([apiKey({ id: "k1" }), apiKey({ id: "k2" })]);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.items).sort()).toEqual(["k1", "k2"]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("ninguna fila del dataset completo lleva el hash ni el secreto de la key (R21)", async () => {
    const { repo } = repoEnMemoria([apiKey({ id: "k1" }), apiKey({ id: "k2" })]);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    for (const fila of r.items) {
      expect(fila).not.toHaveProperty("keyHash");
      expect(fila).not.toHaveProperty("plainKey");
      expect(fila).not.toHaveProperty("webhookSecret");
      // Y el prefijo, que SI sale, sigue siendo solo el prefijo.
      expect(fila.keyPrefix.startsWith("ordx_")).toBe(true);
    }
  });

  it("mantiene el mismo criterio de orden que el listado, mas reciente primero (R11)", async () => {
    const filas = [
      apiKey({ id: "vieja", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
      apiKey({ id: "nueva", createdAt: new Date("2026-06-01T00:00:00.000Z") }),
      apiKey({ id: "media", createdAt: new Date("2026-03-01T00:00:00.000Z") }),
    ];
    const { repo } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const paginado = await svc.listar(listarApiKeysSchema.parse({}), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["nueva", "media", "vieja"]);
    expect(ids(completo.items)).toEqual(ids(paginado.items));
  });

  it("entrega EXACTAMENTE el mismo conjunto que el listado recorriendo sus paginas (R9/R19)", async () => {
    // R19 aquí es PARIDAD: el inventario de API keys no tiene borrado lógico —una key
    // revocada pasa a `inactiva` y SIGUE listándose—, así que lo que hay que demostrar es
    // que el archivo no excluye ni añade nada respecto de la pantalla.
    const filas = [
      apiKey({ id: "k1", estado: "activa", createdAt: new Date(2026, 0, 4) }),
      apiKey({ id: "k2", estado: "inactiva", createdAt: new Date(2026, 0, 3) }),
      apiKey({ id: "k3", estado: "activa", createdAt: new Date(2026, 0, 2) }),
      apiKey({ id: "k4", estado: "inactiva", createdAt: new Date(2026, 0, 1) }),
    ];
    const svc = servicio(repoEnMemoria(filas).repo);

    const pagina1 = await svc.listar(listarApiKeysSchema.parse({ pageSize: 2, page: 1 }), MAESTRO);
    const pagina2 = await svc.listar(listarApiKeysSchema.parse({ pageSize: 2, page: 2 }), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(pagina1.status).toBe("ok");
    expect(pagina2.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (pagina1.status !== "ok" || pagina2.status !== "ok" || completo.status !== "ok") return;

    expect(ids(completo.items)).toEqual([...ids(pagina1.items), ...ids(pagina2.items)]);
    expect(completo.total).toBe(pagina1.total);
  });

  it("devuelve limite_excedido con total y limite, y sin filas, cuando el total supera el tope (R27)", async () => {
    const { repo } = repoStub(LIMITE + 1);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    expect(r).toEqual({ status: "limite_excedido", total: LIMITE + 1, limite: LIMITE });
    expect(r).not.toHaveProperty("items");
  });

  it("nunca pide al repositorio mas de N+1 filas (R29)", async () => {
    const { repo, list } = repoStub(50_000);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    const params = list.mock.calls[0][0];
    expect(params.skip).toBe(0);
    expect(params.take).toBe(LIMITE + 1);
    expect(r.status).toBe("limite_excedido");
  });

  it("no devuelve un inventario truncado: o entrega todas las filas o el error de tope (R28)", async () => {
    const ok = await servicio(repoStub(LIMITE).repo).listarCompleto(input(), MAESTRO);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(ok.items).toHaveLength(LIMITE);
    expect(ok.items.length).toBe(ok.total);

    const excedido = await servicio(repoStub(LIMITE + 1).repo).listarCompleto(input(), MAESTRO);
    expect(excedido.status).toBe("limite_excedido");
    expect(excedido).not.toHaveProperty("items");
  });
});
