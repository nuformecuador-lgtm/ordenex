import { describe, it, expect, vi } from "vitest";
import { RechazosSlaTiendaService } from "@/lib/services/RechazosSlaTiendaService";
import type { IOrdenRepository, RechazoSlaTiendaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { fakeIntentosEnLote, llamadasIntentos } from "@/tests/fixtures/intentos-entrega";

// Feature 102 (T8) — tests unit del RechazosSlaTiendaService (dobles de repo, sin DB/red). Cubre:
//   R12 la lista incluye las ordenes rechazadas por SLA de la tienda, con su monto de 56;
//   R13 acotada SIEMPRE a la tienda del actor (usuarioId); cualquier otro rol -> forbidden;
//   R15 orden no-rechazada/borrada no aparece (el predicado del repo la excluye; el service confia
//       en ese universo y no re-inventa filtros).

const ADMIN_TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const ADMIN_SATELITE: Actor = { usuarioId: "sat-1", rol: "adminSatelite" };
const MAESTRO: Actor = { usuarioId: "adm-1", rol: "maestro" };

type Repo = Pick<IOrdenRepository, "countRechazadasSlaByTienda" | "findRechazadasSlaByTienda">;

function row(overrides: Partial<RechazoSlaTiendaRow> = {}): RechazoSlaTiendaRow {
  return {
    id: "o1",
    numGuia: 100,
    numRemision: "REM-1",
    destinatario: "Ana",
    monto: "3.00",
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    countRechazadasSlaByTienda: vi.fn(async () => 0),
    findRechazadasSlaByTienda: vi.fn(async () => [] as RechazoSlaTiendaRow[]),
    ...overrides,
  };
}

const INPUT = { page: 1, pageSize: 10 };

// Feature 160: derivador de intentos EN LOTE, dependencia REQUERIDA del constructor. Por
// defecto Map vacio, que ejerce el `?? 0` del servicio (R14).
const intentos = fakeIntentosEnLote();

describe("RechazosSlaTiendaService.listar — autorizacion (R13)", () => {
  it("R13: rol mensajero -> forbidden, sin consultar el repo", async () => {
    const repo = fakeRepo();
    const service = new RechazosSlaTiendaService(repo, intentos);
    const r = await service.listar(INPUT, MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.countRechazadasSlaByTienda).not.toHaveBeenCalled();
    expect(repo.findRechazadasSlaByTienda).not.toHaveBeenCalled();
  });

  it("R13: rol adminSatelite -> forbidden (no es la superficie de la tienda)", async () => {
    const service = new RechazosSlaTiendaService(fakeRepo(), intentos);
    expect((await service.listar(INPUT, ADMIN_SATELITE)).status).toBe("forbidden");
  });

  it("R13: rol maestro -> forbidden (la superficie es del adminTienda)", async () => {
    const service = new RechazosSlaTiendaService(fakeRepo(), intentos);
    expect((await service.listar(INPUT, MAESTRO)).status).toBe("forbidden");
  });
});

describe("RechazosSlaTiendaService.listar — lista y acotamiento (R12/R13/R14/R15)", () => {
  it("R12/R14: devuelve las ordenes rechazadas por SLA de la tienda con su monto de 56 (STRING)", async () => {
    const repo = fakeRepo({
      countRechazadasSlaByTienda: vi.fn(async () => 2),
      findRechazadasSlaByTienda: vi.fn(async () => [
        row({ id: "o1", numGuia: 100, monto: "3.00" }),
        row({ id: "o2", numGuia: null, numRemision: "REM-2", destinatario: "Beto", monto: null }), // pendiente de cierre
      ]),
    });
    const service = new RechazosSlaTiendaService(repo, intentos);

    const r = await service.listar(INPUT, ADMIN_TIENDA);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.total).toBe(2);
    // Feature 160/R11: el DTO gana `intentosEntrega`. Se declara EXPLICITAMENTE en la asercion
    // (con el `0` del doble por defecto) en vez de relajarla a `toMatchObject`: la forma del
    // DTO es contrato y el cambio es deliberado.
    expect(r.items).toEqual([
      {
        id: "o1",
        numGuia: 100,
        numRemision: "REM-1",
        destinatario: "Ana",
        monto: "3.00",
        intentosEntrega: 0,
      },
      {
        id: "o2",
        numGuia: null,
        numRemision: "REM-2",
        destinatario: "Beto",
        monto: null,
        intentosEntrega: 0,
      },
    ]);
    expect(typeof r.items[0].monto).toBe("string"); // R18
  });

  it("R13: acota SIEMPRE al usuarioId del actor (tiendaId) en count y find", async () => {
    const repo = fakeRepo({
      countRechazadasSlaByTienda: vi.fn(async () => 1),
      findRechazadasSlaByTienda: vi.fn(async () => [row()]),
    });
    const service = new RechazosSlaTiendaService(repo, intentos);

    await service.listar({ page: 3, pageSize: 10 }, ADMIN_TIENDA);
    expect(repo.countRechazadasSlaByTienda).toHaveBeenCalledWith("tienda-1");
    // skip derivado de la pagina (1-based): (3-1)*10 = 20.
    expect(repo.findRechazadasSlaByTienda).toHaveBeenCalledWith("tienda-1", { skip: 20, take: 10 });
  });

  it("R15: si el predicado del repo no devuelve ninguna (no-rechazada/borrada excluidas) -> lista vacia", async () => {
    const repo = fakeRepo({
      countRechazadasSlaByTienda: vi.fn(async () => 0),
      findRechazadasSlaByTienda: vi.fn(async () => []),
    });
    const service = new RechazosSlaTiendaService(repo, intentos);

    const r = await service.listar(INPUT, ADMIN_TIENDA);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });
});

