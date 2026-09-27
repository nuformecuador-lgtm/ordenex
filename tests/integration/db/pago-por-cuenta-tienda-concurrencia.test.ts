import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { anularPagoPorCuentaTiendaAction, registrarPagoPorCuentaTiendaAction } from "@/lib/actions/pago-por-cuenta-tienda";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IAporteCapitalRepository } from "@/lib/interfaces/repositories/IAporteCapitalRepository";
import type { AporteCapitalTxRunner } from "@/lib/interfaces/services/IAporteCapitalService";
import type { ICajaPagoPorCuentaFeedService } from "@/lib/interfaces/services/ICajaPagoPorCuentaFeedService";
import type { PagoPorCuentaTxRunner } from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { PagoPorCuentaTiendaRepository } from "@/lib/repositories/PagoPorCuentaTiendaRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { AporteCapitalService } from "@/lib/services/AporteCapitalService";
import { CajaAporteCapitalFeedService } from "@/lib/services/CajaAporteCapitalFeedService";
import { CajaPagoPorCuentaFeedService } from "@/lib/services/CajaPagoPorCuentaFeedService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { PagoPorCuentaTiendaService } from "@/lib/services/PagoPorCuentaTiendaService";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import {
  acreditar459,
  conCandado459,
  formData459,
  limpiar459,
  sembrarPersonas459,
  type Personas459,
} from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 459 / T B.13 — CONCURRENCIA (R42, R50, R70), contra Postgres, con filas COMMITEADAS.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Una carrera que «suele» pasar no prueba nada: estos casos FUERZAN el entrelazado. Los servicios
// son los REALES sobre clientes Prisma DISTINTOS (conexiones distintas, como dos peticiones), y a
// uno de ellos se le mete una PAUSA dentro de su transaccion, justo despues de escribir y antes de
// commitear. Mientras dura, la otra operacion arranca:
//
//   · R42 — pago por cuenta PAUSADO con 8 000 escritos ∥ pago de Ordenex a la misma tienda por
//     8 000 sobre un saldo de 10 000. Con el candado compartido, el pago a tienda ESPERA, y al
//     entrar ve el saldo ya rebajado (2 000) → `excede`. Sin el candado, lee 10 000 → `ok`, y la
//     tienda queda en −6 000: las dos se evaluaron sobre el mismo saldo.
//     MUTACIONES MEDIDAS (2026-09-24): quitar el candado del PAGO A TIENDA → rojo. Quitar el del
//     PAGO POR CUENTA → sigue verde, y es un mutante EQUIVALENTE hoy: el pago por cuenta escribe
//     antes de leer nada, y sus INSERT con FK a `usuario` toman `FOR KEY SHARE` sobre la fila de la
//     tienda, que choca con el `FOR UPDATE` del otro lado. Su candado es defensa en profundidad
//     (design §6.1); si un dia lee el saldo antes de escribir, es el que lo protege.
//   · R70 — dos saldos iniciales a la vez. Una BARRERA retiene a cada uno al mirar si ya hay uno
//     hasta que llegue el otro (o 1,5 s). Con el candado, el segundo no llega a mirar: espera al
//     primero, y ve el suyo → `ya_hay_saldo_inicial`. Sin el candado, los dos miran «no hay»,
//     y quedan DOS. Mutacion: quitar `bloquearSaldoInicial` → rojo.
//   · R50 — dos anulaciones del mismo pago a la vez, por la action: una sola anulacion y un solo
//     contra-asiento en cada libro.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const STORAGE_NO_USADO: IFileStorage = {
  upload: async () => {
    throw new Error("este test no sube comprobantes");
  },
  remove: async () => undefined,
};
const URLS_NO_USADAS: ISignedUrlProvider = {
  createSignedUrl: async (r: string) => r,
  createSignedUrls: async (rs: string[]) => Object.fromEntries(rs.map((r) => [r, r])),
};

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Una señal de un solo uso. */
function senal() {
  let dar: () => void = () => undefined;
  const p = new Promise<void>((r) => {
    dar = r;
  });
  return { p, dar };
}

