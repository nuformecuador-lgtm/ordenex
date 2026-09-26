import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { anularAbonoTiendaAction, registrarAbonoTiendaAction } from "@/lib/actions/abono-tienda";
import { PRISMA_OMIT } from "@/lib/db/prisma-client";
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

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, urlDeBaseDeDatos } from "./_postgres-real";
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
//   · R25 — la MISMA clave enviada dos veces a la vez por toda la deuda: el segundo espera, la regla del
//     dinero lo rechazaria (saldo 0) y responde `ya_registrado` con el pago original.
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
      const saldo = filas.reduce(
        (acc, f) => (f.tipo === "credito" ? acc.add(f.monto) : acc.sub(f.monto)),
        new Prisma.Decimal(0),
      );
      expect(saldo.toFixed(2)).toBe("-2000.00");
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

  it("R25: la MISMA clave enviada dos veces A LA VEZ por toda la deuda -> un solo pago; el segundo espera y responde ya_registrado (no `sin_deuda`)", async () => {
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "8000.00");
      const dentro = senal();
      const soltar = senal();
      const entradaComun = abonoDe(p, "8000.00"); // la MISMA clave en los dos envios: doble clic
      const promesaA = abonoService(clienteA, { dentro: dentro.dar, soltar: soltar.p }).registrar(entradaComun, null, p.maestro);
      await dentro.p;
      const promesaB = abonoService(clienteB).registrar(entradaComun, null, p.maestro);
      await dormir(800);
      soltar.dar();
      const [rA, rB] = await Promise.all([promesaA, promesaB]);
      expect(rA.status).toBe("ok");
      expect(rB.status).toBe("ya_registrado");
      if (rA.status !== "ok" || rB.status !== "ya_registrado") throw new Error("imposible");
      expect(rB.abono.id).toBe(rA.abono.id);
      expect(rB.saldo.saldo).toBe("0.00");
      expect(await prisma.abonoTienda.count({ where: { tiendaId: p.tiendaId } })).toBe(1);
      expect(await prisma.walletMovimiento.count({ where: { origenId: rA.abono.id } })).toBe(1);
    });
  }, 120_000);

  it("R38 (m2 de la revision): la ANULACION toma el candado de la tienda; un pago de la misma tienda la espera y se evalua sobre la deuda ya devuelta", async () => {
    // Deuda 10 000 − pago vigente de 4 000 = −6 000. La anulacion de ESE pago se PAUSA con la constancia
    // escrita y el candado tomado (sin commitear). Mientras, otro pago de 5 000 de la MISMA tienda (cabe
    // en el pre-chequeo: debe 6 000). Con el candado espera, entra cuando la anulacion ya devolvio los
    // 4 000 (debe 10 000) y responde el saldo REAL: −5 000. Sin el candado de `anular`
    // (`AbonoTiendaService.ts`, `bloquearBeneficiario` de la anulacion) no espera a nadie: termina
    // DURANTE la pausa y le dice a la oficina «queda en −1 000» cuando al commitear la anulacion son −5 000.
    // Nada mas bloquea al pago: la constancia solo tiene FK al pago y al operador, no a la fila de la tienda.
    await conPersonas(async (p) => {
      await endeudar457(prisma, p.tiendaId, "10000.00");
      // Por `clienteB`, no por `prisma`: `prisma` tiene una de sus dos conexiones ocupada por el candado
      // del fixture (`conCandado459`).
      const previo = await abonoService(clienteB).registrar(abonoDe(p, "4000.00"), null, p.maestro);
      if (previo.status !== "ok") throw new Error(`registro previo: ${JSON.stringify(previo)}`);

      const dentro = senal();
      const soltar = senal();
      class RepoConPausa extends AbonoTiendaRepository {
        override async anular(...args: Parameters<AbonoTiendaRepository["anular"]>) {
          const r = await super.anular(...args);
          dentro.dar();
          await soltar.p; // PAUSA: constancia escrita, candado tomado, nada commiteado
          return r;
        }
      }
      const anulador = new AbonoTiendaService(
        new RepoConPausa(clienteA),
        new WalletTiendaMovimientoRepository(clienteA),
        new LiquidacionPagoRepository(clienteA),
        new UserRepository(clienteA),
        new CajaAbonoTiendaFeedService(new WalletMovimientoRepository(clienteA)),
        STORAGE_NO_USADO,
        URLS_NO_USADAS,
        ((fn: (tx: never) => Promise<unknown>) =>
          clienteA.$transaction((tx) => fn(tx as never), { timeout: 30_000 })) as unknown as AbonoTiendaTxRunner,
      );
      const promesaAnular = anulador.anular({ abonoId: previo.abono.id, motivo: "se registro dos veces" }, p.maestro);
      await dentro.p;

      let pagoTermino = false;
      const pago = abonoService(clienteB)
        .registrar(abonoDe(p, "5000.00"), null, p.maestro)
        .finally(() => {
          pagoTermino = true;
        });
      await dormir(1500);
      const terminoDuranteLaPausa = pagoTermino;
      soltar.dar();
      const [rAnular, rPago] = await Promise.all([promesaAnular, pago]);

      expect(terminoDuranteLaPausa, "el pago NO debe poder evaluarse mientras la anulacion tiene el candado").toBe(false);
      expect(rAnular.status).toBe("ok");
      expect(rPago.status).toBe("ok");
      if (rPago.status !== "ok") throw new Error("imposible");
      // El saldo que ve la oficina es el real: −10 000 (anulado el de 4 000) + 5 000.
      expect(rPago.saldo.saldo).toBe("-5000.00");
      const filas = await prisma.walletTiendaMovimiento.findMany({ where: { tiendaId: p.tiendaId } });
      const saldo = filas.reduce(
        (acc, f) => (f.tipo === "credito" ? acc.add(f.monto) : acc.sub(f.monto)),
        new Prisma.Decimal(0),
      );
      expect(saldo.toFixed(2)).toBe("-5000.00");
    });
  }, 120_000);

  it("R16 (m3 de la revision): con UNA sola conexion en el pool, el pago se registra: el saldo bajo el candado se lee por la transaccion que lo tomo", async () => {
    // Produccion tiene 3 conexiones por instancia (`lib/db/prisma-client.ts`). Si la lectura del saldo
    // bajo el candado fuera por OTRA conexion del pool, tres operaciones de la misma tienda a la vez
    // (una con el candado, dos esperandolo) dejarian a la primera sin conexion: cuelgue y rollback. Con
    // un pool de UNA conexion ese escenario es el de cada pago: la transaccion ocupa la unica conexion y
    // una lectura fuera de ella no llega nunca (la transaccion caduca a los 10 s). Por el `tx`, entra.
    const clienteUno = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urlDeBaseDeDatos(), max: 1 }),
      omit: PRISMA_OMIT,
    }) as unknown as PrismaClient;
    try {
      await conPersonas(async (p) => {
        await endeudar457(prisma, p.tiendaId, "10000.00");
        const svc = new AbonoTiendaService(
          new AbonoTiendaRepository(clienteUno),
          new WalletTiendaMovimientoRepository(clienteUno),
          new LiquidacionPagoRepository(clienteUno),
          new UserRepository(clienteUno),
          new CajaAbonoTiendaFeedService(new WalletMovimientoRepository(clienteUno)),
          STORAGE_NO_USADO,
          URLS_NO_USADAS,
          ((fn: (tx: never) => Promise<unknown>) =>
            clienteUno.$transaction((tx) => fn(tx as never), { timeout: 10_000 })) as unknown as AbonoTiendaTxRunner,
        );
        const r = await svc.registrar(abonoDe(p, "4000.00"), null, p.maestro);
        expect(r.status).toBe("ok");
        if (r.status !== "ok") throw new Error("imposible");
        expect(r.saldo.saldo).toBe("-6000.00");
        expect(await prisma.abonoTienda.count({ where: { tiendaId: p.tiendaId } })).toBe(1);
      });
    } finally {
      await clienteUno.$disconnect();
    }
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
