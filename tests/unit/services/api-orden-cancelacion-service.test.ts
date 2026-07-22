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
  it("R19: ok desde en_bodega -> destino devuelta_origen; resuelve el estatusId del catalogo", async () => {
    const repo = fakeRepo({ status: "ok", estadoAnterior: "en_bodega" });
    const svc = new ApiOrdenCancelacionService(repo as never);

    const res = await svc.cancelar(ACTOR, 10234);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("devuelta_origen");
    // R4: owner = actor.usuarioId; el destino resuelto se pasa al repo.
    expect(repo.cancelarViaApi).toHaveBeenCalledWith({
      numGuia: 10234,
      ownerId: "store-1",
      devueltaOrigenEstatusId: DEVUELTA_ORIGEN_ID,
    });
    expect(res).toEqual({
      status: "ok",
      data: { numGuia: 10234, estadoAnterior: "en_bodega", estado: "devuelta_origen" },
    });
  });

  it("R19: ok desde en_ruta_bodega_principal -> devuelta_origen", async () => {
    const repo = fakeRepo({ status: "ok", estadoAnterior: "en_ruta_bodega_principal" });
    const svc = new ApiOrdenCancelacionService(repo as never);
    const res = await svc.cancelar(ACTOR, 10234);
    expect(res).toEqual({
      status: "ok",
      data: {
        numGuia: 10234,
        estadoAnterior: "en_ruta_bodega_principal",
        estado: "devuelta_origen",
      },
    });
  });

  it("R20: conflict del repo (incl. ya devuelta_origen) -> conflict de dominio", async () => {
    const repo = fakeRepo({ status: "conflict", estadoActual: "devuelta_origen" });
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

  it("falla ruidosamente si el catalogo no tiene devuelta_origen (fallo de infra, no de negocio)", async () => {
    const repo = fakeRepo(
      { status: "ok", estadoAnterior: "en_bodega" },
      { findEstatusIdByValue: vi.fn().mockResolvedValue(null) },
    );
    const svc = new ApiOrdenCancelacionService(repo as never);
    await expect(svc.cancelar(ACTOR, 10234)).rejects.toThrow(/devuelta_origen/);
    expect(repo.cancelarViaApi).not.toHaveBeenCalled();
  });
});
