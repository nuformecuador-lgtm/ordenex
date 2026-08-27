import { describe, it, expect, vi } from "vitest";
import { EliminarOrdenService } from "@/lib/services/EliminarOrdenService";
import type { OrdenTransicionRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ESTADOS_CREACION } from "@/lib/types/order-status-transiciones";
import {
  MSG_ORDEN_CON_GESTION,
  MSG_ORDEN_NO_EXISTE,
  MSG_ORDEN_YA_BORRADA,
} from "@/lib/services/mensajes-eliminar-orden";

// Feature «eliminar orden» — logica de negocio del borrado LOGICO, con dobles (sin DB, sin
// HTTP). Los motivos se asertan contra las CONSTANTES tipadas, no contra literales duplicados.
//
// Pedido humano (2026-08-27), y son los DOS cambios de contrato que este archivo mide:
//   - la accion baja de maestro/admin a SOLO maestro;
//   - y solo alcanza a la orden que NADIE ha gestionado desde que se creo.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };
const API_KEY: Actor = { usuarioId: "u-api", rol: "apiKey" };

/** Estado de nacimiento por defecto: el caso ELIMINABLE. */
const ESTADO_NACIMIENTO = ESTADOS_CREACION[0];

function ordenRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: ESTADO_NACIMIENTO,
    numGuia: 1234,
    deletedAt: null,
    zonaId: "z-central",
    zonaEsGam: true,
    tiendaId: "store-1",
    fechaReparto: null,
    ...overrides,
  };
}

/** `conGestion`: ids que el HISTORIAL dice que ya registran movimiento posterior a la creacion. */
function escenario(ordenes: OrdenTransicionRow[] = [ordenRow()], conGestion: string[] = []) {
  const findByIdsForTransicion = vi.fn(async (ids: string[]) =>
    ordenes.filter((o) => ids.includes(o.id)),
  );
  const softDelete = vi.fn(async (ids: readonly string[]) => ids.length);
  const idsConGestionPosteriorEnLote = vi.fn(async () => new Set(conGestion));
  const service = new EliminarOrdenService(
    { findByIdsForTransicion, softDelete },
    { idsConGestionPosteriorEnLote },
  );
  return { service, findByIdsForTransicion, softDelete, idsConGestionPosteriorEnLote };
}

describe("EliminarOrdenService", () => {
  it("maestro elimina el lote sin gestionar y devuelve cuantas cambio el servidor", async () => {
    const { service, softDelete } = escenario([
      ordenRow({ id: "o1" }),
      ordenRow({ id: "o2", estatusValue: ESTADOS_CREACION[1] }),
    ]);

    const r = await service.eliminar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 2 });
    expect(softDelete).toHaveBeenCalledWith(["o1", "o2"]);
  });

  // Pedido humano 2026-08-27: el `admin` PIERDE la accion. Este test es el que impide que
  // alguien "restaure la paridad adm-maestro" sin leer por que se rompio a proposito.
  it.each([
    ["admin", ADMIN],
    ["adminSatelite", ADMIN_SATELITE],
    ["adminTienda", ADMIN_TIENDA],
    ["mensajero", MENSAJERO],
    ["apiKey", API_KEY],
  ])("%s recibe forbidden y NO se toca la base", async (_nombre, actor) => {
    const { service, findByIdsForTransicion, softDelete, idsConGestionPosteriorEnLote } =
      escenario();

    const r = await service.eliminar({ ordenIds: ["o1"] }, actor);

    expect(r).toEqual({ status: "forbidden" });
    expect(findByIdsForTransicion).not.toHaveBeenCalled();
    expect(idsConGestionPosteriorEnLote).not.toHaveBeenCalled();
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("orden CON transicion posterior a la creacion -> conflict, y no se borra ninguna", async () => {
    const { service, softDelete } = escenario(
      [ordenRow({ id: "o1" }), ordenRow({ id: "o2" })],
      ["o2"], // el historial dice que `o2` ya se movio
    );

    const r = await service.eliminar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: MSG_ORDEN_CON_GESTION }],
    });
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("orden fuera de un estado de nacimiento -> conflict AUNQUE el historial este vacio", async () => {
    // La segunda mitad del predicado, y la que hace que falle CERRADO: una orden sin filas de
    // historial (legada, o con el rastro perdido) puede estar entregada. Sin esta guarda seria
    // borrable, que es exactamente lo que el pedido humano prohibe.
    const estadosGestionados = ["en_bodega_central", "en_reparto", "entregada", "rechazada"];
    for (const estatusValue of estadosGestionados) {
      const { service, softDelete } = escenario([ordenRow({ id: "o1", estatusValue })], []);

      const r = await service.eliminar({ ordenIds: ["o1"] }, MAESTRO);

      expect(r).toEqual({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_CON_GESTION }],
      });
      expect(softDelete).not.toHaveBeenCalled();
    }
  });

  it("los dos estados de nacimiento son eliminables", async () => {
    for (const estatusValue of ESTADOS_CREACION) {
      const { service } = escenario([ordenRow({ id: "o1", estatusValue })]);
      const r = await service.eliminar({ ordenIds: ["o1"] }, MAESTRO);
      expect(r).toEqual({ status: "ok", eliminadas: 1 });
    }
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
    const { service, findByIdsForTransicion, softDelete, idsConGestionPosteriorEnLote } =
      escenario([ordenRow({ id: "o1" })]);

    const r = await service.eliminar({ ordenIds: ["o1", "o1", "o1"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 1 });
    expect(findByIdsForTransicion).toHaveBeenCalledWith(["o1"]);
    expect(idsConGestionPosteriorEnLote).toHaveBeenCalledWith(["o1"]);
    expect(softDelete).toHaveBeenCalledWith(["o1"]);
  });

  it("lote vacio -> ok(0) sin consultar", async () => {
    const { service, findByIdsForTransicion, softDelete, idsConGestionPosteriorEnLote } =
      escenario();

    const r = await service.eliminar({ ordenIds: [] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 0 });
    expect(findByIdsForTransicion).not.toHaveBeenCalled();
    expect(idsConGestionPosteriorEnLote).not.toHaveBeenCalled();
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
    const service = new EliminarOrdenService(
      { findByIdsForTransicion, softDelete },
      { idsConGestionPosteriorEnLote: vi.fn(async () => new Set<string>()) },
    );

    const r = await service.eliminar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 1 });
  });
});
