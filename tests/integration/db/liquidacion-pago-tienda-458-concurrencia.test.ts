import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { PRISMA_OMIT } from "@/lib/db/prisma-client";
import type { LiquidacionTxRunner } from "@/lib/interfaces/services/ILiquidacionService";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, urlDeBaseDeDatos } from "./_postgres-real";
import {
  acreditar459,
  conCandado459,
  limpiar459,
  sembrarPersonas459,
  type Personas459,
} from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B — ARREGLO HEREDADO DE LA 457 (`progress/impl_457.md` §12.4), contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// `LiquidacionService.registrarPagoTienda` (el pago de Ordenex a una tienda) toma el candado de la
// tienda y DESPUES lee el saldo que decide si el pago cabe. Esa lectura iba por el cliente global —otra
// conexion del pool— y no por el `tx` que tiene el candado. Produccion abre 3 conexiones por instancia
// (`lib/db/prisma-client.ts`): tres operaciones de la misma tienda a la vez (una con el candado, dos
// esperandolo) dejaban a la primera sin conexion para leer → cuelgue hasta que la transaccion caduca y
// rollback. Falla CERRADO (nada de dinero mal escrito), pero el pago no se registra.
//
// Con un pool de UNA conexion ese escenario es el de CADA pago: la transaccion ocupa la unica conexion
// y una lectura fuera de ella no llega nunca. Molde: «R16 (m3)» de `abono-tienda-457-concurrencia`.
//
// MUTACION (anotada en `progress/fase0_458-B.md`): quitar el `tx` del tercer parametro de
// `agregarSaldoPorTienda` en `registrarPagoTienda` → la transaccion caduca a los 10 s → ROJO aqui.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("458-B — el pago de Ordenex a una tienda lee el saldo por la transaccion del candado (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function conPersonas(cuerpo: (p: Personas459) => Promise<void>): Promise<void> {
    await conCandado459(prisma, async () => {
      let p: Personas459 | null = null;
      try {
        p = await sembrarPersonas459(prisma);
        await cuerpo(p);
      } finally {
        await limpiar459(prisma, p);
      }
    });
  }

  it("con UNA sola conexion en el pool, el pago a la tienda se registra y el restante es el del saldo leido bajo el candado", async () => {
    const clienteUno = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urlDeBaseDeDatos(), max: 1 }),
      omit: PRISMA_OMIT,
    }) as unknown as PrismaClient;
    try {
      await conPersonas(async (p) => {
        await acreditar459(prisma, p.tiendaId, "10000.00");
        const svc = new LiquidacionService(
          new LiquidacionPagoRepository(clienteUno),
          new WalletTiendaMovimientoRepository(clienteUno),
          new PagoMensajeroMovimientoRepository(clienteUno),
          ((fn: (tx: never) => Promise<unknown>) =>
            clienteUno.$transaction((tx) => fn(tx as never), { timeout: 10_000 })) as unknown as LiquidacionTxRunner,
          new CajaPagoTiendaFeedService(new WalletMovimientoRepository(clienteUno)),
          new LiquidacionRepartoRepository(clienteUno),
        );
        const r = await svc.registrarPagoTienda(
          {
            claveIdempotencia: randomUUID(),
            tiendaId: p.tiendaId,
            monto: "4000.00",
            metodo: "efectivo",
            fechaPago: fechaCalendarioCR(new Date()),
          },
          p.maestro,
        );
        expect(r.status).toBe("ok");
        if (r.status !== "ok") throw new Error("imposible");
        // 10 000,00 a favor − 4 000,00 pagados = 6 000,00 (a mano).
        expect(r.restante).toBe("6000.00");
        expect(await prisma.liquidacionPago.count({ where: { tiendaId: p.tiendaId } })).toBe(1);
        // Y los tres libros quedaron escritos en esa transaccion: documento, debito y egreso de caja.
        const pago = await prisma.liquidacionPago.findFirstOrThrow({ where: { tiendaId: p.tiendaId }, select: { id: true } });
        expect(await prisma.walletTiendaMovimiento.count({ where: { origenId: pago.id, categoria: "pago_tienda" } })).toBe(1);
        expect(await prisma.walletMovimiento.count({ where: { origenId: pago.id, categoria: "egreso_pago_tienda" } })).toBe(1);
      });
    } finally {
      await clienteUno.$disconnect();
    }
  }, 120_000);

  it("el tope sigue decidiendose bajo el candado: por encima del saldo responde `excede` con lo disponible, sin escribir", async () => {
    const clienteUno = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urlDeBaseDeDatos(), max: 1 }),
      omit: PRISMA_OMIT,
    }) as unknown as PrismaClient;
    try {
      await conPersonas(async (p) => {
        await acreditar459(prisma, p.tiendaId, "2500.00");
        const svc = new LiquidacionService(
          new LiquidacionPagoRepository(clienteUno),
          new WalletTiendaMovimientoRepository(clienteUno),
          new PagoMensajeroMovimientoRepository(clienteUno),
          ((fn: (tx: never) => Promise<unknown>) =>
            clienteUno.$transaction((tx) => fn(tx as never), { timeout: 10_000 })) as unknown as LiquidacionTxRunner,
          new CajaPagoTiendaFeedService(new WalletMovimientoRepository(clienteUno)),
          new LiquidacionRepartoRepository(clienteUno),
        );
        const r = await svc.registrarPagoTienda(
          {
            claveIdempotencia: randomUUID(),
            tiendaId: p.tiendaId,
            monto: "2500.01",
            metodo: "efectivo",
            fechaPago: fechaCalendarioCR(new Date()),
          },
          p.maestro,
        );
        expect(r).toEqual({ status: "excede", disponible: "2500.00" });
        expect(await prisma.liquidacionPago.count({ where: { tiendaId: p.tiendaId } })).toBe(0);
      });
    } finally {
      await clienteUno.$disconnect();
    }
  }, 120_000);
});
