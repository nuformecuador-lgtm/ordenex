import { describe, it, expect, vi } from "vitest";
import { RecuperarOrdenService } from "@/lib/services/RecuperarOrdenService";
import type { OrdenTransicionRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  MSG_ORDEN_NO_BORRADA,
  MSG_ORDEN_NO_EXISTE,
} from "@/lib/services/mensajes-eliminar-orden";

// Pedido humano (2026-08-27) — REVERSION del borrado logico, con dobles (sin DB, sin HTTP).
// Espejo de `eliminar-orden-service.test.ts` en la FORMA —mismo todo-o-nada, motivos invertidos—
// pero YA NO en la matriz de roles: desde la ficha 424 (2026-09-14) el `admin` borra y NO
// recupera, por decision del humano. El detalle, junto a la tabla de `forbidden`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };
const API_KEY: Actor = { usuarioId: "u-api", rol: "apiKey" };

const BORRADA_EL = new Date("2026-08-20T00:00:00Z");

/** Por defecto, BORRADA: el caso recuperable. */
function ordenRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "entregada",
    numGuia: 1234,
    deletedAt: BORRADA_EL,
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
  const restore = vi.fn(async (ids: readonly string[]) => ids.length);
  const service = new RecuperarOrdenService({ findByIdsForTransicion, restore });
  return { service, findByIdsForTransicion, restore };
}

describe("RecuperarOrdenService", () => {
  it("maestro recupera el lote y devuelve cuantas cambio el servidor", async () => {
    const { service, restore } = escenario([
      ordenRow({ id: "o1" }),
      ordenRow({ id: "o2" }),
    ]);

    const r = await service.recuperar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", recuperadas: 2 });
    expect(restore).toHaveBeenCalledWith(["o1", "o2"], expect.any(String)); // ficha 362: QUIEN recupera
  });

  // ⭑ FICHA 424 (2026-09-14) — EL `admin` SE QUEDA EN ESTA TABLA, Y AHORA ES UNA DECISION.
  //
  // Hasta hoy estar aqui era un RESTO del estrechamiento del 2026-08-27, que le habia quitado al
  // `admin` el borrado entero. Ese estrechamiento se REVIRTIO: desde el 2026-09-14 el `admin`
  // elimina ordenes (`resolverAlcanceBorradoOrden` -> «todas»). La papelera, en cambio, NO se le
  // abre, y lo decidio el humano expresamente ese mismo dia (424/D1): «que borre»; si se
  // equivoca, se lo pide al `maestro`.
  //
  // O sea que la asimetria borrar-si / recuperar-no pasa de ser un efecto colateral a ser el
  // acuerdo, y conserva ademas LA MITAD de lo que protegia la decision del 2026-08-27: deshacer
  // un borrado sigue estando en una sola persona. Este archivo dejo de ser «espejo» del de
  // borrado en su matriz de roles, y por eso lo dice aqui en vez de dejarlo deducir.
  it.each([
    ["admin", ADMIN],
    ["adminSatelite", ADMIN_SATELITE],
    ["adminTienda", ADMIN_TIENDA],
    ["mensajero", MENSAJERO],
    ["apiKey", API_KEY],
  ])("%s recibe forbidden y NO se toca la base", async (_nombre, actor) => {
    const { service, findByIdsForTransicion, restore } = escenario();

    const r = await service.recuperar({ ordenIds: ["o1"] }, actor);

    expect(r).toEqual({ status: "forbidden" });
    expect(findByIdsForTransicion).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it("recupera SEA CUAL SEA el estado y aunque la orden estuviera gestionada", async () => {
    // Deliberado, y es la asimetria con el borrado: la regla «sin gestionar» protege de borrar
    // trabajo real; aplicarla aqui dejaria irrecuperable justo la orden borrada por error sobre
    // la que alguien alcanzo a trabajar.
    const estados = ["en_bodega_central", "en_reparto", "entregada", "rechazada"];
    const ordenes = estados.map((estatusValue, i) =>
      ordenRow({ id: `o${i}`, estatusValue }),
    );
    const { service } = escenario(ordenes);

    const r = await service.recuperar({ ordenIds: ordenes.map((o) => o.id) }, MAESTRO);

    expect(r).toEqual({ status: "ok", recuperadas: estados.length });
  });

  it("orden NO borrada -> conflict con su motivo y SIN recuperar nada (todo-o-nada)", async () => {
    const { service, restore } = escenario([
      ordenRow({ id: "o1" }),
      ordenRow({ id: "o2", deletedAt: null }),
    ]);

    const r = await service.recuperar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: MSG_ORDEN_NO_BORRADA }],
    });
    expect(restore).not.toHaveBeenCalled();
  });

  it("id inexistente -> conflict con su motivo y SIN recuperar nada", async () => {
    const { service, restore } = escenario([ordenRow({ id: "o1" })]);

    const r = await service.recuperar({ ordenIds: ["o1", "fantasma"] }, MAESTRO);

    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "fantasma", motivo: MSG_ORDEN_NO_EXISTE }],
    });
    expect(restore).not.toHaveBeenCalled();
  });

  it("deduplica los ids antes de consultar y de escribir", async () => {
    const { service, findByIdsForTransicion, restore } = escenario([ordenRow({ id: "o1" })]);

    const r = await service.recuperar({ ordenIds: ["o1", "o1", "o1"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", recuperadas: 1 });
    expect(findByIdsForTransicion).toHaveBeenCalledWith(["o1"]);
    expect(restore).toHaveBeenCalledWith(["o1"], expect.any(String)); // ficha 362: QUIEN recupera
  });

  it("lote vacio -> ok(0) sin consultar", async () => {
    const { service, findByIdsForTransicion, restore } = escenario();

    const r = await service.recuperar({ ordenIds: [] }, MAESTRO);

    expect(r).toEqual({ status: "ok", recuperadas: 0 });
    expect(findByIdsForTransicion).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it("carrera benigna: informa lo que el SERVIDOR recupero, no el tamano del lote", async () => {
    // Otra sesion recupero `o2` entre la precarga y el `updateMany`: el `where` con
    // `deleted_at IS NOT NULL` la deja fuera y el conteo baja. No es un error.
    const findByIdsForTransicion = vi.fn(async () => [
      ordenRow({ id: "o1" }),
      ordenRow({ id: "o2" }),
    ]);
    const restore = vi.fn(async () => 1);
    const service = new RecuperarOrdenService({ findByIdsForTransicion, restore });

    const r = await service.recuperar({ ordenIds: ["o1", "o2"] }, MAESTRO);

    expect(r).toEqual({ status: "ok", recuperadas: 1 });
  });
});
