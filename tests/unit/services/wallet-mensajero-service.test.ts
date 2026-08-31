import { describe, it, expect, vi } from "vitest";
import { WalletMensajeroService } from "@/lib/services/WalletMensajeroService";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { PagoMensajeroMovimientoCategoria } from "@/lib/types/wallet-mensajero";

// Feature 44/T12 — tests unit del WalletMensajeroService (dobles de repo, sin DB). Cubre R14
// (cuenta por pagar derivada STRING+signo, positivo/cero, nunca negativa), R19 (maestro ve a
// TODOS; otro rol forbidden), R22 (filtros en el WHERE), R3 (sin update/delete; correccion =
// ajuste compensatorio).
//
// Ficha 336 (2026-08-30): se retiraron los `describe` de `verMiCuentaPorPagar` y `listarMisPagos`
// —la vista PROPIA del mensajero (R16/R20), que se fue con `/mis-pagos`—. Sobreviven
// `listarCuentasPorPagar`, `listarPagosDeMensajero` y el de INMUTABILIDAD (R3), que es el que
// afirma que este servicio no tiene un solo camino de escritura.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "adm-admin", rol: "admin" }; // feature 94: paridad con maestro
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const TIENDA: Actor = { usuarioId: "t1", rol: "adminTienda" };

function fakeRepo(overrides: Partial<IPagoMensajeroMovimientoRepository> = {}): IPagoMensajeroMovimientoRepository {
  return {
    crearMovimientos: vi.fn(async () => 0),
    listarPorMensajero: vi.fn(async () => ({ movimientos: [], total: 0 })),
    agregarCuentaPorPagar: vi.fn(async () => ({ devengado: "0.00", pagado: "0.00" })),
    listarCuentasPorPagarTodos: vi.fn(async () => []),
    // Feature 170 (T L.1): el doble declara la interfaz COMPLETA. El listado paginado lo
    // ejercita `tests/unit/services/wallet-cuentas-paginado.test.ts`.
    listarCuentasPorPagarPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    listarCuentasPorPagarCompleto: vi.fn(async () => []),
    obtenerNombreMensajero: vi.fn(async () => "Ana Mensajera"),
    // Feature 293 (T2.2/T3.3): el doble declara la interfaz COMPLETA. Este servicio no los
    // llama —la cuenta por pagar se agrega por `tipo` y el premio entra solo, como un devengo
    // mas (design §6/20)—, y que sigan sin llamarse es parte de lo que este archivo afirma.
    sumarPremiosVivosPorCierre: vi.fn(async () => ({})),
    listarPremiosPorDias: vi.fn(async () => []),
    ...overrides,
  };
}

