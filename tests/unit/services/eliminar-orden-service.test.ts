import { describe, it, expect, vi } from "vitest";
import { EliminarOrdenService } from "@/lib/services/EliminarOrdenService";
import type { OrdenTransicionRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  MSG_ORDEN_NO_EXISTE,
  MSG_ORDEN_YA_BORRADA,
} from "@/lib/services/mensajes-eliminar-orden";

// Feature «eliminar orden» — logica de negocio del borrado LOGICO, con dobles (sin DB, sin
// HTTP). Los motivos se asertan contra las CONSTANTES tipadas, no contra literales duplicados.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };
const API_KEY: Actor = { usuarioId: "u-api", rol: "apiKey" };

function ordenRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "en_bodega_central",
    numGuia: 1234,
    deletedAt: null,
    zonaId: "z-central",
    zonaEsGam: true,
    tiendaId: "store-1",
    fechaReparto: null,
    ...overrides,
  };
}

function escenario(ordenes: OrdenTransicionRow[] = [ordenRow()]) {
  const findByIdsForTransicion = vi.fn(async (ids: string[]) =>
    ordenes.filter((o) => ids.includes(o.id)),
  );
  const softDelete = vi.fn(async (ids: readonly string[]) => ids.length);
  const service = new EliminarOrdenService({ findByIdsForTransicion, softDelete });
  return { service, findByIdsForTransicion, softDelete };
}

describe("EliminarOrdenService", () => {
  it("maestro elimina el lote y devuelve cuantas cambio el servidor", async () => {
    const { service, softDelete } = escenario([
      ordenRow({ id: "o1" }),
      ordenRow({ id: "o2", estatusValue: "entregada" }),
    ]);

    const r = await service.eliminar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 2 });
    expect(softDelete).toHaveBeenCalledWith(["o1", "o2"]);
  });

  it("admin tambien puede", async () => {
    const { service } = escenario();
    const r = await service.eliminar({ ordenIds: ["o1"] }, ADMIN);
    expect(r.status).toBe("ok");
  });

  it.each([
    ["adminSatelite", ADMIN_SATELITE],
    ["adminTienda", ADMIN_TIENDA],
    ["mensajero", MENSAJERO],
    ["apiKey", API_KEY],
  ])("%s recibe forbidden y NO se toca la base", async (_nombre, actor) => {
    const { service, findByIdsForTransicion, softDelete } = escenario();

    const r = await service.eliminar({ ordenIds: ["o1"] }, actor);

    expect(r).toEqual({ status: "forbidden" });
    expect(findByIdsForTransicion).not.toHaveBeenCalled();
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("no elimina el estado: la orden se elimina este donde este", async () => {
    // Cinco estados de puntos MUY distintos del flujo: ninguno cambia el resultado.
    const estados = [
      "por_recolectar_en_tienda",
      "en_bodega_central",
      "en_reparto",
      "entregada",
      "rechazada",
    ];
    const ordenes = estados.map((estatusValue, i) =>
      ordenRow({ id: `o${i}`, estatusValue }),
    );
    const { service } = escenario(ordenes);

    const r = await service.eliminar({ ordenIds: ordenes.map((o) => o.id) }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: estados.length });
  });

  it("id inexistente -> conflict con su motivo y SIN borrar nada (todo-o-nada)", async () => {
    const { service, softDelete } = escenario([ordenRow({ id: "o1" })]);

    const r = await service.eliminar({ ordenIds: ["o1", "fantasma"] }, MAESTRO);

    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "fantasma", motivo: MSG_ORDEN_NO_EXISTE }],
    });
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("orden ya borrada -> conflict con su motivo y SIN borrar nada", async () => {
    const { service, softDelete } = escenario([
      ordenRow({ id: "o1" }),
      ordenRow({ id: "o2", deletedAt: new Date("2026-08-01T00:00:00Z") }),
    ]);

    const r = await service.eliminar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: MSG_ORDEN_YA_BORRADA }],
    });
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("deduplica los ids antes de consultar y de escribir", async () => {
    const { service, findByIdsForTransicion, softDelete } = escenario([ordenRow({ id: "o1" })]);

    const r = await service.eliminar({ ordenIds: ["o1", "o1", "o1"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 1 });
    expect(findByIdsForTransicion).toHaveBeenCalledWith(["o1"]);
    expect(softDelete).toHaveBeenCalledWith(["o1"]);
  });

  it("lote vacio -> ok(0) sin consultar", async () => {
    const { service, findByIdsForTransicion, softDelete } = escenario();

    const r = await service.eliminar({ ordenIds: [] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 0 });
    expect(findByIdsForTransicion).not.toHaveBeenCalled();
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("carrera benigna: informa lo que el SERVIDOR borro, no el tamano del lote", async () => {
    // Otra sesion borro `o2` entre la precarga y el `updateMany`: el `where` con
    // `deleted_at IS NULL` la deja fuera y el conteo baja. No es un error.
    const findByIdsForTransicion = vi.fn(async () => [
      ordenRow({ id: "o1" }),
      ordenRow({ id: "o2" }),
    ]);
    const softDelete = vi.fn(async () => 1);
    const service = new EliminarOrdenService({ findByIdsForTransicion, softDelete });

    const r = await service.eliminar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 1 });
  });
});
