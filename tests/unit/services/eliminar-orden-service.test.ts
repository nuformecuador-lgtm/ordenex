import { describe, it, expect, vi } from "vitest";
import { EliminarOrdenService } from "@/lib/services/EliminarOrdenService";
import type { OrdenTransicionRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ESTADOS_ELIMINABLES } from "@/lib/types/order-status-eliminables";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import {
  ELIMINABLES_ESPERADOS,
  NO_ELIMINABLES_ESPERADOS,
  catalogoCubiertoPorLasDosListas,
} from "@/tests/fixtures/estados-eliminables";
import {
  MSG_ORDEN_NO_ELIMINABLE,
  MSG_ORDEN_NO_EXISTE,
  MSG_ORDEN_YA_BORRADA,
} from "@/lib/services/mensajes-eliminar-orden";

// Feature «eliminar orden» — logica de negocio del borrado LOGICO, con dobles (sin DB, sin
// HTTP). Los motivos se asertan contra las CONSTANTES tipadas, no contra literales duplicados.
//
// Contratos que este archivo mide:
//   - la accion es de SOLO maestro (pedido humano 2026-08-27);
//   - y alcanza EXACTAMENTE a los cuatro estados de la ficha 319 (2026-08-28), ni uno mas.
//
// FICHA 319 — que cambio y por que. Antes se exigian DOS condiciones: cero transiciones
// posteriores a la creacion Y estado dentro de `ESTADOS_CREACION`. Generar la guia rompia las
// dos a la vez (anade una fila de historial Y mueve a `en_bodega_central`), asi que una orden
// numerada no volvia a ser borrable NUNCA: 0 eliminables de 429 vivas en produccion. El conteo
// de transiciones se RETIRA —el service ya no consulta el historial, y por eso el doble de
// `idsConGestionPosteriorEnLote` desaparecio de este archivo— y manda la lista de estados.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };
const API_KEY: Actor = { usuarioId: "u-api", rol: "apiKey" };

/** Estado eliminable por defecto. */
const ESTADO_ELIMINABLE = "en_preparacion";

function ordenRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: ESTADO_ELIMINABLE,
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
      ordenRow({ id: "o2", estatusValue: "en_bodega_central" }),
    ]);

    const r = await service.eliminar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 2 });
    expect(softDelete).toHaveBeenCalledWith(["o1", "o2"]);
  });

  // Pedido humano 2026-08-27: el `admin` PIERDE la accion. Este test es el que impide que
  // alguien "restaure la paridad admin-maestro" sin leer por que se rompio a proposito.
  it.each([
    ["admin", ADMIN],
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

// ---------------------------------------------------------------------------------------
// FICHA 319 — EL CRITERIO, estado por estado.
//
// Las dos listas de referencia estan ESCRITAS A MANO en `tests/fixtures/estados-eliminables.ts`
// y NO se derivan de `ESTADOS_ELIMINABLES`: comprobar una lista contra la funcion que la produce
// deja el test verde ante cualquier cambio, que es justo lo que aqui no puede pasar.
// ---------------------------------------------------------------------------------------
describe("EliminarOrdenService / criterio por ESTADO (ficha 319)", () => {
  it("las dos listas de referencia cubren el catalogo entero y no se solapan", () => {
    const { cubiertos, catalogo, solapados } = catalogoCubiertoPorLasDosListas();
    // Si el catalogo gana un `value`, ESTE test cae y obliga a decidir de que lado va. Sin el,
    // los `it.each` de abajo seguirian verdes ignorando el estado nuevo.
    expect(cubiertos).toEqual(catalogo);
    expect(solapados).toEqual([]);
    expect(catalogo).toHaveLength(ORDER_STATUS_SEED.length);
  });

  it("la lista de produccion es EXACTAMENTE la que dicto el humano", () => {
    expect([...ESTADOS_ELIMINABLES]).toEqual([...ELIMINABLES_ESPERADOS]);
  });

  it.each(ELIMINABLES_ESPERADOS)("%s: SE elimina", async (estatusValue) => {
    const { service, softDelete } = escenario([ordenRow({ id: "o1", estatusValue })]);

    const r = await service.eliminar({ ordenIds: ["o1"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", eliminadas: 1 });
    expect(softDelete).toHaveBeenCalledWith(["o1"]);
  });

  it.each(NO_ELIMINABLES_ESPERADOS)("%s: NO se elimina", async (estatusValue) => {
    const { service, softDelete } = escenario([ordenRow({ id: "o1", estatusValue })]);

    const r = await service.eliminar({ ordenIds: ["o1"] }, MAESTRO);

    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_NO_ELIMINABLE }],
    });
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("una orden CON guia ya generada, en la bodega central, SE elimina", async () => {
    // El caso exacto del defecto: `en_bodega_central` es donde aterriza la orden al numerarla
    // (arista #5). Con el criterio viejo esto era imposible por partida doble —la guia deja
    // transicion Y saca del estado de nacimiento— y por eso la ventana estaba VACIA. Se afirma
    // ademas que tener `numGuia` no descalifica: imprimir la etiqueta no es gestionar.
    const { service } = escenario([
      ordenRow({ id: "o1", estatusValue: "en_bodega_central", numGuia: 90210 }),
    ]);

    expect(await service.eliminar({ ordenIds: ["o1"] }, MAESTRO)).toEqual({
      status: "ok",
      eliminadas: 1,
    });
  });

  it("el lote MIXTO no borra nada: basta una fila en un estado no eliminable", async () => {
    const { service, softDelete } = escenario([
      ordenRow({ id: "o1", estatusValue: "en_bodega_central" }),
      ordenRow({ id: "o2", estatusValue: "en_reparto" }),
    ]);

    const r = await service.eliminar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: MSG_ORDEN_NO_ELIMINABLE }],
    });
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("un estado que NO existe en el catalogo tampoco se borra (lista de INCLUSION)", async () => {
    // Direccion segura del error: lo que no esta en la lista, no se borra. Un `value` nuevo (o
    // corrupto) nace NO eliminable.
    const { service, softDelete } = escenario([
      ordenRow({ id: "o1", estatusValue: "estado_que_no_existe" }),
    ]);

    expect(await service.eliminar({ ordenIds: ["o1"] }, MAESTRO)).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_NO_ELIMINABLE }],
    });
    expect(softDelete).not.toHaveBeenCalled();
  });
});
