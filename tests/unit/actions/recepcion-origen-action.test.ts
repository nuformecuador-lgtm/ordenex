import { describe, it, expect, vi } from "vitest";
import { recibirEnOrigenPorQr } from "@/lib/actions/recepcion-origen";
import type { IRecepcionOrigenService } from "@/lib/interfaces/services/IRecepcionOrigenService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Borde (Server Action) de la recepción en la tienda de origen. Espejo de
// `recepcion-satelite-action.test.ts`: el borde resuelve `unauthenticated` y el
// `validation_error` de zod; el resto son resultados de dominio del service.

const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };

function buildService(
  overrides: Partial<IRecepcionOrigenService> = {},
): IRecepcionOrigenService {
  return {
    recibirEnOrigen: vi.fn(async () => ({
      status: "ok" as const,
      ordenId: "o1",
      estado: "devuelta_a_tienda" as const,
    })),
    ...overrides,
  };
}

const noActor = async () => null;
const actorTienda = async () => TIENDA;

describe("recibirEnOrigenPorQr — borde", () => {
  it("sin actor -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirEnOrigenPorQr({ numGuia: 14 }, { service, getActor: noActor });

    expect(r.status).toBe("unauthenticated");
    expect(service.recibirEnOrigen).not.toHaveBeenCalled();
  });

  it("pasa el numGuia y el actor al service y devuelve su resultado", async () => {
    const service = buildService();
    const r = await recibirEnOrigenPorQr(
      { numGuia: 14 },
      { service, getActor: actorTienda },
    );

    expect(service.recibirEnOrigen).toHaveBeenCalledWith(14, TIENDA);
    expect(r).toEqual({ status: "ok", ordenId: "o1", estado: "devuelta_a_tienda" });
  });

  it("reenvía los resultados de dominio tal cual (no los reinterpreta)", async () => {
    const service = buildService({
      recibirEnOrigen: vi.fn(async () => ({ status: "tienda_ajena" as const })),
    });
    const r = await recibirEnOrigenPorQr(
      { numGuia: 14 },
      { service, getActor: actorTienda },
    );

    expect(r).toEqual({ status: "tienda_ajena" });
  });

  // zod en el borde: un numGuia que no es entero positivo no llega al service.
  it.each([
    ["no numérico", { numGuia: "14" }],
    ["cero", { numGuia: 0 }],
    ["negativo", { numGuia: -1 }],
    ["decimal", { numGuia: 1.5 }],
    ["ausente", {}],
  ])("%s -> validation_error, sin tocar el service", async (_label, input) => {
    const service = buildService();
    const r = await recibirEnOrigenPorQr(input, { service, getActor: actorTienda });

    expect(r.status).toBe("validation_error");
    expect(service.recibirEnOrigen).not.toHaveBeenCalled();
  });
});
