import { describe, expect, it, vi } from "vitest";

import type { IFiltrosWalletRepository } from "@/lib/interfaces/repositories/IFiltrosWalletRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { FiltrosWalletService } from "@/lib/services/FiltrosWalletService";
import { cierresDeLaCuentaSchema, conceptosConMovimientosSchema } from "@/lib/types/wallet-filtros";

// Ficha 458-A (TA.3/TA.4) — el servicio de los filtros: rol ANTES de leer, orden del catalogo,
// busqueda por dia CR o por nombre, tope con `hayMas`; y el borde `.strict()` con `.uuid()` (R12).

const MAESTRO = { usuarioId: "m", rol: "maestro" } as Actor;
const TIENDA = { usuarioId: "t-sesion", rol: "adminTienda" } as Actor;
const MENSAJERO = { usuarioId: "g", rol: "mensajero" } as Actor;
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function repo(): IFiltrosWalletRepository & { [k: string]: ReturnType<typeof vi.fn> } {
  return {
    contarConceptosCaja: vi.fn(async () => [
      { categoria: "egreso_sueldo", movimientos: 2 },
      { categoria: "ingreso_flete", movimientos: 1 },
    ]),
    contarConceptosTienda: vi.fn(async () => [
      { categoria: "flete", movimientos: 1 },
      { categoria: "cod_recaudado", movimientos: 3 },
    ]),
    cierresDeTienda: vi.fn(async () => []),
    cierresDeMensajero: vi.fn(async () => []),
  } as never;
}

describe("FiltrosWalletService.conceptosConMovimientos (R13/R14)", () => {
  it("devuelve los conceptos en el ORDEN del catálogo, no en el de la base", async () => {
    const r = await new FiltrosWalletService(repo()).conceptosConMovimientos({ libro: "caja" }, MAESTRO);
    expect(r).toEqual({
      status: "ok",
      conceptos: [
        { categoria: "ingreso_flete", movimientos: 1 },
        { categoria: "egreso_sueldo", movimientos: 2 },
      ],
    });
  });

  it("mi_tienda acota a la tienda de la SESIÓN", async () => {
    const r0 = repo();
    await new FiltrosWalletService(r0).conceptosConMovimientos({ libro: "mi_tienda" }, TIENDA);
    expect(r0.contarConceptosTienda).toHaveBeenCalledWith("t-sesion", {
      cierreId: undefined,
      desde: undefined,
      hasta: undefined,
    });
  });

  it("rol sin acceso → forbidden SIN tocar el repositorio (caja, tienda y mi_tienda)", async () => {
    const casos: [Parameters<FiltrosWalletService["conceptosConMovimientos"]>[0], Actor][] = [
      [{ libro: "caja" }, TIENDA],
      [{ libro: "caja" }, MENSAJERO],
      [{ libro: "tienda", tiendaId: UUID_A }, TIENDA],
      [{ libro: "mi_tienda" }, MAESTRO],
    ];
    for (const [input, actor] of casos) {
      const r0 = repo();
      expect(await new FiltrosWalletService(r0).conceptosConMovimientos(input, actor)).toEqual({ status: "forbidden" });
      for (const fn of Object.values(r0)) expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("FiltrosWalletService.cierresDeLaCuenta (R10/R11)", () => {
  it("rotula con día CR, hora y mensajero; `hayMas` con el sobrante del tope", async () => {
    const r0 = repo();
    vi.mocked(r0.cierresDeTienda).mockResolvedValue([
      { cierreId: UUID_A, solicitadoAt: "2026-09-13T04:30:00.000Z", mensajero: "Juan Pérez", movimientos: 4 },
    ]);
    const r = await new FiltrosWalletService(r0).cierresDeLaCuenta({ cuenta: "tienda", tiendaId: UUID_B }, MAESTRO);
    expect(r).toEqual({
      status: "ok",
      hayMas: false,
      opciones: [{ cierreId: UUID_A, dia: "2026-09-12", hora: "22:30", mensajero: "Juan Pérez", movimientos: 4 }],
    });
    // pide `tope + 1`: el sobrante decide `hayMas`
    expect(vi.mocked(r0.cierresDeTienda).mock.calls[0][2]).toBeGreaterThan(1);
  });

  it("la búsqueda `YYYY-MM-DD` es la franja del día de Costa Rica; otro texto, el nombre del mensajero", async () => {
    const r0 = repo();
    const svc = new FiltrosWalletService(r0);
    await svc.cierresDeLaCuenta({ cuenta: "mensajero", mensajeroId: UUID_A, busqueda: "2026-09-12" }, MAESTRO);
    await svc.cierresDeLaCuenta({ cuenta: "mensajero", mensajeroId: UUID_A, busqueda: "  pérez " }, MAESTRO);
    await svc.cierresDeLaCuenta({ cuenta: "mensajero", mensajeroId: UUID_A, busqueda: "   " }, MAESTRO);
    expect(vi.mocked(r0.cierresDeMensajero).mock.calls[0][1]).toEqual({
      tipo: "dia",
      desde: new Date("2026-09-12T06:00:00.000Z"),
      hasta: new Date("2026-09-13T06:00:00.000Z"),
    });
    expect(vi.mocked(r0.cierresDeMensajero).mock.calls[1][1]).toEqual({ tipo: "mensajero", texto: "pérez" });
    expect(vi.mocked(r0.cierresDeMensajero).mock.calls[2][1]).toBeUndefined();
  });

  it("solo acceso total: la tienda (que conserva su selector de la 335) y el mensajero → forbidden sin leer", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r0 = repo();
      const r = await new FiltrosWalletService(r0).cierresDeLaCuenta({ cuenta: "tienda", tiendaId: UUID_A }, actor);
      expect(r).toEqual({ status: "forbidden" });
      expect(r0.cierresDeTienda).not.toHaveBeenCalled();
    }
  });
});

describe("bordes `.strict()` con `.uuid()` (R12)", () => {
  it("un id que no tiene forma de identificador muere en el borde", () => {
    expect(conceptosConMovimientosSchema.safeParse({ libro: "tienda", tiendaId: "tienda-A" }).success).toBe(false);
    expect(
      conceptosConMovimientosSchema.safeParse({ libro: "tienda", tiendaId: UUID_A, cierreId: "' OR 1=1" }).success,
    ).toBe(false);
    expect(cierresDeLaCuentaSchema.safeParse({ cuenta: "tienda", tiendaId: "x" }).success).toBe(false);
    expect(conceptosConMovimientosSchema.safeParse({ libro: "tienda", tiendaId: UUID_A, cierreId: UUID_B }).success).toBe(true);
  });

  it("una clave extra (el concepto elegido, otra tienda) es validation_error", () => {
    expect(conceptosConMovimientosSchema.safeParse({ libro: "caja", categoria: "egreso_sueldo" }).success).toBe(false);
    expect(conceptosConMovimientosSchema.safeParse({ libro: "mi_tienda", tiendaId: UUID_A }).success).toBe(false);
    expect(cierresDeLaCuentaSchema.safeParse({ cuenta: "mensajero", mensajeroId: UUID_A, tiendaId: UUID_B }).success).toBe(false);
  });
});
