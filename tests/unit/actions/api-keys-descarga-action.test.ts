import { describe, it, expect, vi } from "vitest";
import { listarApiKeysCompleto } from "@/lib/actions/api-keys";
import type { Actor, IApiKeyService } from "@/lib/interfaces/services/IApiKeyService";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

// Feature 170 / T B.2 (R16/R18 + refuerzo R9/R17/R21/R27) — borde del inventario completo
// de API keys. El servicio va inyectado: aquí se prueba el borde, no el dominio.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const ITEM: ApiKeyListItemDTO = {
  id: "k1",
  identificador: "Tienda Uno",
  keyPrefix: "ordx_abc1234",
  estado: "activa",
  usuarioId: "u-dedicado",
  usuarioEmail: "apikey+tienda-uno@apikey.invalid",
  tiendaDestinoId: null, // feature 302
  tiendaDestinoNombre: null,
  // Ficha 373: la key `activa` NO es eliminable (R11); el motivo lo calcula el servicio.
  eliminable: false,
  motivoNoEliminable: "activa",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function fakeService(resultado: unknown) {
  const listarCompleto = vi.fn().mockResolvedValue(resultado);
  return { service: { listarCompleto } as unknown as IApiKeyService, listarCompleto };
}

describe("listarApiKeysCompleto (borde)", () => {
  it("devuelve unauthenticated y ninguna fila cuando no hay sesion (R16)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarApiKeysCompleto(
      {},
      { apiKeyService: service, getActor: async () => null },
    );

    expect(r.status).toBe("unauthenticated");
    expect(r).not.toHaveProperty("items");
    expect(listarCompleto).not.toHaveBeenCalled();
  });

  it("devuelve validation_error y ninguna fila cuando llega una clave fuera de la lista blanca (R18)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarApiKeysCompleto(
      { incluirSecreto: true },
      { apiKeyService: service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(r).not.toHaveProperty("items");
    expect(listarCompleto).not.toHaveBeenCalled();
  });

  it("rechaza tambien page/pageSize: el modo completo NO pagina (R18)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarApiKeysCompleto(
      { page: 1, pageSize: 10 },
      { apiKeyService: service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(listarCompleto).not.toHaveBeenCalled();
  });

  it("propaga limite_excedido con total y limite tal como lo devuelve el servicio (R27)", async () => {
    const { service } = fakeService({ status: "limite_excedido", total: 5001, limite: 5000 });

    const r = await listarApiKeysCompleto(
      {},
      { apiKeyService: service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "limite_excedido", total: 5001, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });

  it("propaga forbidden sin filas (R17)", async () => {
    const { service } = fakeService({ status: "forbidden" });

    const r = await listarApiKeysCompleto(
      {},
      {
        apiKeyService: service,
        getActor: async () => ({ usuarioId: "a1", rol: "admin" }),
      },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
  });

  it("entrega los items del servicio, sin hash ni secreto y sin paginacion (R9/R21)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarApiKeysCompleto(
      {},
      { apiKeyService: service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "ok", items: [ITEM], total: 1 });
    if (r.status !== "ok") return;
    for (const fila of r.items) {
      expect(fila).not.toHaveProperty("keyHash");
      expect(fila).not.toHaveProperty("plainKey");
    }

    const [data, actor] = listarCompleto.mock.calls[0];
    expect(actor).toEqual(MAESTRO);
    expect(data).toEqual({});
    expect(data).not.toHaveProperty("page");
    expect(data).not.toHaveProperty("pageSize");
  });
});
