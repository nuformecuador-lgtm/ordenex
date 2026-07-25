import { describe, it, expect, vi } from "vitest";
import { recibirEnBodegaCentralPorQr } from "@/lib/actions/recepcion-bodega-central";
import type { IRecepcionBodegaCentralService } from "@/lib/interfaces/services/IRecepcionBodegaCentralService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Borde (Server Action) de la recepcion en la BODEGA CENTRAL. Espejo de
// `recepcion-origen-action.test.ts`: el borde resuelve `unauthenticated` (R5) y el
// `validation_error` de zod (R10); el resto son resultados de dominio del service.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function buildService(
  overrides: Partial<IRecepcionBodegaCentralService> = {},
): IRecepcionBodegaCentralService {
  return {
    recibirEnBodegaCentral: vi.fn(async () => ({
      status: "ok" as const,
      ordenId: "o1",
      estado: "en_bodega_central" as const,
    })),
    ...overrides,
  };
}

const noActor = async () => null;
const actorMaestro = async () => MAESTRO;

describe("recibirEnBodegaCentralPorQr — borde", () => {
  it("R5: sin actor -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirEnBodegaCentralPorQr(
      { numGuia: 77 },
      { service, getActor: noActor },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.recibirEnBodegaCentral).not.toHaveBeenCalled();
  });

  it("pasa el numGuia y el actor al service y devuelve su resultado", async () => {
    const service = buildService();
    const r = await recibirEnBodegaCentralPorQr(
      { numGuia: 77 },
      { service, getActor: actorMaestro },
    );

    expect(service.recibirEnBodegaCentral).toHaveBeenCalledWith(77, MAESTRO);
    expect(r).toEqual({ status: "ok", ordenId: "o1", estado: "en_bodega_central" });
  });

  it("reenvia los resultados de dominio tal cual (no los reinterpreta)", async () => {
    const service = buildService({
      recibirEnBodegaCentral: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await recibirEnBodegaCentralPorQr(
      { numGuia: 77 },
      { service, getActor: actorMaestro },
    );

    expect(r).toEqual({ status: "forbidden" });
  });

  it("reenvia estado_invalido con el estado del service", async () => {
    const service = buildService({
      recibirEnBodegaCentral: vi.fn(async () => ({
        status: "estado_invalido" as const,
        estado: "en_ruta",
      })),
    });
    const r = await recibirEnBodegaCentralPorQr(
      { numGuia: 77 },
      { service, getActor: actorMaestro },
    );

    expect(r).toEqual({ status: "estado_invalido", estado: "en_ruta" });
  });

  // R10: zod en el borde — un numGuia que no es entero positivo no llega al service.
  it.each([
    ["no numerico", { numGuia: "77" }],
    ["cero", { numGuia: 0 }],
    ["negativo", { numGuia: -1 }],
    ["decimal", { numGuia: 1.5 }],
    ["ausente", {}],
  ])("R10: %s -> validation_error, sin tocar el service", async (_label, input) => {
    const service = buildService();
    const r = await recibirEnBodegaCentralPorQr(input, {
      service,
      getActor: actorMaestro,
    });

    expect(r.status).toBe("validation_error");
    expect(service.recibirEnBodegaCentral).not.toHaveBeenCalled();
  });
});
