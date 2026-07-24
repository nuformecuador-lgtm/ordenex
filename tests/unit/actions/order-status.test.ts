import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { listarOrderStatus } from "@/lib/actions/order-status";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";

const CATALOGO: OrderStatusLiteRow[] = [
  { id: "os-1", value: "en_bodega_central" },
  { id: "os-2", value: "en_preparacion" },
  { id: "os-3", value: "entregada" },
];

function buildDeps(overrides: {
  actor?: Actor | null;
  listOrderStatus?: () => Promise<OrderStatusLiteRow[]>;
} = {}) {
  const listSpy = vi.fn(overrides.listOrderStatus ?? (() => Promise.resolve(CATALOGO)));
  return {
    listSpy,
    deps: {
      getActor: vi.fn(async () => ("actor" in overrides ? overrides.actor! : null)),
      ordenRepo: { listOrderStatus: listSpy },
    },
  };
}

const ROLES_OK: RolValue[] = ["maestro", "admin", "adminTienda", "adminSatelite"];

describe("listarOrderStatus (feature 63, R1-R5)", () => {
  it("R1/R2: rol autorizado -> ok con el catalogo {id, value}", async () => {
    const { deps, listSpy } = buildDeps({ actor: { usuarioId: "m1", rol: "maestro" } });
    const r = await listarOrderStatus(deps);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.estatus).toEqual(CATALOGO);
      expect(r.estatus[0]).toHaveProperty("id");
      expect(r.estatus[0]).toHaveProperty("value");
    }
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it.each(ROLES_OK)("R2: rol %s -> ok", async (rol) => {
    const { deps } = buildDeps({ actor: { usuarioId: "u1", rol } });
    const r = await listarOrderStatus(deps);
    expect(r.status).toBe("ok");
  });

  it("R3: sin sesion -> unauthenticated y el repo NO se llama", async () => {
    const { deps, listSpy } = buildDeps({ actor: null });
    const r = await listarOrderStatus(deps);
    expect(r.status).toBe("unauthenticated");
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("R4: mensajero -> forbidden y el repo NO se llama", async () => {
    const { deps, listSpy } = buildDeps({ actor: { usuarioId: "msg1", rol: "mensajero" } });
    const r = await listarOrderStatus(deps);
    expect(r.status).toBe("forbidden");
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("R4: rol desconocido -> forbidden y el repo NO se llama", async () => {
    const { deps, listSpy } = buildDeps({
      actor: { usuarioId: "x", rol: "invitado" as RolValue },
    });
    const r = await listarOrderStatus(deps);
    expect(r.status).toBe("forbidden");
    expect(listSpy).not.toHaveBeenCalled();
  });
});
