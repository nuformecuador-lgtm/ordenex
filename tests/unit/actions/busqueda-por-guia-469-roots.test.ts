import { describe, it, expect, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 469 / T8 — los COMPOSITION ROOTS del libro y del detalle PASAN el `BusquedaPorGuiaService` REAL
// (memoria «el composition root que no inyecta»: 2 de 7 notificadores estuvieron muertos con la suite
// verde). Se llama a cada accion SIN `deps.service`, se construye por su root y se exige la dependencia.
// En `WalletService` es ademas la UNICA red: su parametro es opcional (desviacion anotada en impl_469).

const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000aa", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000bb", rol: "adminTienda" };
const CUENTA = "00000000-0000-4000-8000-0000000000cc";
const MOV = "00000000-0000-4000-8000-0000000000dd";

const capturas = vi.hoisted(() => ({ wallet: [] as unknown[][], cuenta: [] as unknown[][], detalle: [] as unknown[][] }));

vi.mock("@/lib/db/prisma-client", () => ({ getPrismaClient: () => ({}), PRISMA_OMIT: {} }));

const FORBIDDEN = async () => ({ status: "forbidden" as const });

vi.mock("@/lib/services/WalletService", () => ({
  WalletService: class {
    constructor(...args: unknown[]) {
      capturas.wallet.push(args);
    }
    listarMovimientos = FORBIDDEN;
  },
}));
vi.mock("@/lib/services/EstadoCuentaService", () => ({
  EstadoCuentaService: class {
    constructor(...args: unknown[]) {
      capturas.cuenta.push(args);
    }
    leer = FORBIDDEN;
    leerMiTienda = FORBIDDEN;
  },
}));
vi.mock("@/lib/services/DetalleMovimientoService", () => ({
  DetalleMovimientoService: class {
    constructor(...args: unknown[]) {
      capturas.detalle.push(args);
    }
    verDetalleDeMovimiento = FORBIDDEN;
    verDetalleDeFilaDeCuenta = FORBIDDEN;
    verDetalleDeMiMovimiento = FORBIDDEN;
  },
}));

const { listarMovimientosAction, verDetalleDeMovimientoAction } = await import("@/lib/actions/wallet");
const { verEstadoCuentaAction, verMiEstadoCuentaAction, verOrdenesDeFilaAction } = await import("@/lib/actions/estado-cuenta");
const { verDetalleDeMiMovimientoAction } = await import("@/lib/actions/wallet-tienda");
const { BusquedaPorGuiaService } = await import("@/lib/services/BusquedaPorGuiaService");
const { OrdenIdentificadaRepository } = await import("@/lib/repositories/OrdenIdentificadaRepository");
const { CierreAporteRepository } = await import("@/lib/repositories/CierreAporteRepository");

function afirmarBusquedaReal(args: unknown[], posicion: number) {
  const b = args[posicion];
  expect(b).toBeInstanceOf(BusquedaPorGuiaService);
  const interno = b as { ordenes: unknown; aportes: unknown };
  expect(interno.ordenes).toBeInstanceOf(OrdenIdentificadaRepository);
  expect(interno.aportes).toBeInstanceOf(CierreAporteRepository);
}

describe("469 — los roots PASAN el BusquedaPorGuiaService real", () => {
  it("R33: caja — WalletService la recibe en su sexto parametro", async () => {
    capturas.wallet.length = 0;
    await listarMovimientosAction({ q: "46803" }, { getActor: async () => MAESTRO });
    expect(capturas.wallet).toHaveLength(1);
    afirmarBusquedaReal(capturas.wallet[0], 5);
  });

  it("R33: estado de cuenta (oficina y /mi-wallet) — EstadoCuentaService la recibe en su cuarto parametro", async () => {
    capturas.cuenta.length = 0;
    await verEstadoCuentaAction({ cuenta: { tipo: "tienda", id: CUENTA }, q: "46803" }, { getActor: async () => MAESTRO });
    await verMiEstadoCuentaAction({ q: "46803" }, { getActor: async () => TIENDA });
    expect(capturas.cuenta).toHaveLength(2);
    for (const args of capturas.cuenta) afirmarBusquedaReal(args, 3);
  });

  it("R25/R29: los TRES roots del detalle de una fila — DetalleMovimientoService la recibe en su quinto parametro", async () => {
    capturas.detalle.length = 0;
    await verDetalleDeMovimientoAction({ movimientoId: MOV, resaltar: "46803" }, { getActor: async () => MAESTRO });
    await verOrdenesDeFilaAction(
      { cuenta: { tipo: "tienda", id: CUENTA }, movimientoId: MOV, resaltar: "46803" },
      { getActor: async () => MAESTRO },
    );
    await verDetalleDeMiMovimientoAction({ movimientoId: MOV, resaltar: "46803" }, { getActor: async () => TIENDA });
    expect(capturas.detalle).toHaveLength(3);
    for (const args of capturas.detalle) afirmarBusquedaReal(args, 4);
  });
});
