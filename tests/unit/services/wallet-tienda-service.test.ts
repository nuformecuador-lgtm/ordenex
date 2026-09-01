import { describe, it, expect, vi } from "vitest";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

// Feature 43/T12 — tests unit del WalletTiendaService (dobles de repo, sin DB). Cubre R16/R17
// (saldo derivado STRING+signo, negativo/positivo/cero), R19 (acotado a tienda_id + forbidden
// por rol), R20 (maestro ve todas las tiendas), R22 (filtros en el WHERE), R3/R29 (sin
// update/delete; correccion = ajuste compensatorio).

const TIENDA: Actor = { usuarioId: "t1", rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "t2", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" }; // feature 94: paridad con maestro
const MENSAJERO: Actor = { usuarioId: "x1", rol: "mensajero" };

function fakeRepo(overrides: Partial<IWalletTiendaMovimientoRepository> = {}): IWalletTiendaMovimientoRepository {
  return {
    crearMovimientos: vi.fn(async () => 0),
    listarPorTienda: vi.fn(async () => ({ movimientos: [], total: 0 })),
    agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "0.00", debitos: "0.00" })),
    listarSaldosTodasTiendas: vi.fn(async () => []),
    // Feature 170 (T I.1): saldos paginados; su suite es `saldos-tiendas-paginado.test.ts`.
    listarSaldosTiendasPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    // Feature 171: el doble implementa la interfaz COMPLETA. El desglose por tienda lo
    // ejercita `wallet-tienda-desglose.test.ts`; aqui solo tiene que existir.
    agregarDesglosePorTienda: vi.fn(async () => []),
    // Ficha 335: el doble sigue implementando la interfaz COMPLETA. La lectura de cierres
    // la ejercita `tests/unit/services/mi-wallet-cierres.test.ts`; aqui solo tiene que existir.
    listarCierresDeTienda: vi.fn(async () => []),
    // Ficha 344: la lectura por id acotada a la tienda. Este doble no la ejercita.
    obtenerPorIdDeTienda: vi.fn(async () => null),
    ...overrides,
  };
}

describe("WalletTiendaService.verMiSaldo (R16/R17/R19)", () => {
  it("R19: acota al tienda_id del actor (= usuarioId) en la agregacion", async () => {
    const repo = fakeRepo({ agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "10000.00", debitos: "1500.00" })) });
    const svc = new WalletTiendaService(repo);
    const r = await svc.verMiSaldo(TIENDA);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(repo.agregarSaldoPorTienda).toHaveBeenCalledWith("t1", {});
    expect(r.saldo).toEqual({ creditos: "10000.00", debitos: "1500.00", saldo: "8500.00", signo: "positivo" });
  });

  it("R17: saldo NEGATIVO (tienda con solo devoluciones) -> '-...' + signo negativo", async () => {
    const repo = fakeRepo({ agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "0.00", debitos: "452.00" })) });
    const svc = new WalletTiendaService(repo);
    const r = await svc.verMiSaldo(TIENDA);
    if (r.status !== "ok") throw new Error("ok");
    expect(r.saldo.saldo).toBe("-452.00");
    expect(r.saldo.signo).toBe("negativo");
  });

  it("R17: saldo CERO -> '0.00' + signo cero", async () => {
    const repo = fakeRepo({ agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "100.00", debitos: "100.00" })) });
    const svc = new WalletTiendaService(repo);
    const r = await svc.verMiSaldo(TIENDA);
    if (r.status !== "ok") throw new Error("ok");
    expect(r.saldo.saldo).toBe("0.00");
    expect(r.saldo.signo).toBe("cero");
  });

  it("R19: rol NO adminTienda (maestro/mensajero) -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const svc = new WalletTiendaService(repo);
    expect((await svc.verMiSaldo(MAESTRO)).status).toBe("forbidden");
    expect((await svc.verMiSaldo(MENSAJERO)).status).toBe("forbidden");
    expect(repo.agregarSaldoPorTienda).not.toHaveBeenCalled();
  });
});

