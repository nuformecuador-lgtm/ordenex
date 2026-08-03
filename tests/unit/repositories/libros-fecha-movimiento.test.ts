import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { CrearPagoMensajeroInput } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import { medianocheUtcDelDia } from "@/lib/utils/descripcion-pago";

// Feature 172 / T B.2 (design §2.4, R37) — los dos libros aceptan FECHA DE MOVIMIENTO, y la
// aceptan como campo OPCIONAL.
//
// La prueba de fondo de que es opcional de verdad no esta en este archivo: es que los tests
// existentes de los dos feeds del cierre (`wallet-tienda-feed-service`,
// `wallet-mensajero-feed-service`, `pago-mensajero-movimiento-repository`,
// `wallet-tienda-movimiento-repository`, `wallet-idempotencia`…) siguen verdes SIN editarlos.
// Este archivo es NUEVO por eso mismo: para no tocar ninguno de ellos.
//
// Lo que si se afirma aqui es la mecanica exacta: cuando el caller NO manda la fecha, la clave
// `fechaMovimiento` NO SE EMITE en el `data` del `createMany`. No se emite como `undefined`, que
// no es lo mismo: la fila tiene que caer en el `DEFAULT CURRENT_TIMESTAMP` de la columna.

const FECHA_REAL = medianocheUtcDelDia("2026-07-30");

function buildTiendaPrisma() {
  return {
    walletTiendaMovimiento: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    usuario: { findMany: vi.fn() },
  };
}

function buildMensajeroPrisma() {
  return {
    pagoMensajeroMovimiento: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    usuario: { findMany: vi.fn() },
  };
}

const MOV_TIENDA: CrearMovimientoTiendaInput = {
  tiendaId: "t1",
  tipo: "debito",
  categoria: "pago_tienda",
  monto: "15000.00",
  origenTipo: "pago_tienda",
  origenId: "pago-1",
};

const MOV_MENSAJERO: CrearPagoMensajeroInput = {
  mensajeroId: "m1",
  tipo: "pago",
  categoria: "liquidacion",
  monto: "30000.00",
  origenTipo: "pago_mensajero",
  origenId: "pago-2",
};

describe("R37 — el ledger por tienda acepta la fecha del movimiento y la pasa tal cual", () => {
  it("con fecha: llega a la fila, sin tocar nada mas", async () => {
    const prisma = buildTiendaPrisma();
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(
      { walletTiendaMovimiento: prisma.walletTiendaMovimiento } as never,
      [{ ...MOV_TIENDA, fechaMovimiento: FECHA_REAL }],
    );

    const fila = prisma.walletTiendaMovimiento.createMany.mock.calls[0][0].data[0];
    expect(fila.fechaMovimiento).toEqual(FECHA_REAL);
    expect(fila.fechaMovimiento.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(fila.monto).toBeInstanceOf(Prisma.Decimal); // money-safe, intacto
    expect(prisma.walletTiendaMovimiento.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it("sin fecha: la clave NO se emite, para que mande el DEFAULT de la columna", async () => {
    const prisma = buildTiendaPrisma();
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(
      { walletTiendaMovimiento: prisma.walletTiendaMovimiento } as never,
      [MOV_TIENDA],
    );

    const fila = prisma.walletTiendaMovimiento.createMany.mock.calls[0][0].data[0];
    // `in` y no `=== undefined`: emitir `fechaMovimiento: undefined` seria otra cosa.
    expect("fechaMovimiento" in fila).toBe(false);
    expect(Object.keys(fila).sort()).toEqual(
      ["tiendaId", "tipo", "categoria", "monto", "origenTipo", "origenId", "descripcion", "registradoPor"].sort(),
    );
  });

  it("un lote mixto respeta la decision fila a fila", async () => {
    const prisma = buildTiendaPrisma();
    const repo = new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(
      { walletTiendaMovimiento: prisma.walletTiendaMovimiento } as never,
      [MOV_TIENDA, { ...MOV_TIENDA, origenId: "pago-9", fechaMovimiento: FECHA_REAL }],
    );

    const data = prisma.walletTiendaMovimiento.createMany.mock.calls[0][0].data;
    expect("fechaMovimiento" in data[0]).toBe(false);
    expect(data[1].fechaMovimiento).toEqual(FECHA_REAL);
  });
});

describe("R37 — el libro del mensajero, exactamente igual", () => {
  it("con fecha: llega a la fila", async () => {
    const prisma = buildMensajeroPrisma();
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(
      { pagoMensajeroMovimiento: prisma.pagoMensajeroMovimiento } as never,
      [{ ...MOV_MENSAJERO, fechaMovimiento: FECHA_REAL }],
    );

    const fila = prisma.pagoMensajeroMovimiento.createMany.mock.calls[0][0].data[0];
    expect(fila.fechaMovimiento).toEqual(FECHA_REAL);
  });

  it("sin fecha: la clave NO se emite (el feed del cierre no cambia ni un byte)", async () => {
    const prisma = buildMensajeroPrisma();
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(
      { pagoMensajeroMovimiento: prisma.pagoMensajeroMovimiento } as never,
      [MOV_MENSAJERO],
    );

    const fila = prisma.pagoMensajeroMovimiento.createMany.mock.calls[0][0].data[0];
    expect("fechaMovimiento" in fila).toBe(false);
    expect(Object.keys(fila).sort()).toEqual(
      ["mensajeroId", "tipo", "categoria", "monto", "origenTipo", "origenId", "descripcion", "registradoPor"].sort(),
    );
  });
});

describe("§2.4 — la convencion de fecha del pago es MEDIANOCHE UTC, no 06:00Z", () => {
  it("medianocheUtcDelDia entra por los DOS bordes del filtro por rango del desglose", () => {
    // Los dos desgloses filtran con `z.coerce.date()` sobre `YYYY-MM-DD`, que produce
    // medianoche UTC, y comparan `fecha_movimiento >= desde` y `<= hasta`. Con 06:00Z
    // (`inicioDelDiaCREnUtc`) el pago quedaria FUERA de su propio dia al filtrar por `hasta`.
    const fecha = medianocheUtcDelDia("2026-07-30");
    const desde = new Date("2026-07-30"); // lo que produce z.coerce.date()
    const hasta = new Date("2026-07-30");
    expect(fecha.getTime()).toBeGreaterThanOrEqual(desde.getTime());
    expect(fecha.getTime()).toBeLessThanOrEqual(hasta.getTime());
    expect(fecha.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });
});
