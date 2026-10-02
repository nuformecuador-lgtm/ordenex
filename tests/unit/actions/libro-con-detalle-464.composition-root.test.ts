import { describe, it, expect, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ORIGENES_FALSOS } from "@/tests/fixtures/origenes-falsos";

// FICHA 464 / T6 — EL COMPOSITION ROOT, EJERCITADO DE VERDAD.
//
// La familia que esto cierra esta medida en este repo: «2 de 7 notificadores muertos con la suite
// verde» (el composition root que importa una dependencia pero no la PASA). Los tests de servicio
// inyectan sus dobles y no lo ven. Aqui se llama a las TRES acciones reales SIN `deps.service`, de modo
// que se construyen por su root, y se exige que cada orquestador reciba sus dos dependencias REALES:
// el servicio de la hoja de movimientos de siempre y un `DetalleEnLoteService` con sus dos repositorios.

const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000aa", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000bb", rol: "adminTienda" };

const capturas = vi.hoisted(() => ({ caja: [] as unknown[][], cuenta: [] as unknown[][] }));

vi.mock("@/lib/db/prisma-client", () => ({ getPrismaClient: () => ({}), PRISMA_OMIT: {} }));

vi.mock("@/lib/services/LibroConDetalleService", () => ({
  CajaConDetalleService: class {
    constructor(...args: unknown[]) {
      capturas.caja.push(args);
    }
    async cajaConDetalle() {
      return { status: "forbidden" as const };
    }
  },
  EstadoCuentaConDetalleService: class {
    constructor(...args: unknown[]) {
      capturas.cuenta.push(args);
    }
    async tiendaConDetalle() {
      return { status: "forbidden" as const };
    }
    async miTiendaConDetalle() {
      return { status: "forbidden" as const };
    }
  },
}));

const { listarMovimientosCompletoConDetalleAction } = await import("@/lib/actions/wallet");
const { verEstadoCuentaCompletoConDetalleAction, verMiEstadoCuentaCompletoConDetalleAction } = await import(
  "@/lib/actions/estado-cuenta"
);
const { WalletService } = await import("@/lib/services/WalletService");
const { EstadoCuentaService } = await import("@/lib/services/EstadoCuentaService");
const { DetalleEnLoteService } = await import("@/lib/services/DetalleEnLoteService");
const { CierreAporteRepository } = await import("@/lib/repositories/CierreAporteRepository");
const { WalletTiendaMovimientoRepository } = await import("@/lib/repositories/WalletTiendaMovimientoRepository");

function afirmarDetalleReal(d: unknown) {
  expect(d).toBeInstanceOf(DetalleEnLoteService);
  const interno = d as { aportes: unknown; movimientosDeTienda: unknown };
  expect(interno.aportes).toBeInstanceOf(CierreAporteRepository);
  expect(interno.movimientosDeTienda).toBeInstanceOf(WalletTiendaMovimientoRepository);
}

describe("464 — los roots de las tres acciones PASAN sus dependencias reales", () => {
  it("caja: WalletService + DetalleEnLoteService(CierreAporteRepository, WalletTiendaMovimientoRepository)", async () => {
    capturas.caja.length = 0;
    const r = await listarMovimientosCompletoConDetalleAction({}, { getActor: async () => MAESTRO, origenes: ORIGENES_FALSOS });
    expect(r).toEqual({ status: "forbidden" });
    expect(capturas.caja).toHaveLength(1);
    const [caja, detalle, ...resto] = capturas.caja[0];
    expect(resto).toEqual([]);
    expect(caja).toBeInstanceOf(WalletService);
    afirmarDetalleReal(detalle);
  });

  it("oficina y /mi-wallet: EstadoCuentaService + DetalleEnLoteService con sus dos repositorios", async () => {
    capturas.cuenta.length = 0;
    await verEstadoCuentaCompletoConDetalleAction(
      { cuenta: { tipo: "tienda", id: "00000000-0000-4000-8000-0000000000cc" } },
      { getActor: async () => MAESTRO },
    );
    await verMiEstadoCuentaCompletoConDetalleAction({}, { getActor: async () => TIENDA });
    expect(capturas.cuenta).toHaveLength(2);
    for (const args of capturas.cuenta) {
      const [estadoCuenta, detalle, ...resto] = args;
      expect(resto).toEqual([]);
      expect(estadoCuenta).toBeInstanceOf(EstadoCuentaService);
      afirmarDetalleReal(detalle);
    }
  });
});
