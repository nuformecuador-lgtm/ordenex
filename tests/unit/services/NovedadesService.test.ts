import { describe, it, expect, vi } from "vitest";
import { NovedadesService } from "@/lib/services/NovedadesService";
import type {
  CausaDevueltaVigente,
  IOrdenRepository,
  NovedadOrdenRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 87 (T6) — service de NOVEDADES con el repo mockeado (sin DB/HTTP). Cubre
// R1/R2/R3/R5/R6/R7/R21/R22. R3 se ejercita a nivel de contrato: el service SIEMPRE pide
// `"devuelta"` al repo (el filtrado por estatus lo impone el WHERE del repo, cubierto en T7).

const ADMIN: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "tienda-2", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const PAGE_SIZE = 10;

type RepoMethods = Pick<
  IOrdenRepository,
  "countDevueltasByTienda" | "findDevueltasByTienda" | "findCausasDevueltaVigentes"
>;

function ordenRow(overrides: Partial<NovedadOrdenRow> = {}): NovedadOrdenRow {
  return {
    id: "o1",
    numGuia: 100,
    destinatario: "Ana",
    telefonoDest: "88887777",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<RepoMethods> = {}): RepoMethods {
  return {
    countDevueltasByTienda: vi.fn(async () => 0),
    findDevueltasByTienda: vi.fn(async () => []),
    findCausasDevueltaVigentes: vi.fn(async () => new Map<string, CausaDevueltaVigente>()),
    ...overrides,
  };
}

describe("NovedadesService.listar (feature 87)", () => {
  it("R5: rol != adminTienda -> forbidden sin tocar el repo", async () => {
    for (const actor of [MENSAJERO, MAESTRO]) {
      const repo = fakeRepo();
      const service = new NovedadesService(repo);
      const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, actor);
      expect(res).toEqual({ status: "forbidden" });
      expect(repo.countDevueltasByTienda).not.toHaveBeenCalled();
      expect(repo.findDevueltasByTienda).not.toHaveBeenCalled();
    }
  });

  it("R2: acota al `tiendaId = actor.usuarioId` en count y en la lista", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 3),
      findDevueltasByTienda: vi.fn(async () => [ordenRow()]),
    });
    const service = new NovedadesService(repo);
    await service.listar({ page: 1, pageSize: PAGE_SIZE }, OTRA_TIENDA);

    expect(repo.countDevueltasByTienda).toHaveBeenCalledWith("tienda-2", "devuelta");
    expect(repo.findDevueltasByTienda).toHaveBeenCalledWith("tienda-2", "devuelta", {
      skip: 0,
      take: PAGE_SIZE,
    });
  });

  it("R1/R3: siempre pide el estatus `devuelta` al repo (no otros estatus)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [ordenRow()]),
    });
    const service = new NovedadesService(repo);
    await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    expect(repo.countDevueltasByTienda).toHaveBeenCalledWith("tienda-1", "devuelta");
    const [, estatusArg] = (repo.findDevueltasByTienda as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(estatusArg).toBe("devuelta");
  });

  it("R6: la causa es la de la ultima gestion `devuelta` vigente (via el mapa del repo)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 1),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
      findCausasDevueltaVigentes: vi.fn(
        async () =>
          new Map<string, CausaDevueltaVigente>([
            ["o1", { causa: "not_found", fecha: new Date("2026-02-01T00:00:00Z") }],
          ]),
      ),
    });
    const service = new NovedadesService(repo);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items[0].causa).toBe("not_found");
    // R8: una sola consulta agregada, con los ids de la pagina.
    expect(repo.findCausasDevueltaVigentes).toHaveBeenCalledTimes(1);
    expect(repo.findCausasDevueltaVigentes).toHaveBeenCalledWith(["o1"]);
  });

  it("R7: orden sin gestion vigente / causa nula -> causa null (no rompe)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 2),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "sin-gestion" }),
        ordenRow({ id: "causa-nula" }),
      ]),
      findCausasDevueltaVigentes: vi.fn(
        async () =>
          new Map<string, CausaDevueltaVigente>([
            // "sin-gestion" no aparece -> causa ausente; "causa-nula" con causa null.
            ["causa-nula", { causa: null, fecha: new Date("2026-01-05T00:00:00Z") }],
          ]),
      ),
    });
    const service = new NovedadesService(repo);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    const byId = new Map(res.items.map((i) => [i.id, i.causa]));
    expect(byId.get("sin-gestion")).toBeNull();
    expect(byId.get("causa-nula")).toBeNull();
  });

  it("R21: ordena por la fecha de la ultima gestion vigente desc (mas reciente primero)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 3),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "vieja", createdAt: new Date("2026-01-01T00:00:00Z") }),
        ordenRow({ id: "nueva", createdAt: new Date("2026-01-02T00:00:00Z") }),
      ]),
      findCausasDevueltaVigentes: vi.fn(
        async () =>
          new Map<string, CausaDevueltaVigente>([
            // La gestion mas reciente es la de "vieja", asi que debe quedar primera pese a
            // tener createdAt de orden anterior.
            ["vieja", { causa: "not_found", fecha: new Date("2026-03-10T00:00:00Z") }],
            ["nueva", { causa: "wrong_number", fecha: new Date("2026-03-01T00:00:00Z") }],
          ]),
      ),
    });
    const service = new NovedadesService(repo);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items.map((i) => i.id)).toEqual(["vieja", "nueva"]);
  });

  it("R21 (fallback): sin gestion vigente ordena por Orden.createdAt desc", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 2),
      findDevueltasByTienda: vi.fn(async () => [
        ordenRow({ id: "b", createdAt: new Date("2026-01-01T00:00:00Z") }),
        ordenRow({ id: "a", createdAt: new Date("2026-05-01T00:00:00Z") }),
      ]),
      // Sin causas vigentes -> mapa vacio -> fallback a createdAt de la orden.
      findCausasDevueltaVigentes: vi.fn(
        async () => new Map<string, CausaDevueltaVigente>(),
      ),
    });
    const service = new NovedadesService(repo);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("R22: respuesta { items, total, page, pageSize } y skip derivado de la pagina", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 25),
      findDevueltasByTienda: vi.fn(async () => [ordenRow({ id: "o1" })]),
    });
    const service = new NovedadesService(repo);
    const res = await service.listar({ page: 3, pageSize: PAGE_SIZE }, ADMIN);

    expect(res).toMatchObject({ status: "ok", total: 25, page: 3, pageSize: PAGE_SIZE });
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.items).toHaveLength(1);
    // page 3, pageSize 10 -> skip 20.
    expect(repo.findDevueltasByTienda).toHaveBeenCalledWith("tienda-1", "devuelta", {
      skip: 20,
      take: PAGE_SIZE,
    });
  });

  it("R8/R22: pagina vacia -> items [] con total, sin pedir causas (no N+1 en vacio)", async () => {
    const repo = fakeRepo({
      countDevueltasByTienda: vi.fn(async () => 0),
      findDevueltasByTienda: vi.fn(async () => []),
    });
    const service = new NovedadesService(repo);
    const res = await service.listar({ page: 1, pageSize: PAGE_SIZE }, ADMIN);

    expect(res).toEqual({ status: "ok", items: [], total: 0, page: 1, pageSize: PAGE_SIZE });
    expect(repo.findCausasDevueltaVigentes).not.toHaveBeenCalled();
  });
});
