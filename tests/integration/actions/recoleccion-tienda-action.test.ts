import { describe, it, expect, vi } from "vitest";

import { recolectarEnTiendaPorQr } from "@/lib/actions/recoleccion-tienda";
import type { IRecoleccionTiendaService } from "@/lib/interfaces/services/IRecoleccionTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 157 (T1.13) — borde de la recoleccion en tienda. Espejo de
// `recepcion-bodega-central-action.test.ts`: el borde solo resuelve sesion + zod y hace
// passthrough del resultado de dominio; ni interpreta ni enmascara los estados del service.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

function fakeService(
  result: Awaited<ReturnType<IRecoleccionTiendaService["recolectarEnTienda"]>> = {
    status: "ok",
    ordenId: "o1",
    estado: "en_ruta_bodega_central",
  },
): IRecoleccionTiendaService {
  return { recolectarEnTienda: vi.fn(async () => result) };
}

describe("recolectarEnTiendaPorQr (borde)", () => {
  it("R29: sin sesion -> unauthenticated, sin construir ni llamar al service", async () => {
    const service = fakeService();

    const r = await recolectarEnTiendaPorQr(
      { numGuia: 1 },
      { service, getActor: async () => null },
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.recolectarEnTienda).not.toHaveBeenCalled();
  });

  it.each([
    ["cero", 0],
    ["negativo", -1],
    ["string", "12"],
    ["ausente", undefined],
  ])("R20: numGuia %s -> validation_error ANTES del service (sin tocar datos)", async (_n, numGuia) => {
    const service = fakeService();

    const r = await recolectarEnTiendaPorQr(
      { numGuia },
      { service, getActor: async () => MENSAJERO },
    );

    expect(r).toMatchObject({ status: "validation_error" });
    expect(service.recolectarEnTienda).not.toHaveBeenCalled();
  });

  it("passthrough del `ok` del service, con el numGuia ya parseado a number", async () => {
    const service = fakeService();

    const r = await recolectarEnTiendaPorQr(
      { numGuia: 4321 },
      { service, getActor: async () => MENSAJERO },
    );

    expect(r).toEqual({ status: "ok", ordenId: "o1", estado: "en_ruta_bodega_central" });
    expect(service.recolectarEnTienda).toHaveBeenCalledWith(4321, MENSAJERO);
  });

  it.each([
    ["no_encontrada", { status: "no_encontrada" as const }],
    ["ya_recolectada", { status: "ya_recolectada" as const }],
    ["forbidden", { status: "forbidden" as const }],
    ["estado_invalido", { status: "estado_invalido" as const, estado: "en_bodega_central" }],
    ["conflict", { status: "conflict" as const, motivo: "cierre pendiente" }],
  ])("passthrough del resultado de dominio `%s` sin reinterpretarlo", async (_n, result) => {
    const r = await recolectarEnTiendaPorQr(
      { numGuia: 7 },
      { service: fakeService(result), getActor: async () => MENSAJERO },
    );

    expect(r).toEqual(result);
  });
});