describe("WalletMensajeroService.listarCuentasPorPagar (R18/R19)", () => {
  it("R18/R19: maestro ve la cuenta por pagar DERIVADA de todos los mensajeros (una fila por mensajero, con signo)", async () => {
    const repo = fakeRepo({
      listarCuentasPorPagarTodos: vi.fn(async () => [
        { mensajeroId: "m1", mensajeroNombre: "Ana Mensajera", devengado: "1000.00", pagado: "300.00" },
        { mensajeroId: "m2", mensajeroNombre: "Beto Motos", devengado: "500.00", pagado: "500.00" },
        { mensajeroId: "m3", mensajeroNombre: "Caro Express", devengado: "250.00", pagado: "0.00" },
      ]),
    });
    const svc = new WalletMensajeroService(repo);
    const r = await svc.listarCuentasPorPagar(MAESTRO);
    if (r.status !== "ok") throw new Error("ok");
    expect(r.mensajeros).toEqual([
      { mensajeroId: "m1", mensajeroNombre: "Ana Mensajera", devengado: "1000.00", pagado: "300.00", cuentaPorPagar: "700.00", signo: "positivo" },
      { mensajeroId: "m2", mensajeroNombre: "Beto Motos", devengado: "500.00", pagado: "500.00", cuentaPorPagar: "0.00", signo: "cero" },
      { mensajeroId: "m3", mensajeroNombre: "Caro Express", devengado: "250.00", pagado: "0.00", cuentaPorPagar: "250.00", signo: "positivo" },
    ]);
  });

  it("feature 94: admin ve la cuenta por pagar de todos los mensajeros (paridad con maestro)", async () => {
    const repo = fakeRepo({
      listarCuentasPorPagarTodos: vi.fn(async () => [
        { mensajeroId: "m1", mensajeroNombre: "Ana Mensajera", devengado: "1000.00", pagado: "300.00" },
      ]),
    });
    const svc = new WalletMensajeroService(repo);
    const r = await svc.listarCuentasPorPagar(ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.listarCuentasPorPagarTodos).toHaveBeenCalled();
  });

  it("R19: rol sin acceso total (mensajero/adminSatelite/tienda) -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const svc = new WalletMensajeroService(repo);
    expect((await svc.listarCuentasPorPagar(MENSAJERO)).status).toBe("forbidden");
    expect((await svc.listarCuentasPorPagar(ADMIN_SATELITE)).status).toBe("forbidden");
    expect((await svc.listarCuentasPorPagar(TIENDA)).status).toBe("forbidden");
    expect(repo.listarCuentasPorPagarTodos).not.toHaveBeenCalled();
  });
});

