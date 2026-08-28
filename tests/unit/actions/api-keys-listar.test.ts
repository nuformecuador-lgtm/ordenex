import { describe, it, expect, vi } from "vitest";
import { listarApiKeys } from "@/lib/actions/api-keys";
import type { Actor, IApiKeyService } from "@/lib/interfaces/services/IApiKeyService";
import type { ListarApiKeysInput, ListarApiKeysResult } from "@/lib/types/api-key";
import { apiKeysConfig } from "@/lib/config/api-keys";

// Feature 82 — Server Action del listado. `deps` inyectados: no toca cookies reales ni
// Prisma. Aqui se prueba el borde: sesion (R1), propagacion del rol (R2), zod (R3/R8).

const maestro = async (): Promise<Actor> => ({ usuarioId: "u-maestro", rol: "maestro" });

function makeService(result?: ListarApiKeysResult) {
  const capturado: ListarApiKeysInput[] = [];
  const service: IApiKeyService = {
    generar: vi.fn(async () => {
      throw new Error("generar no debe invocarse desde listarApiKeys");
    }),
    listar: vi.fn(async (input: ListarApiKeysInput): Promise<ListarApiKeysResult> => {
      capturado.push(input);
      return result ?? { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 };
    }),
    // Feature 170 (T B.1): el modo sin paginacion lo ejercita
    // `api-keys-descarga-action.test.ts`; aqui lanza para delatar una invocacion.
    listarCompleto: vi.fn(async () => {
      throw new Error("listarCompleto no debe invocarse desde listarApiKeys");
    }),
    // Ciclo de vida: no lo ejercita este archivo; lanza para delatar una invocacion.
    rotar: vi.fn(async () => {
      throw new Error("rotar no debe invocarse desde listarApiKeys");
    }),
    activar: vi.fn(async () => {
      throw new Error("activar no debe invocarse desde listarApiKeys");
    }),
    desactivar: vi.fn(async () => {
      throw new Error("desactivar no debe invocarse desde listarApiKeys");
    }),
  };
  return { service, capturado };
}

describe("listarApiKeys (action) — autenticacion (R1)", () => {
  it("R1: devuelve unauthenticated cuando no hay sesion, sin tocar el service", async () => {
    const { service } = makeService();
    const r = await listarApiKeys({ page: 1 }, { getActor: async () => null, apiKeyService: service });

    expect(r).toEqual({ status: "unauthenticated" });
    // R1: "sin consultar la base de datos" -> el service ni se invoca.
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("listarApiKeys (action) — autorizacion (R2)", () => {
  it("R2: propaga el forbidden del service para un rol no maestro", async () => {
    const { service } = makeService({ status: "forbidden" });
    const r = await listarApiKeys(
      { page: 1 },
      { getActor: async () => ({ usuarioId: "u1", rol: "admin" }), apiKeyService: service },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R2: la autorizacion es server-side; el actor viaja al service tal cual", async () => {
    // La UI no participa de esta decision: el rol lo resuelve la sesion, no el cliente.
    const { service } = makeService();
    await listarApiKeys({ page: 1 }, { getActor: maestro, apiKeyService: service });

    expect(service.listar).toHaveBeenCalledWith(expect.anything(), {
      usuarioId: "u-maestro",
      rol: "maestro",
    });
  });
});

describe("listarApiKeys (action) — validacion en el borde (R3)", () => {
  it.each([
    ["page 0", { page: 0 }],
    ["page negativa", { page: -1 }],
    ["page no entera", { page: 1.5 }],
    ["page no numerica", { page: "1" }],
    ["pageSize 0", { pageSize: 0 }],
    ["pageSize negativo", { pageSize: -10 }],
    ["pageSize no entero", { pageSize: 12.5 }],
  ])("R3: %s -> validation_error, sin tocar el service", async (_n, input) => {
    const { service } = makeService();
    const r = await listarApiKeys(input, { getActor: maestro, apiKeyService: service });

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toBeDefined();
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R3/R4: sin parametros aplica los defaults de la configuracion", async () => {
    const { service, capturado } = makeService();
    const r = await listarApiKeys(undefined, { getActor: maestro, apiKeyService: service });

    expect(r.status).toBe("ok");
    expect(capturado[0]).toEqual({ page: 1, pageSize: apiKeysConfig.DEFAULT_PAGE_SIZE });
  });
});

describe("listarApiKeys (action) — cota del tamano de pagina (R8)", () => {
  it("R8: acota pageSize a MAX_PAGE_SIZE antes de llegar al service", async () => {
    const { service, capturado } = makeService();
    await listarApiKeys({ page: 1, pageSize: 9999 }, { getActor: maestro, apiKeyService: service });

    // Una consulta sin cota real es el fallo que R8 previene: el clamp ocurre en el
    // borde, asi que el service nunca ve el 9999.
    expect(capturado[0].pageSize).toBe(apiKeysConfig.MAX_PAGE_SIZE);
  });

  it("R8: el pageSize efectivo (acotado) es el que se refleja en la salida", async () => {
    const { service } = makeService();
    const r = await listarApiKeys({ page: 1, pageSize: 9999 }, { getActor: maestro, apiKeyService: service });

    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.pageSize).toBe(apiKeysConfig.MAX_PAGE_SIZE);
  });

  it("R8: un pageSize por debajo de la cota se respeta tal cual", async () => {
    const { service, capturado } = makeService();
    await listarApiKeys({ page: 2, pageSize: 10 }, { getActor: maestro, apiKeyService: service });

    expect(capturado[0]).toEqual({ page: 2, pageSize: 10 });
  });
});

describe("listarApiKeys (action) — el secreto no cruza al cliente (R6)", () => {
  it("R6: el resultado que la action devuelve no contiene keyHash ni plainKey", async () => {
    const { service } = makeService({
      status: "ok",
      items: [
        {
          id: "key-1",
          identificador: "Tienda Uno",
          keyPrefix: "ordx_abc1234",
          estado: "activa",
          usuarioId: "u-dedicado",
          usuarioEmail: "apikey+tienda-uno@apikey.invalid",
          tiendaDestinoId: null, // feature 302
          tiendaDestinoNombre: null,
          createdAt: new Date("2026-07-16T12:00:00Z"),
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const r = await listarApiKeys({ page: 1 }, { getActor: maestro, apiKeyService: service });

    // Este es el valor exacto que Next serializa hacia el cliente.
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain("keyHash");
    expect(serializado).not.toContain("plainKey");
  });
});
