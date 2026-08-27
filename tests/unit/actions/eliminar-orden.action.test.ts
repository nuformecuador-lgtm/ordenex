import { describe, it, expect, vi } from "vitest";
import { eliminarOrdenes } from "@/lib/actions/eliminar-orden";
import type {
  EliminarOrdenInput,
  IEliminarOrdenService,
} from "@/lib/interfaces/services/IEliminarOrdenService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature «eliminar orden» — el BORDE: sesion primero, zod despues, service al final. Ni la
// falta de sesion ni un input invalido llegan a construir el service.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const ORDEN_ID_2 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e";

function deps(opts: { actor?: Actor | null } = {}) {
  const eliminar = vi.fn(async (_input: EliminarOrdenInput, _actor: Actor) => ({
    status: "ok" as const,
    eliminadas: 1,
  }));
  const service: IEliminarOrdenService = { eliminar };
  return {
    eliminar,
    d: {
      service,
      getActor: vi.fn(async () => (opts.actor === undefined ? MAESTRO : opts.actor)),
    },
  };
}

describe("sin sesion", () => {
  it("responde unauthenticated sin invocar el service", async () => {
    const { d, eliminar } = deps({ actor: null });
    const r = await eliminarOrdenes({ ordenIds: [ORDEN_ID] }, d);
    expect(r).toEqual({ status: "unauthenticated" });
    expect(eliminar).not.toHaveBeenCalled();
  });

  it("la sesion se comprueba ANTES que el schema", async () => {
    const { d, eliminar } = deps({ actor: null });
    const r = await eliminarOrdenes({ ordenIds: [] }, d);
    expect(r).toEqual({ status: "unauthenticated" });
    expect(eliminar).not.toHaveBeenCalled();
  });
});

describe("validacion del borde", () => {
  it.each([
    ["lote vacio", { ordenIds: [] }],
    ["id no uuid", { ordenIds: ["no-es-uuid"] }],
    ["campo ausente", {}],
    ["input nulo", null],
  ])("%s -> validation_error sin invocar el service", async (_n, input) => {
    const { d, eliminar } = deps();
    const r = await eliminarOrdenes(input, d);
    expect(r.status).toBe("validation_error");
    expect(eliminar).not.toHaveBeenCalled();
  });
});

describe("camino feliz", () => {
  it("pasa el lote y el actor al service y devuelve su resultado tal cual", async () => {
    const { d, eliminar } = deps();
    const r = await eliminarOrdenes({ ordenIds: [ORDEN_ID, ORDEN_ID_2] }, d);
    expect(eliminar).toHaveBeenCalledWith(
      { ordenIds: [ORDEN_ID, ORDEN_ID_2] },
      MAESTRO,
    );
    expect(r).toEqual({ status: "ok", eliminadas: 1 });
  });

  it("propaga el forbidden del service sin reinterpretarlo", async () => {
    const { d, eliminar } = deps();
    eliminar.mockResolvedValueOnce({ status: "forbidden" } as never);
    const r = await eliminarOrdenes({ ordenIds: [ORDEN_ID] }, d);
    expect(r).toEqual({ status: "forbidden" });
  });
});