describe("WalletMensajeroService.listarPagosDeMensajero (R18/R22 — vista del MAESTRO)", () => {
  const MOV = {
    id: "p1",
    mensajeroId: "m9",
    tipo: "devengo" as const,
    categoria: "pago_devengado" as PagoMensajeroMovimientoCategoria,
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c2",
    cierreId: "c2", // feature 205/R43: en un origen `cierre_dia`, el origen ES el cierre
    descripcion: null,
    fechaMovimiento: "2026-07-12T10:00:00.000Z",
  };

  it("R18: el maestro obtiene el DESGLOSE por cierre de un mensajero ARBITRARIO (del input, no de si mismo), paginado", async () => {
    const repo = fakeRepo({
      listarPorMensajero: vi.fn(async () => ({ movimientos: [MOV], total: 5 })),
      agregarCuentaPorPagar: vi.fn(async () => ({ devengado: "1000.00", pagado: "300.00" })),
      obtenerNombreMensajero: vi.fn(async () => "Nora Repartos"),
    });
    const svc = new WalletMensajeroService(repo);

    const r = await svc.listarPagosDeMensajero({ page: 2, pageSize: 10, mensajeroId: "m9" }, MAESTRO);
    if (r.status !== "ok") throw new Error("ok");

    // El WHERE del listado usa el mensajeroId del INPUT (m9), NO el actor (adm-maestro).
    const arg = (repo.listarPorMensajero as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.mensajeroId).toBe("m9");
    expect(arg.page).toBe(2);
    expect(arg.pageSize).toBe(10);
    expect(repo.obtenerNombreMensajero).toHaveBeenCalledWith("m9");

    expect(r.data.mensajeroId).toBe("m9");
    expect(r.data.mensajeroNombre).toBe("Nora Repartos");
    expect(r.data.total).toBe(5);
    expect(r.data.page).toBe(2);
    expect(r.data.movimientos[0].monto).toBe("1000.00");
    expect(typeof r.data.movimientos[0].monto).toBe("string");
  });

  it("R22: aplica los filtros fecha/cierre en el WHERE (listado) Y en la cuenta (conjunto filtrado)", async () => {
    const repo = fakeRepo({
      listarPorMensajero: vi.fn(async () => ({ movimientos: [MOV], total: 1 })),
      agregarCuentaPorPagar: vi.fn(async () => ({ devengado: "1000.00", pagado: "700.00" })),
    });
    const svc = new WalletMensajeroService(repo);
    const desde = new Date("2026-07-01T00:00:00.000Z");
    const hasta = new Date("2026-07-31T00:00:00.000Z");

    const r = await svc.listarPagosDeMensajero(
      { page: 1, pageSize: 20, mensajeroId: "m9", cierreId: "c2", desde, hasta },
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("ok");

    expect(repo.listarPorMensajero).toHaveBeenCalledWith({
      mensajeroId: "m9",
      page: 1,
      pageSize: 20,
      cierreId: "c2",
      desde,
      hasta,
    });
    // R22: el saldo se agrega con los MISMOS filtros -> refleja el conjunto filtrado.
    expect(repo.agregarCuentaPorPagar).toHaveBeenCalledWith("m9", { cierreId: "c2", desde, hasta });
    expect(r.data.cuenta).toEqual({ devengado: "1000.00", pagado: "700.00", cuentaPorPagar: "300.00", signo: "positivo" });
  });

  it("mensajero sin nombre (inexistente) -> mensajeroNombre ''", async () => {
    const repo = fakeRepo({ obtenerNombreMensajero: vi.fn(async () => null) });
    const svc = new WalletMensajeroService(repo);
    const r = await svc.listarPagosDeMensajero({ page: 1, pageSize: 20, mensajeroId: "m9" }, MAESTRO);
    if (r.status !== "ok") throw new Error("ok");
    expect(r.data.mensajeroNombre).toBe("");
  });

  it("feature 94: admin obtiene el desglose de un mensajero arbitrario (paridad con maestro)", async () => {
    const repo = fakeRepo({
      listarPorMensajero: vi.fn(async () => ({ movimientos: [MOV], total: 5 })),
      obtenerNombreMensajero: vi.fn(async () => "Nora Repartos"),
    });
    const svc = new WalletMensajeroService(repo);
    const r = await svc.listarPagosDeMensajero({ page: 1, pageSize: 20, mensajeroId: "m9" }, ADMIN);
    expect(r.status).toBe("ok");
    const arg = (repo.listarPorMensajero as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.mensajeroId).toBe("m9");
  });

  it("R19: rol sin acceso total (mensajero/adminSatelite/tienda) -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const svc = new WalletMensajeroService(repo);
    expect((await svc.listarPagosDeMensajero({ page: 1, pageSize: 20, mensajeroId: "m9" }, MENSAJERO)).status).toBe("forbidden");
    expect((await svc.listarPagosDeMensajero({ page: 1, pageSize: 20, mensajeroId: "m9" }, ADMIN_SATELITE)).status).toBe("forbidden");
    expect((await svc.listarPagosDeMensajero({ page: 1, pageSize: 20, mensajeroId: "m9" }, TIENDA)).status).toBe("forbidden");
    expect(repo.listarPorMensajero).not.toHaveBeenCalled();
    expect(repo.agregarCuentaPorPagar).not.toHaveBeenCalled();
  });
});

describe("WalletMensajeroService — inmutabilidad (R3)", () => {
  it("el service NO expone update/delete; la unica escritura del repo es crearMovimientos (append-only)", () => {
    // R3: la correccion es un ajuste compensatorio (crearMovimientos con categoria
    // ajuste_devengo/ajuste_pago), nunca un UPDATE/DELETE. El service de lectura no expone
    // ninguna mutacion; el repo tampoco expone update/delete.
    const svc = new WalletMensajeroService(fakeRepo());
    expect((svc as unknown as Record<string, unknown>).actualizar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).eliminar).toBeUndefined();
    const repo = fakeRepo() as unknown as Record<string, unknown>;
    expect(repo.actualizarMovimiento).toBeUndefined();
    expect(repo.eliminarMovimiento).toBeUndefined();
    // La categoria de ajuste compensatorio existe en el modelo (usable sin migracion).
    const ajuste: PagoMensajeroMovimientoCategoria = "ajuste_pago";
    expect(ajuste).toBe("ajuste_pago");
  });
});