// --- Feature 160 (T12): el conteo de intentos en la lista de rechazadas por plazo ---

describe("RechazosSlaTiendaService.listar — intentos en lote (160/R11-R15/R26)", () => {
  it("R11/R14: cada rechazo sale con `intentosEntrega` numerico, el `0` INCLUIDO", async () => {
    const repo = fakeRepo({
      countRechazadasSlaByTienda: vi.fn(async () => 2),
      findRechazadasSlaByTienda: vi.fn(async () => [row({ id: "r1" }), row({ id: "r2" })]),
    });
    // `r2` no viene en el mapa -> 0.
    const doble = fakeIntentosEnLote({ r1: 3 });
    const r = await new RechazosSlaTiendaService(repo, doble).listar(INPUT, ADMIN_TIENDA);

    if (r.status !== "ok") throw new Error("esperaba ok");
    const porId = new Map(r.items.map((i) => [i.id, i.intentosEntrega]));
    // 3 es el conteo que llevo a esta orden al escalado: el MISMO numero, no otro.
    expect(porId.get("r1")).toBe(3);
    expect(porId.get("r2")).toBe(0);
  });

  it("R12/R15: UNA sola llamada, con los ids de la pagina YA acotada a la tienda del actor", async () => {
    const repo = fakeRepo({
      countRechazadasSlaByTienda: vi.fn(async () => 2),
      findRechazadasSlaByTienda: vi.fn(async () => [row({ id: "r1" }), row({ id: "r2" })]),
    });
    const doble = fakeIntentosEnLote();
    await new RechazosSlaTiendaService(repo, doble).listar(INPUT, ADMIN_TIENDA);

    expect(doble.contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(llamadasIntentos(doble)).toEqual([["r1", "r2"]]);
    expect(repo.findRechazadasSlaByTienda).toHaveBeenCalledWith("tienda-1", {
      skip: 0,
      take: 10,
    });
  });

  it("R13: pagina vacia -> el derivador recibe el lote vacio (y no consulta)", async () => {
    const doble = fakeIntentosEnLote();
    await new RechazosSlaTiendaService(fakeRepo(), doble).listar(INPUT, ADMIN_TIENDA);
    expect(llamadasIntentos(doble)).toEqual([[]]);
  });

  it("R15: un rol no autorizado ni siquiera llega al derivador", async () => {
    const doble = fakeIntentosEnLote();
    const r = await new RechazosSlaTiendaService(fakeRepo(), doble).listar(INPUT, MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(doble.contarIntentosEnLote).not.toHaveBeenCalled();
  });
});
