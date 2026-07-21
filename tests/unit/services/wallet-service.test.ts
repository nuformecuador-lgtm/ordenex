import { describe, it, expect, vi } from "vitest";
import { WalletService } from "@/lib/services/WalletService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// Feature 42 — tests unit del WalletService (R1/R3/R15/R16/R19/R20/R25). Guardia de rol
// maestro; manual inmutable (no update/delete); DTOs con montos STRING.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" }; // feature 94: paridad con maestro
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };

function mov(overrides: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id: "w1",
    tipo: "ingreso",
    categoria: "ingreso_flete",
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-07-12T10:00:00.000Z",
    ...overrides,
  };
}

function buildRepo(): IWalletMovimientoRepository {
  return {
    crearMovimientos: vi.fn().mockResolvedValue(1),
    listar: vi.fn().mockResolvedValue({ movimientos: [mov()], total: 1 }),
    agregarBalance: vi.fn().mockResolvedValue({ ingresos: "1000.00", egresos: "300.00" }),
    obtenerPorId: vi.fn().mockResolvedValue(null),
    agregarPorCategoria: vi
      .fn()
      .mockResolvedValue({ gastoFijo: "0.00", gastoVariable: "0.00", sueldo: "0.00" }),
  };
}

const writeClient = {} as WalletTxClient;

describe("WalletService.listarMovimientos (R19/R20)", () => {
  it("R19: rol no autorizado -> forbidden, sin tocar el repo", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.listarMovimientos({ page: 1, pageSize: 20 }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> ok (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.listarMovimientos({ page: 1, pageSize: 20 }, ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.listar).toHaveBeenCalled();
  });

  it("R20: maestro -> ok; pasa filtros al repo; DTO con monto STRING", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const desde = new Date("2026-07-01T00:00:00.000Z");
    const r = await svc.listarMovimientos(
      { page: 2, pageSize: 10, tipo: "ingreso", categoria: "ingreso_flete", desde },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.data.page).toBe(2);
    expect(r.data.pageSize).toBe(10);
    expect(typeof r.data.movimientos[0].monto).toBe("string");
    expect(repo.listar).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      tipo: "ingreso",
      categoria: "ingreso_flete",
      desde,
      hasta: undefined,
    });
  });
});

describe("WalletService.verBalance (R16/R19)", () => {
  it("R19: rol no autorizado -> forbidden, sin exponer balance", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.verBalance({ page: 1, pageSize: 20 }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.agregarBalance).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> balance derivado (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.verBalance({ page: 1, pageSize: 20 }, ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.agregarBalance).toHaveBeenCalled();
  });

  it("R16: maestro -> balance derivado (STRING+signo) del conjunto filtrado", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.verBalance({ page: 1, pageSize: 20 }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.balance).toEqual({
      ingresos: "1000.00",
      egresos: "300.00",
      balance: "700.00",
      signo: "positivo",
    });
    expect(typeof r.balance.balance).toBe("string");
  });
});

describe("WalletService.registrarMovimientoManual (R1/R3/R15/R19)", () => {
  it("R19: rol no autorizado -> forbidden, sin crear nada", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.registrarMovimientoManual(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "x" },
      OTRO,
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> crea manual (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.registrarMovimientoManual(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "x" },
      ADMIN,
    );
    expect(r.status).toBe("ok");
    const arg = (repo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(arg[0]).toMatchObject({ registradoPor: "u-admin", origenTipo: "manual" });
  });

  it("R15: maestro -> crea manual con origen_tipo manual, origen_id null, registrado_por actor", async () => {
    const repo = buildRepo();
    (repo.listar as ReturnType<typeof vi.fn>).mockResolvedValue({
      movimientos: [mov({ id: "w-manual", tipo: "egreso", categoria: "egreso_ajuste", monto: "50.00", origenTipo: "manual", origenId: null, descripcion: "correccion", registradoPor: "u-maestro" })],
      total: 1,
    });
    const svc = new WalletService(repo, writeClient);
    const r = await svc.registrarMovimientoManual(
      { tipo: "egreso", categoria: "egreso_ajuste", monto: "50.00", descripcion: "correccion" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    const arg = (repo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(arg[0]).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_ajuste",
      monto: "50.00",
      origenTipo: "manual",
      origenId: null,
      descripcion: "correccion",
      registradoPor: "u-maestro",
    });
  });

  it("R3: el servicio NO expone update ni delete (solo listar/verBalance/registrarManual)", () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    expect((svc as unknown as Record<string, unknown>).actualizar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).eliminar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
    // R3: el repo tampoco expone update/delete de movimientos.
    expect((repo as unknown as Record<string, unknown>).actualizar).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).eliminar).toBeUndefined();
  });
});
