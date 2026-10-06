import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { listarTiendasPicking } from "@/lib/actions/informe-picking";
import type { IPickingRepository } from "@/lib/interfaces/repositories/IPickingRepository";

// Ficha 476 (T4.4) — R3/R4: la lista de tiendas del panel del picking. Solo maestro, y un no-maestro
// no llega ni a CONSTRUIR el repositorio (no lee ninguna orden).

const AHORA = new Date("2026-10-05T12:30:00.000Z");
const UN_DIA = 24 * 60 * 60 * 1000;

function repo(): IPickingRepository {
  return {
    tiendaDelPicking: vi.fn(),
    ordenesEnPreparacion: vi.fn(),
    tiendasFulfillment: vi.fn(async () => [
      { id: "t2", nombre: "Nuform" },
      { id: "t1", nombre: "Gameos" },
    ]),
    entradasEnPreparacion: vi.fn(async () => [
      { tiendaId: "t1", entrada: new Date(AHORA.getTime() - 1 * UN_DIA) },
      { tiendaId: "t1", entrada: new Date(AHORA.getTime() - 4 * UN_DIA) },
      { tiendaId: "t2", entrada: new Date(AHORA.getTime() - 8 * UN_DIA) },
    ]),
  };
}

const actor = (rol: RolValue) => async () => ({ usuarioId: "u1", rol });

describe("476/R4 — solo maestro, sin leer nada", () => {
  it("sin sesion → unauthenticated, sin construir el repositorio", async () => {
    const fabrica = vi.fn(repo);
    expect(await listarTiendasPicking({ diasAtraso: 2 }, { getActor: async () => null, repo: fabrica })).toEqual({ status: "unauthenticated" });
    expect(fabrica).not.toHaveBeenCalled();
  });

  it.each<RolValue>(["admin", "adminTienda", "mensajero", "adminSatelite", "apiKey"])("%s → forbidden, sin construir el repositorio", async (rol) => {
    const fabrica = vi.fn(repo);
    expect(await listarTiendasPicking({ diasAtraso: 2 }, { getActor: actor(rol), repo: fabrica })).toEqual({ status: "forbidden" });
    expect(fabrica).not.toHaveBeenCalled();
  });
});

describe("476/R3 — maestro recibe las tiendas con sus conteos", () => {
  it("por nombre, con ordenes y atrasadas segun el N pedido", async () => {
    const r = repo();
    const res = await listarTiendasPicking({ diasAtraso: 2 }, { getActor: actor("maestro"), repo: () => r, now: () => AHORA });
    expect(res).toEqual({
      status: "ok",
      tiendas: [
        { tiendaId: "t1", nombre: "Gameos", ordenes: 2, atrasadas: 1 },
        { tiendaId: "t2", nombre: "Nuform", ordenes: 1, atrasadas: 1 },
      ],
    });
    const conN5 = await listarTiendasPicking({ diasAtraso: 5 }, { getActor: actor("maestro"), repo: () => r, now: () => AHORA });
    expect(conN5).toMatchObject({ status: "ok", tiendas: [{ atrasadas: 0 }, { atrasadas: 1 }] });
  });

  it.each([[{ diasAtraso: 0 }], [{ diasAtraso: 31 }], [{ diasAtraso: 1.5 }], [{}], [null], [{ diasAtraso: 2, x: 1 }]])(
    "entrada invalida %j → validation_error, sin leer",
    async (input) => {
      const fabrica = vi.fn(repo);
      const res = await listarTiendasPicking(input, { getActor: actor("maestro"), repo: fabrica });
      expect(res.status).toBe("validation_error");
      expect(fabrica).not.toHaveBeenCalled();
    },
  );
});
