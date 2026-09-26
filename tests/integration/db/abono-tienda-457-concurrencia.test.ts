import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { anularAbonoTiendaAction, registrarAbonoTiendaAction } from "@/lib/actions/abono-tienda";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { AbonoTiendaTxRunner } from "@/lib/interfaces/services/IAbonoTiendaService";
import type { ICajaAbonoTiendaFeedService } from "@/lib/interfaces/services/ICajaAbonoTiendaFeedService";
import type { PagoPorCuentaTxRunner } from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import { AbonoTiendaRepository } from "@/lib/repositories/AbonoTiendaRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { PagoPorCuentaTiendaRepository } from "@/lib/repositories/PagoPorCuentaTiendaRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { AbonoTiendaService } from "@/lib/services/AbonoTiendaService";
import { CajaAbonoTiendaFeedService } from "@/lib/services/CajaAbonoTiendaFeedService";
import { CajaPagoPorCuentaFeedService } from "@/lib/services/CajaPagoPorCuentaFeedService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { PagoPorCuentaTiendaService } from "@/lib/services/PagoPorCuentaTiendaService";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import {
  conCandado459,
  endeudar457,
  formData459,
  limpiar459,
  sembrarPersonas459,
  type Personas459,
} from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 457 / T5.2 — CONCURRENCIA (R16, R36, R38), contra Postgres, con filas COMMITEADAS.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Los servicios son los REALES sobre clientes Prisma DISTINTOS (conexiones distintas, como dos
// peticiones), y a uno se le mete una PAUSA dentro de su transaccion, justo despues de escribir y antes
// de commitear. Mientras dura, la otra operacion arranca:
//
//   · R16 — pago de la tienda PAUSADO con 8 000 escritos ∥ otro pago de la misma tienda por 8 000 sobre
//     una deuda de 10 000. Con el candado, el segundo ESPERA y al entrar ve la deuda ya rebajada
//     (2 000) → `excede { deuda: "2000.00" }`. Sin el candado (MUTACION 5 de design §13) lee 10 000 →
//     `ok`, y la tienda queda con +6 000 A FAVOR: se le acredito dinero que no debia (R66 rota).
//     A diferencia del pago de un gasto de la 459, aqui el candado SI decide: el pago de la tienda LEE el
//     saldo antes de escribir, y sin `FOR UPDATE` esa lectura no espera a nadie.
//   · R16 — pago de la tienda pausado ∥ pago de Ordenex a esa tienda: el pago a tienda espera (misma fila
//     `usuario`) y al entrar la tienda sigue en contra → `sin_saldo`.
//   · R16 — pago de la tienda pausado ∥ pago de un gasto de la tienda: el pago de un gasto espera y al
//     entrar se registra sobre el saldo ya subido: −10 000 + 8 000 − 5 000 = −7 000.
//   · R36 — dos anulaciones del mismo pago a la vez, por la action: una sola constancia y un solo
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

describeSiHayBase("457/T5.2 — concurrencia del pago de una tienda a Ordenex (Postgres real)", () => {
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

  /** El servicio REAL sobre `cliente`, con la caja envuelta para poder PAUSAR tras escribir la entrada. */
  function abonoService(cliente: PrismaClient, pausa?: { dentro: () => void; soltar: Promise<void> }) {
    const cajaReal = new CajaAbonoTiendaFeedService(new WalletMovimientoRepository(cliente));
    const caja: ICajaAbonoTiendaFeedService = pausa
      ? {
          emitirIngresoDeAbono: async (tx, i) => {
            const n = await cajaReal.emitirIngresoDeAbono(tx, i);
            pausa.dentro();
            await pausa.soltar; // PAUSA: todo escrito, nada commiteado, el candado tomado
            return n;
          },
          emitirReversoDeAbono: (tx, i) => cajaReal.emitirReversoDeAbono(tx, i),
        }
      : cajaReal;
    return new AbonoTiendaService(
      new AbonoTiendaRepository(cliente),
      new WalletTiendaMovimientoRepository(cliente),
      new LiquidacionPagoRepository(cliente),
      new UserRepository(cliente),
      caja,
      STORAGE_NO_USADO,
      URLS_NO_USADAS,
      ((fn: (tx: never) => Promise<unknown>) =>
        cliente.$transaction((tx) => fn(tx as never), { timeout: 30_000 })) as unknown as AbonoTiendaTxRunner,
    );
  }

  const abonoDe = (p: Personas459, monto: string) => ({
    claveIdempotencia: randomUUID(),
    tiendaId: p.tiendaId,
    monto,
    metodo: "efectivo" as const,
    motivo: "Pago parcial de la deuda",
    fechaPago: fechaCalendarioCR(new Date()),
  });

  /** Arranca el pago A (8 000) y lo deja PAUSADO con todo escrito; devuelve como soltarlo. */
  async function pagoPausado(p: Personas459) {
    const dentro = senal();
    const soltar = senal();
    const a = abonoService(clienteA, { dentro: dentro.dar, soltar: soltar.p });
    const promesa = a.registrar(abonoDe(p, "8000.00"), null, p.maestro);
    await dentro.p;
    return { promesa, soltar: soltar.dar };
  }

  it("R16 (mutacion 5): el segundo pago de la MISMA tienda espera y se evalua sobre la deuda ya rebajada -> excede", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const a = await pagoPausado(p);

      let bTermino = false;
      const b = abonoService(clienteB)
        .registrar(abonoDe(p, "8000.00"), null, p.maestro)
        .finally(() => {
          bTermino = true;
        });
      await dormir(1500);
      const terminoDuranteLaPausa = bTermino;
      a.soltar();
      const [rA, rB] = await Promise.all([a.promesa, b]);

      expect(terminoDuranteLaPausa, "el segundo pago NO debe poder evaluarse mientras el primero tiene el candado").toBe(false);
      expect(rA.status).toBe("ok");
      expect(rB).toEqual({ status: "excede", deuda: "2000.00" });
      // R66: el saldo NUNCA quedo por encima de cero, y solo hay UN documento.
      expect(await prisma.abonoTienda.count({ where: { tiendaId: p.tiendaId } })).toBe(1);
      const filas = await prisma.walletTiendaMovimiento.findMany({ where: { tiendaId: p.tiendaId } });
      const saldo = filas.reduce((acc, f) => (f.tipo === "credito" ? acc + Number(f.monto) : acc - Number(f.monto)), 0);
      expect(saldo).toBe(-2000);
    });
  }, 120_000);

  it("R16: el segundo pago por EXACTAMENTE lo que queda entra tras esperar y deja el saldo en 0,00", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const a = await pagoPausado(p);
      const b = abonoService(clienteB).registrar(abonoDe(p, "2000.00"), null, p.maestro);
      await dormir(800);
      a.soltar();
      const [rA, rB] = await Promise.all([a.promesa, b]);
      expect(rA.status).toBe("ok");
      expect(rB.status).toBe("ok");
      if (rB.status !== "ok") throw new Error("imposible");
      expect(rB.saldo.saldo).toBe("0.00");
      expect(await prisma.abonoTienda.count({ where: { tiendaId: p.tiendaId } })).toBe(2);
    });
  }, 120_000);

  it("R16: el pago de Ordenex a la tienda ESPERA al pago de la tienda y al entrar la ve en contra -> sin_saldo", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const a = await pagoPausado(p);
      const liquidacion = new LiquidacionService(
        new LiquidacionPagoRepository(clienteB),
        new WalletTiendaMovimientoRepository(clienteB),
        new PagoMensajeroMovimientoRepository(clienteB),
        (fn) => clienteB.$transaction((tx) => fn(tx as never), { timeout: 30_000 }),
        new CajaPagoTiendaFeedService(new WalletMovimientoRepository(clienteB)),
        new LiquidacionRepartoRepository(clienteB),
      );
      let termino = false;
      const pagoTienda = liquidacion
        .registrarPagoTienda(
          { claveIdempotencia: randomUUID(), tiendaId: p.tiendaId, monto: "500.00", metodo: "efectivo", fechaPago: fechaCalendarioCR(new Date()) },
          p.maestro,
        )
        .finally(() => {
          termino = true;
        });
      await dormir(1500);
      const terminoDuranteLaPausa = termino;
      a.soltar();
      const [rA, rPago] = await Promise.all([a.promesa, pagoTienda]);
      expect(terminoDuranteLaPausa, "el pago a tienda NO debe poder evaluarse mientras el pago de la tienda tiene el candado").toBe(false);
      expect(rA.status).toBe("ok");
      expect(rPago).toEqual({ status: "sin_saldo" });
      expect(await prisma.liquidacionPago.count({ where: { tiendaId: p.tiendaId } })).toBe(0);
    });
  }, 120_000);

  it("R16: el pago de un gasto de la tienda ESPERA al pago de la tienda y se registra sobre el saldo ya subido", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const a = await pagoPausado(p);
      const pagoPorCuenta = new PagoPorCuentaTiendaService(
        new PagoPorCuentaTiendaRepository(clienteB),
        new WalletTiendaMovimientoRepository(clienteB),
        new LiquidacionPagoRepository(clienteB),
        new UserRepository(clienteB),
        new CajaPagoPorCuentaFeedService(new WalletMovimientoRepository(clienteB)),
        STORAGE_NO_USADO,
        URLS_NO_USADAS,
        ((fn: (tx: never) => Promise<unknown>) =>
          clienteB.$transaction((tx) => fn(tx as never), { timeout: 30_000 })) as unknown as PagoPorCuentaTxRunner,
      );
      let termino = false;
      const gasto = pagoPorCuenta
        .registrar(
          { claveIdempotencia: randomUUID(), tiendaId: p.tiendaId, beneficiario: "Proveedor", monto: "5000.00", metodo: "efectivo", motivo: "Empaques" },
          null,
          p.maestro,
        )
        .finally(() => {
          termino = true;
        });
      await dormir(1500);
      const terminoDuranteLaPausa = termino;
      a.soltar();
      const [rA, rGasto] = await Promise.all([a.promesa, gasto]);
      expect(terminoDuranteLaPausa, "el pago de un gasto NO debe poder escribirse mientras el pago de la tienda tiene el candado").toBe(false);
      expect(rA.status).toBe("ok");
      expect(rGasto.status).toBe("ok");
      if (rGasto.status !== "ok") throw new Error("imposible");
      expect(rGasto.saldo.saldo).toBe("-7000.00"); // −10 000 + 8 000 − 5 000
    });
  }, 120_000);

  it("R36: dos anulaciones simultaneas del mismo pago -> una constancia y un solo contra-asiento por libro", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      const r = await registrarAbonoTiendaAction(
        formData459({ ...abonoDe(p, "3000.00"), metodo: "efectivo" }),
        { getActor: async () => p.maestro },
      );
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const id = r.abono.id;
      const deps = { getActor: async () => p.maestro };
      const respuestas = await Promise.all([
        anularAbonoTiendaAction({ abonoId: id, motivo: "uno" }, deps),
        anularAbonoTiendaAction({ abonoId: id, motivo: "dos" }, deps),
      ]);
      expect(respuestas.map((x) => x.status).sort()).toEqual(["ok", "ya_anulado"]);
      expect(await prisma.abonoTiendaAnulacion.count({ where: { abonoId: id } })).toBe(1);
      expect((await prisma.walletMovimiento.findMany({ where: { origenId: id } })).map((m) => m.categoria).sort()).toEqual([
        "egreso_reverso_abono_tienda",
        "ingreso_abono_tienda",
      ]);
      expect((await prisma.walletTiendaMovimiento.findMany({ where: { origenId: id } })).map((m) => m.categoria).sort()).toEqual([
        "abono_tienda",
        "abono_tienda_anulado",
      ]);
      expect(await prisma.historialAccion.count({ where: { entidadId: id, accion: "abono_tienda_anulado" } })).toBe(1);
      // R38: el saldo volvio a estar en contra por la deuda entera.
      const ok = respuestas.find((x) => x.status === "ok");
      expect(ok && ok.status === "ok" ? ok.saldo.saldo : null).toBe("-10000.00");
    });
  }, 120_000);
});
