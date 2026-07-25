import { describe, it, expect, vi } from "vitest";
import { RechazosSlaTiendaService } from "@/lib/services/RechazosSlaTiendaService";
import type { IOrdenRepository, RechazoSlaTiendaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

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

describe("RechazosSlaTiendaService.listar — autorizacion (R13)", () => {
  it("R13: rol mensajero -> forbidden, sin consultar el repo", async () => {
    const repo = fakeRepo();
    const service = new RechazosSlaTiendaService(repo);
    const r = await service.listar(INPUT, MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.countRechazadasSlaByTienda).not.toHaveBeenCalled();
    expect(repo.findRechazadasSlaByTienda).not.toHaveBeenCalled();
  });

  it("R13: rol adminSatelite -> forbidden (no es la superficie de la tienda)", async () => {
    const service = new RechazosSlaTiendaService(fakeRepo());
    expect((await service.listar(INPUT, ADMIN_SATELITE)).status).toBe("forbidden");
  });

  it("R13: rol maestro -> forbidden (la superficie es del adminTienda)", async () => {
    const service = new RechazosSlaTiendaService(fakeRepo());
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
    const service = new RechazosSlaTiendaService(repo);

    const r = await service.listar(INPUT, ADMIN_TIENDA);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.total).toBe(2);
    expect(r.items).toEqual([
      { id: "o1", numGuia: 100, numRemision: "REM-1", destinatario: "Ana", monto: "3.00" },
      { id: "o2", numGuia: null, numRemision: "REM-2", destinatario: "Beto", monto: null },
    ]);
    expect(typeof r.items[0].monto).toBe("string"); // R18
  });

  it("R13: acota SIEMPRE al usuarioId del actor (tiendaId) en count y find", async () => {
    const repo = fakeRepo({
      countRechazadasSlaByTienda: vi.fn(async () => 1),
      findRechazadasSlaByTienda: vi.fn(async () => [row()]),
    });
    const service = new RechazosSlaTiendaService(repo);

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
    const service = new RechazosSlaTiendaService(repo);

    const r = await service.listar(INPUT, ADMIN_TIENDA);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });
});