describe("WalletTiendaService.listarMisMovimientos (R19/R22)", () => {
  it("R19: acota SIEMPRE al tienda_id del actor; NO permite mirar otra tienda", async () => {
    const repo = fakeRepo();
    const svc = new WalletTiendaService(repo);
    await svc.listarMisMovimientos({ page: 1, pageSize: 20 }, OTRA_TIENDA);
    // el tiendaId del WHERE es el del actor (t2), nunca uno provisto por el input.
    const arg = (repo.listarPorTienda as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.tiendaId).toBe("t2");
  });

  it("R22: pasa los filtros cierre/categoria/fecha al repo (WHERE), tanto en listado como en saldo", async () => {
    const repo = fakeRepo({
      listarPorTienda: vi.fn(async () => ({ movimientos: [], total: 3 })),
      agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "1000.00", debitos: "0.00" })),
    });
    const svc = new WalletTiendaService(repo);
    const desde = new Date("2026-07-01T00:00:00.000Z");
    const hasta = new Date("2026-07-31T00:00:00.000Z");
    const categoria: WalletTiendaMovimientoCategoria = "flete";

    const r = await svc.listarMisMovimientos(
      { page: 2, pageSize: 10, cierreId: "c1", categoria, desde, hasta },
      TIENDA,
    );
    if (r.status !== "ok") throw new Error("ok");

    expect(repo.listarPorTienda).toHaveBeenCalledWith({
      tiendaId: "t1",
      page: 2,
      pageSize: 10,
      cierreId: "c1",
      categoria,
      desde,
      hasta,
    });
    // R22: el saldo se agrega con los MISMOS filtros (conjunto filtrado).
    expect(repo.agregarSaldoPorTienda).toHaveBeenCalledWith("t1", { cierreId: "c1", categoria, desde, hasta });
    expect(r.data.total).toBe(3);
    expect(r.data.saldo.saldo).toBe("1000.00");
    expect(r.data.page).toBe(2);
  });

  it("R19: rol NO adminTienda -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const svc = new WalletTiendaService(repo);
    expect((await svc.listarMisMovimientos({ page: 1, pageSize: 20 }, MAESTRO)).status).toBe("forbidden");
    expect(repo.listarPorTienda).not.toHaveBeenCalled();
  });
});

describe("WalletTiendaService.listarSaldosTiendas (R20)", () => {
  it("maestro ve el saldo DERIVADO de todas las tiendas (una fila por tienda, con signo)", async () => {
    const repo = fakeRepo({
      listarSaldosTodasTiendas: vi.fn(async () => [
        { tiendaId: "t1", tiendaNombre: "Tienda Uno", creditos: "10000.00", debitos: "1695.00" },
        { tiendaId: "t2", tiendaNombre: "Tienda Dos", creditos: "0.00", debitos: "452.00" },
        { tiendaId: "t3", tiendaNombre: "Tienda Tres", creditos: "500.00", debitos: "500.00" },
      ]),
    });
    const svc = new WalletTiendaService(repo);
    const r = await svc.listarSaldosTiendas(MAESTRO);
    if (r.status !== "ok") throw new Error("ok");
    expect(r.tiendas).toEqual([
      { tiendaId: "t1", tiendaNombre: "Tienda Uno", saldo: "8305.00", signo: "positivo" },
      { tiendaId: "t2", tiendaNombre: "Tienda Dos", saldo: "-452.00", signo: "negativo" },
      { tiendaId: "t3", tiendaNombre: "Tienda Tres", saldo: "0.00", signo: "cero" },
    ]);
  });

  it("feature 94: admin ve el saldo de todas las tiendas (paridad con maestro)", async () => {
    const repo = fakeRepo({
      listarSaldosTodasTiendas: vi.fn(async () => [
        { tiendaId: "t1", tiendaNombre: "Tienda Uno", creditos: "10000.00", debitos: "1695.00" },
      ]),
    });
    const svc = new WalletTiendaService(repo);
    const r = await svc.listarSaldosTiendas(ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.listarSaldosTodasTiendas).toHaveBeenCalled();
  });

  it("R20: rol sin acceso total (adminTienda/mensajero) -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const svc = new WalletTiendaService(repo);
    expect((await svc.listarSaldosTiendas(TIENDA)).status).toBe("forbidden");
    expect((await svc.listarSaldosTiendas(MENSAJERO)).status).toBe("forbidden");
    expect(repo.listarSaldosTodasTiendas).not.toHaveBeenCalled();
  });
});

describe("WalletTiendaService — inmutabilidad (R3/R29)", () => {
  it("el service NO expone update/delete; la unica escritura del repo es crearMovimientos (append-only)", () => {
    // R3/R29: la correccion es un ajuste compensatorio (crearMovimientos con categoria
    // ajuste_credito/ajuste_debito), nunca un UPDATE/DELETE. El service de lectura no expone
    // ninguna mutacion; el repo tampoco expone update/delete.
    const svc = new WalletTiendaService(fakeRepo());
    expect((svc as unknown as Record<string, unknown>).actualizar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).eliminar).toBeUndefined();
    const repo = fakeRepo() as unknown as Record<string, unknown>;
    expect(repo.actualizarMovimiento).toBeUndefined();
    expect(repo.eliminarMovimiento).toBeUndefined();
    // La categoria de ajuste compensatorio existe en el modelo (usable sin migracion).
    const ajuste: WalletTiendaMovimientoCategoria = "ajuste_credito";
    expect(ajuste).toBe("ajuste_credito");
  });
});