describeSiHayBase("459/T B.13 — concurrencia del pago por cuenta y del saldo inicial (Postgres real)", () => {
  let prisma: PrismaClient;
  let clienteA: PrismaClient;
  let clienteB: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
    clienteA = crearPrismaDeTest();
    clienteB = crearPrismaDeTest();
  });

  afterAll(async () => {
    await Promise.all([prisma?.$disconnect(), clienteA?.$disconnect(), clienteB?.$disconnect()]);
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

  it("R42: el pago de Ordenex a la tienda ESPERA al pago por cuenta y se evalua sobre el saldo ya rebajado", async () => {
    await conPersonas(async (p) => {
      await acreditar459(prisma, p.tiendaId, "10000.00");

      const dentro = senal();
      const soltar = senal();
      const cajaReal = new CajaPagoPorCuentaFeedService(new WalletMovimientoRepository(clienteA));
      const cajaConPausa: ICajaPagoPorCuentaFeedService = {
        emitirEgresoDePagoPorCuenta: async (tx, i) => {
          const n = await cajaReal.emitirEgresoDePagoPorCuenta(tx, i);
          dentro.dar();
          await soltar.p; // PAUSA: todo escrito, nada commiteado, el candado tomado
          return n;
        },
        emitirReversoDePagoPorCuenta: (tx, i) => cajaReal.emitirReversoDePagoPorCuenta(tx, i),
      };
      const pagoPorCuenta = new PagoPorCuentaTiendaService(
        new PagoPorCuentaTiendaRepository(clienteA),
        new WalletTiendaMovimientoRepository(clienteA),
        new LiquidacionPagoRepository(clienteA),
        new UserRepository(clienteA),
        cajaConPausa,
        STORAGE_NO_USADO,
        URLS_NO_USADAS,
        ((fn: (tx: never) => Promise<unknown>) =>
          clienteA.$transaction((tx) => fn(tx as never), { timeout: 30_000 })) as unknown as PagoPorCuentaTxRunner,
      );
      const liquidacion = new LiquidacionService(
        new LiquidacionPagoRepository(clienteB),
        new WalletTiendaMovimientoRepository(clienteB),
        new PagoMensajeroMovimientoRepository(clienteB),
        (fn) => clienteB.$transaction((tx) => fn(tx as never), { timeout: 30_000 }),
        new CajaPagoTiendaFeedService(new WalletMovimientoRepository(clienteB)),
        new LiquidacionRepartoRepository(clienteB),
      );

      const porCuenta = pagoPorCuenta.registrar(
        {
          claveIdempotencia: randomUUID(),
          tiendaId: p.tiendaId,
          beneficiario: "Proveedor",
          monto: "8000.00",
          metodo: "efectivo",
          motivo: "Compra de empaques",
        },
        null,
        p.maestro,
      );
      await dentro.p;

      let pagoTiendaTermino = false;
      const pagoTienda = liquidacion
        .registrarPagoTienda(
          {
            claveIdempotencia: randomUUID(),
            tiendaId: p.tiendaId,
            monto: "8000.00",
            metodo: "efectivo",
            fechaPago: fechaCalendarioCR(new Date()),
          },
          p.maestro,
        )
        .finally(() => {
          pagoTiendaTermino = true;
        });

      await dormir(1500);
      const terminoDuranteLaPausa = pagoTiendaTermino;
      soltar.dar();
      const [rPorCuenta, rPagoTienda] = await Promise.all([porCuenta, pagoTienda]);

      expect(terminoDuranteLaPausa, "el pago a tienda NO debe poder evaluarse mientras el pago por cuenta tiene el candado").toBe(false);
      expect(rPorCuenta.status).toBe("ok");
      expect(rPagoTienda).toEqual({ status: "excede", disponible: "2000.00" });
      expect(await prisma.liquidacionPago.count({ where: { tiendaId: p.tiendaId } })).toBe(0);
    });
  }, 120_000);

  it("R50: dos anulaciones simultaneas del mismo pago -> una anulacion y un solo contra-asiento por libro", async () => {
    await conPersonas(async (p) => {
      const r = await registrarPagoPorCuentaTiendaAction(
        formData459({
          claveIdempotencia: randomUUID(),
          tiendaId: p.tiendaId,
          beneficiario: "Facebook",
          monto: "3000",
          metodo: "efectivo",
          motivo: "Publicidad",
        }),
        { getActor: async () => p.maestro },
      );
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const id = r.pago.id;
      const deps = { getActor: async () => p.maestro };
      const respuestas = await Promise.all([
        anularPagoPorCuentaTiendaAction({ pagoId: id, motivo: "uno" }, deps),
        anularPagoPorCuentaTiendaAction({ pagoId: id, motivo: "dos" }, deps),
      ]);
      expect(respuestas.map((x) => x.status).sort()).toEqual(["ok", "ya_anulado"]);
      expect(await prisma.pagoPorCuentaTiendaAnulacion.count({ where: { pagoId: id } })).toBe(1);
      expect(
        (await prisma.walletMovimiento.findMany({ where: { origenId: id } })).map((m) => m.categoria).sort(),
      ).toEqual(["egreso_pago_por_cuenta_tienda", "ingreso_reverso_pago_por_cuenta_tienda"]);
      expect(
        (await prisma.walletTiendaMovimiento.findMany({ where: { origenId: id } })).map((m) => m.categoria).sort(),
      ).toEqual(["pago_por_cuenta", "pago_por_cuenta_anulado"]);
      expect(
        await prisma.historialAccion.count({ where: { entidadId: id, accion: "pago_por_cuenta_tienda_anulado" } }),
      ).toBe(1);
    });
  }, 120_000);

  it("R70: dos saldos iniciales A LA VEZ -> uno solo; el otro, `ya_hay_saldo_inicial`", async () => {
    await conPersonas(async (p) => {
      const primer = await new WalletMovimientoRepository(prisma).primerDiaDeLaCaja({ excluirCapital: true });
      const dia = primer ?? fechaCalendarioCR(new Date());

      // Barrera: cada registro, al mirar si ya hay uno, espera al otro (o 1,5 s).
      let llegados = 0;
      const ambos = senal();
      const conBarrera = (cliente: PrismaClient): IAporteCapitalRepository => {
        const real = new AporteCapitalRepository(cliente);
        return {
          bloquearSaldoInicial: (tx) => real.bloquearSaldoInicial(tx),
          haySaldoInicialVigente: async (tx) => {
            llegados += 1;
            if (llegados >= 2) ambos.dar();
            await Promise.race([ambos.p, dormir(1500)]);
            return real.haySaldoInicialVigente(tx);
          },
          crear: (tx, i) => real.crear(tx, i),
          anular: (tx, i) => real.anular(tx, i),
          obtenerPorClave: (c) => real.obtenerPorClave(c),
          obtenerPorId: (id) => real.obtenerPorId(id),
          estadoDeDocumentos: (ids) => real.estadoDeDocumentos(ids),
        };
      };
      const servicio = (cliente: PrismaClient) =>
        new AporteCapitalService(
          conBarrera(cliente),
          new CajaAporteCapitalFeedService(new WalletMovimientoRepository(cliente)),
          new WalletMovimientoRepository(cliente),
          STORAGE_NO_USADO,
          URLS_NO_USADAS,
          ((fn: (tx: never) => Promise<unknown>) =>
            cliente.$transaction((tx) => fn(tx as never), { timeout: 30_000 })) as unknown as AporteCapitalTxRunner,
        );
      const entrada = (monto: string) => ({
        claveIdempotencia: randomUUID(),
        clase: "saldo_inicial" as const,
        monto,
        fecha: dia,
        motivo: "Saldo del banco",
      });

      const respuestas = await Promise.all([
        servicio(clienteA).registrar(entrada("1000.00"), null, p.maestro),
        servicio(clienteB).registrar(entrada("2000.00"), null, p.admin),
      ]);
      expect(respuestas.map((x) => x.status).sort()).toEqual(["ok", "ya_hay_saldo_inicial"]);
      expect(
        await prisma.aporteCapital.count({
          where: { clase: "saldo_inicial", registradoPor: { in: p.usuarios }, anulacion: null },
        }),
      ).toBe(1);
      expect(
        await prisma.walletMovimiento.count({
          where: { categoria: "ingreso_aporte_capital", registradoPor: { in: p.usuarios } },
        }),
      ).toBe(1);
    });
  }, 120_000);
});
