import { describe, it, expect, vi } from "vitest";
import { ApiOrdenCancelacionService } from "@/lib/services/ApiOrdenCancelacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const DEVUELTA_ORIGEN_ID = "os-devuelta-origen";

function fakeRepo(cancelarResult: unknown, overrides: Record<string, unknown> = {}) {
  return {
    findEstatusIdByValue: vi.fn().mockResolvedValue(DEVUELTA_ORIGEN_ID),
    cancelarViaApi: vi.fn().mockResolvedValue(cancelarResult),
    ...overrides,
  };
}

describe("ApiOrdenCancelacionService.cancelar (feature 106, T9)", () => {
  it("R19: ok desde en_bodega_central -> destino devolviendo_a_tienda; resuelve el estatusId del catalogo", async () => {
    const repo = fakeRepo({ status: "ok", estadoAnterior: "en_bodega_central" });
    const svc = new ApiOrdenCancelacionService(repo as never);

    const res = await svc.cancelar(ACTOR, 10234);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("devolviendo_a_tienda");
    // R4: owner = actor.usuarioId; el destino resuelto se pasa al repo.
    expect(repo.cancelarViaApi).toHaveBeenCalledWith({
      numGuia: 10234,
      ownerId: "store-1",
      devueltaOrigenEstatusId: DEVUELTA_ORIGEN_ID,
    });
    expect(res).toEqual({
      status: "ok",
      data: { numGuia: 10234, estadoAnterior: "en_bodega_central", estado: "devolviendo_a_tienda" },
    });
  });

  it("R19: ok desde en_ruta_bodega_central -> devolviendo_a_tienda", async () => {
    const repo = fakeRepo({ status: "ok", estadoAnterior: "en_ruta_bodega_central" });
    const svc = new ApiOrdenCancelacionService(repo as never);
    const res = await svc.cancelar(ACTOR, 10234);
    expect(res).toEqual({
      status: "ok",
      data: {
        numGuia: 10234,
        estadoAnterior: "en_ruta_bodega_central",
        estado: "devolviendo_a_tienda",
      },
    });
  });

  it("R20: conflict del repo (incl. ya devolviendo_a_tienda) -> conflict de dominio", async () => {
    const repo = fakeRepo({ status: "conflict", estadoActual: "devolviendo_a_tienda" });
    const svc = new ApiOrdenCancelacionService(repo as never);
    const res = await svc.cancelar(ACTOR, 10234);
    expect(res).toEqual({ status: "conflict" });
  });

  it("R23: not_found del repo (ajena/inexistente) -> not_found de dominio", async () => {
    const repo = fakeRepo({ status: "not_found" });
    const svc = new ApiOrdenCancelacionService(repo as never);
    const res = await svc.cancelar(ACTOR, 999);
    expect(res).toEqual({ status: "not_found" });
  });

  it("falla ruidosamente si el catalogo no tiene devolviendo_a_tienda (fallo de infra, no de negocio)", async () => {
    const repo = fakeRepo(
      { status: "ok", estadoAnterior: "en_bodega_central" },
      { findEstatusIdByValue: vi.fn().mockResolvedValue(null) },
    );
    const svc = new ApiOrdenCancelacionService(repo as never);
    await expect(svc.cancelar(ACTOR, 10234)).rejects.toThrow(/devolviendo_a_tienda/);
    expect(repo.cancelarViaApi).not.toHaveBeenCalled();
  });
});
