import { describe, it, expect, vi } from "vitest";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";

// Feature 45 (R1/R2/R3/R7/R11/R13/R15/R16/R17/R32) — tests unit del WalletEgresoService.
// Guardia de rol maestro; egreso manual inmutable (origen_tipo=gasto, origen_id=null,
// registrado_por=actor); reversa append-only (ingreso_ajuste de igual monto, ref original,
// idempotente); reversa aplica tambien a egresos generados por el cron; desglose por tipo.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" }; // feature 94: paridad con maestro
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };

function mov(overrides: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  const base = {
    id: "eg-1",
    tipo: "egreso" as const,
    categoria: "egreso_gasto_variable" as const,
    monto: "1500.00",
    origenTipo: "gasto" as const,
    origenId: null,
    descripcion: "Papeleria",
    registradoPor: "u-maestro",
    fechaMovimiento: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
  // Feature 231 (R31): `dueno` sale de la MISMA clasificacion que usa el repositorio.
  return { ...base, dueno: overrides.dueno ?? NATURALEZA_POR_CATEGORIA[base.categoria] };
}

function buildRepo(overrides: Partial<IWalletMovimientoRepository> = {}): IWalletMovimientoRepository {
  return {
    crearMovimientos: vi.fn().mockResolvedValue(1),
    listar: vi.fn().mockResolvedValue({ movimientos: [mov()], total: 1 }),
    agregarPorCategoriaYTipo: vi.fn().mockResolvedValue([]),
    obtenerPorId: vi.fn().mockResolvedValue(null),
    agregarPorCategoria: vi
      .fn()
      .mockResolvedValue({
        gastoFijo: "0.00",
        gastoVariable: "0.00",
        sueldo: "0.00",
        indemnizacion: "0.00", // feature 158/R32
      }),
    ...overrides,
  };
}

const writeClient = {} as WalletTxClient;

function crearMovCall(repo: IWalletMovimientoRepository) {
  return (repo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1][0];
}

describe("WalletEgresoService.registrarEgreso (R1/R2/R3/R7/R17)", () => {
  it("R17: rol no autorizado -> forbidden, sin tocar el repo", async () => {
    const repo = buildRepo();
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.registrarEgreso(
      { tipoEgreso: "gasto_variable", monto: "100.00", descripcion: "x" },
      OTRO,
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> registra egreso (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.registrarEgreso(
      { tipoEgreso: "gasto_variable", monto: "100.00", descripcion: "x" },
      ADMIN,
    );
    expect(r.status).toBe("ok");
    expect(crearMovCall(repo)).toMatchObject({ registradoPor: "u-admin", origenTipo: "gasto" });
  });

  it("R2: gasto variable -> categoria egreso_gasto_variable; egreso/gasto/origen_id null/registrado_por actor", async () => {
    const repo = buildRepo();
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.registrarEgreso(
      { tipoEgreso: "gasto_variable", monto: "1500.00", descripcion: "Papeleria" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(crearMovCall(repo)).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_gasto_variable",
      monto: "1500.00",
      origenTipo: "gasto",
      origenId: null,
      descripcion: "Papeleria",
      registradoPor: "u-maestro",
    });
  });

  it("R2: sueldo -> categoria egreso_sueldo (texto libre en la descripcion)", async () => {
    const repo = buildRepo({
      listar: vi.fn().mockResolvedValue({
        movimientos: [mov({ categoria: "egreso_sueldo", monto: "500000.00", descripcion: "Juan Perez — julio 2026" })],
        total: 1,
      }),
    });
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.registrarEgreso(
      { tipoEgreso: "sueldo", monto: "500000.00", descripcion: "Juan Perez — julio 2026" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(crearMovCall(repo)).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_sueldo",
      origenTipo: "gasto",
      origenId: null,
      registradoPor: "u-maestro",
    });
  });

  it("R7: persiste con un unico crearMovimientos (un solo INSERT)", async () => {
    const repo = buildRepo();
    const svc = new WalletEgresoService(repo, writeClient);
    await svc.registrarEgreso(
      { tipoEgreso: "gasto_variable", monto: "10.00", descripcion: "x" },
      MAESTRO,
    );
    expect(repo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect((repo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1]).toHaveLength(1);
  });
});

describe("WalletEgresoService.reversarEgreso (R13/R15/R16/R17/R32)", () => {
  it("R17: rol no autorizado -> forbidden, sin leer ni crear", async () => {
    const repo = buildRepo();
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.reversarEgreso({ movimientoId: "eg-1" }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.obtenerPorId).not.toHaveBeenCalled();
    expect(repo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> reversa egreso (paridad con maestro)", async () => {
    const original = mov({ id: "eg-9", monto: "10.00" });
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(original) });
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.reversarEgreso({ movimientoId: "eg-9" }, ADMIN);
    expect(r).toEqual({ status: "ok" });
    expect(crearMovCall(repo)).toMatchObject({ registradoPor: "u-admin", categoria: "ingreso_ajuste" });
  });

  it("R13/R16: reversa crea ingreso_ajuste de IGUAL monto (leido server-side) referenciando el original", async () => {
    const original = mov({ id: "eg-9", monto: "2222.22", descripcion: "Internet oficina", origenId: null });
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(original) });
    const svc = new WalletEgresoService(repo, writeClient);
    // El cliente NO provee el monto: el service lo toma del original.
    const r = await svc.reversarEgreso({ movimientoId: "eg-9" }, MAESTRO);
    expect(r).toEqual({ status: "ok" });
    expect(crearMovCall(repo)).toMatchObject({
      tipo: "ingreso",
      categoria: "ingreso_ajuste",
      monto: "2222.22", // igual al original (server-side)
      origenTipo: "gasto",
      origenId: "eg-9", // referencia el egreso original
      registradoPor: "u-maestro",
    });
    expect(crearMovCall(repo).descripcion).toContain("Internet oficina");
  });

  it("R32: reversa aplica tambien a un egreso GENERADO POR EL CRON (categoria egreso_gasto_fijo)", async () => {
    // El egreso del cron tiene origen_id derivado "<plantilla>:<periodo>"; la reversa referencia
    // su ID (uuid), distinto del origen_id derivado.
    const cronEgreso = mov({
      id: "eg-cron",
      categoria: "egreso_gasto_fijo",
      monto: "80000.00",
      origenTipo: "gasto",
      origenId: "p-alquiler:2026-07",
      descripcion: "Alquiler — 2026-07",
      registradoPor: null,
    });
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(cronEgreso) });
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.reversarEgreso({ movimientoId: "eg-cron" }, MAESTRO);
    expect(r).toEqual({ status: "ok" });
    expect(crearMovCall(repo)).toMatchObject({
      tipo: "ingreso",
      categoria: "ingreso_ajuste",
      monto: "80000.00",
      origenTipo: "gasto",
      origenId: "eg-cron", // el uuid del egreso, NO su origen_id derivado
    });
  });

  it("R15: idempotencia — si crearMovimientos devuelve 0 (ya reversado) -> already_reversed (no-op)", async () => {
    const original = mov({ id: "eg-9", monto: "10.00" });
    const repo = buildRepo({
      obtenerPorId: vi.fn().mockResolvedValue(original),
      crearMovimientos: vi.fn().mockResolvedValue(0), // ON CONFLICT DO NOTHING: ya existia el reverso
    });
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.reversarEgreso({ movimientoId: "eg-9" }, MAESTRO);
    expect(r).toEqual({ status: "already_reversed" });
  });

  it("not_found: el id no existe", async () => {
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(null) });
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.reversarEgreso({ movimientoId: "no-existe" }, MAESTRO);
    expect(r).toEqual({ status: "not_found" });
    expect(repo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("not_found: el movimiento NO es un egreso administrativo (p.ej. un ingreso de cierre)", async () => {
    const ingreso = mov({ id: "in-1", tipo: "ingreso", categoria: "ingreso_flete", origenTipo: "cierre_dia" });
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(ingreso) });
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.reversarEgreso({ movimientoId: "in-1" }, MAESTRO);
    expect(r).toEqual({ status: "not_found" });
    expect(repo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("not_found: un egreso NO administrativo (origen_tipo != gasto, p.ej. pago a mensajero)", async () => {
    const pago = mov({ id: "pm-1", tipo: "egreso", categoria: "egreso_pago_mensajero", origenTipo: "pago_mensajero", origenId: "c1" });
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(pago) });
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.reversarEgreso({ movimientoId: "pm-1" }, MAESTRO);
    expect(r).toEqual({ status: "not_found" });
    expect(repo.crearMovimientos).not.toHaveBeenCalled();
  });
});

