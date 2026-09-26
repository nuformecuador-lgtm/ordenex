import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import {
  cargarCatalogo459,
  enTransaccionRevertida459,
  leerCajaEntera,
  leerMensajero,
  leerTienda,
  menos,
  montarServicios459,
  type LecturaCaja459,
} from "./_fixtures/caja-459";
import { leerBodega, sembrarEscenario458, type Escenario458 } from "./_fixtures/wallet-458";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 458-B / FASE 0 (TB.1) — LA FOTOGRAFIA DE LAS CUENTAS (R84, R85, R88; design §8.1).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Complementa a `caja-caracterizacion-459` (que ya fija la caja y los libros con TODOS los caminos
// de escritura) con lo que la 458 va a leer de otra forma: el saldo de una tienda, la cuenta por
// pagar de un mensajero y el pendiente de una bodega, sobre cuentas NUEVAS con instantes fijos y
// empates controlados (`_fixtures/wallet-458.ts`). Todo lo que se afirma son LITERALES calculados A
// MANO en los comentarios; ninguno con la funcion que se prueba.
//
// La caja se mide POR DIFERENCIA (antes/despues en la MISMA transaccion REPEATABLE READ), igual que
// la 459: la base local trae su propia historia.
//
// Cada hija corre esta fotografia y la de la 459 al empezar y al terminar: deben dar lo mismo.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface Foto {
  esc: Escenario458;
  antes: LecturaCaja459;
  despues: LecturaCaja459;
  tiendaC: Awaited<ReturnType<typeof leerTienda>>;
  mensajeroM: Awaited<ReturnType<typeof leerMensajero>>;
  bodegaZ: Awaited<ReturnType<typeof leerBodega>>;
}

describeSiHayBase("⭑ 458-B/FASE 0 — la fotografia de las cuentas (Postgres real)", () => {
  let prisma: PrismaClient;
  let medida: Foto | undefined;
  let fallo: unknown;

  /** La foto o el error de la siembra: cada caso cae en ROJO con su nombre, nunca en «skipped». */
  function foto(): Foto {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la fotografia 458 no llego a medirse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const lector = { usuarioId: "00000000-0000-4000-8000-000000000458", rol: "maestro" as const };
        const antes = await leerCajaEntera(s, lector);
        const esc = await sembrarEscenario458(tx, cat);
        return {
          esc,
          antes,
          despues: await leerCajaEntera(s, esc.maestro),
          tiendaC: await leerTienda(s, esc.maestro, esc.tiendaC),
          mensajeroM: await leerMensajero(s, esc.maestro, esc.mensajeroM),
          bodegaZ: await leerBodega(tx, s, esc.maestro, esc.zonaZ),
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("anti-vacuidad: el pago de un gasto de la tienda C lo escribio el servicio real (`ok`)", () => {
    expect(foto().esc.pasos).toEqual({ pagoPorCuentaC: "ok" });
  });

  // ─── R84 — saldo y desglose de la tienda C ──────────────────────────────────────────────────
  //   a favor: cod_recaudado 10 000,00 + ajuste_credito 3 000,00           = 13 000,00
  //   cargos:  flete 2 000,00 + cobro_manual 1 500,00 + comision 300,00    =  3 800,00
  //   pagado:  pago_tienda 3 000,00 + pago_por_cuenta 1 000,00 (servicio)  =  4 000,00
  //   saldo = 13 000 − 3 800 − 4 000 = 5 200,00
  it("R84: saldo y desglose de la tienda C", () => {
    expect(foto().tiendaC).toEqual({
      saldo: "5200.00",
      signo: "positivo",
      desglose: {
        aFavor: "13000.00",
        cargos: "3800.00",
        pagado: "4000.00",
        saldo: "5200.00",
        signo: "positivo",
      },
    });
  });

  // ─── R84 — cuenta por pagar del mensajero M ─────────────────────────────────────────────────
  //   devengado: 4 500 + 1 000 (ajuste_devengo) + 1 500 = 7 000,00
  //   pagado:    2 000 + 1 000 + 700                    = 3 700,00
  //   cuenta por pagar = 3 300,00
  it("R84: cuenta por pagar del mensajero M (listado y libro coinciden)", () => {
    const cuenta = { devengado: "7000.00", pagado: "3700.00", cuentaPorPagar: "3300.00", signo: "positivo" };
    expect(foto().mensajeroM).toEqual({ ...cuenta, cuentaDelLibro: cuenta });
  });

  // ─── R84 — pendiente de la bodega Z ─────────────────────────────────────────────────────────
  //   efectivo de las NO rechazadas: 5 000 + 4 500 = 9 500,00 (la rechazada de 9 999 no cuenta)
  //   recibido: 4 000,00 ; pendiente = 9 500 − 4 000 = 5 500,00
  it("R84: pendiente de la bodega Z (la consolidacion rechazada no cuenta)", () => {
    expect(foto().bodegaZ).toEqual({
      saldoSinConciliar: "5500.00",
      totalEfectivo: "9500.00",
      totalRecibido: "4000.00",
    });
  });

  // ─── R85/R91 — la caja del escenario, por diferencia ────────────────────────────────────────
  //   Entro (efectivo):  cod 10 000 + reverso del pago a tienda 3 000         = 13 000,00
  //   Salio:             pago a tienda 3 000 + pago de un gasto 1 000          =  4 000,00
  //   Cifra principal = 13 000 − 4 000                                         =  9 000,00
  //   Ganancia (cargos propios): flete 2 000 + cobro 1 500 + comision 300      =  3 800,00
  //   De las tiendas = 10 000 + 3 000 − 3 000 − 1 000 − 3 800                  =  5 200,00
  //                  = saldo de la tienda C (R8, sin excepcion)
  //   R7: 3 800 + 5 200 + 0 = 9 000 ✓
  it("R85/R91: la caja del escenario (Entro, Salio, cifra principal, ganancia, De las tiendas, capital)", () => {
    const d = (lector: (l: LecturaCaja459) => string) => menos(lector(foto().despues), lector(foto().antes));
    expect({
      entradas: d((l) => l.resumen.entradas),
      salidas: d((l) => l.resumen.salidas),
      enCaja: d((l) => l.resumen.enCaja),
      ganancia: d((l) => l.resumen.ganancia),
      deTerceros: d((l) => l.resumen.deTerceros),
      capital: d((l) => l.resumen.capital),
    }).toEqual({
      entradas: "13000.00",
      salidas: "4000.00",
      enCaja: "9000.00",
      ganancia: "3800.00",
      deTerceros: "5200.00",
      capital: "0.00",
    });
  });

  it("R91 (R8): «De las tiendas» del escenario = saldo de la tienda C, al centimo", () => {
    const deTerceros = menos(foto().despues.resumen.deTerceros, foto().antes.resumen.deTerceros);
    expect(deTerceros).toBe(foto().tiendaC.saldo);
  });
});