describe("WalletEgresoService.verDesgloseEgresos (R11/R17)", () => {
  it("R17: rol no autorizado -> forbidden, sin agregar", async () => {
    const repo = buildRepo();
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.verDesgloseEgresos({ page: 1, pageSize: 20 }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.agregarPorCategoria).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> ve el desglose (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new WalletEgresoService(repo, writeClient);
    const r = await svc.verDesgloseEgresos({ page: 1, pageSize: 20 }, ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.agregarPorCategoria).toHaveBeenCalled();
  });

  it("R11: maestro -> desglose por tipo + total, todo STRING; pasa los filtros de fecha", async () => {
    const repo = buildRepo({
      agregarPorCategoria: vi
        .fn()
        .mockResolvedValue({
          gastoFijo: "100.00",
          gastoVariable: "50.50",
          sueldo: "1000.00",
          indemnizacion: "25.25", // feature 158/R32: entra en el desglose Y en el total
        }),
    });
    const svc = new WalletEgresoService(repo, writeClient);
    const desde = new Date("2026-07-01T00:00:00.000Z");
    const r = await svc.verDesgloseEgresos({ page: 1, pageSize: 20, desde }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.desglose).toEqual({
      gastoFijo: "100.00",
      gastoVariable: "50.50",
      sueldo: "1000.00",
      indemnizacion: "25.25", // feature 158/R32
      total: "1175.75", // 1150.50 + 25.25 — la indemnizacion SUMA al total
    });
    expect(typeof r.desglose.total).toBe("string");
    expect(repo.agregarPorCategoria).toHaveBeenCalledWith({
      tipo: undefined,
      categoria: undefined,
      desde,
      hasta: undefined,
    });
  });
});

describe("WalletEgresoService — inmutabilidad (R6)", () => {
  it("R6: el service NO expone update/delete de movimientos", () => {
    const repo = buildRepo();
    const svc = new WalletEgresoService(repo, writeClient);
    expect((svc as unknown as Record<string, unknown>).actualizar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).eliminar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});
