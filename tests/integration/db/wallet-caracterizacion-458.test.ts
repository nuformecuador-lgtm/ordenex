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
import {
  leerBodega,
  leerEstadoCuenta,
  lineaDe,
  montarEstadoCuenta,
  sembrarEscenario458,
  type Escenario458,
} from "./_fixtures/wallet-458";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

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
  /** TB.6 — el estado de cuenta de cada cuenta (desde la 458-B). */
  ec: {
    tiendaTodo: EstadoCuentaDTO;
    tiendaDesde12: EstadoCuentaDTO;
    tiendaHasta11: EstadoCuentaDTO;
    tiendaCobros: EstadoCuentaDTO;
    mensajeroTodo: EstadoCuentaDTO;
    bodegaTodo: EstadoCuentaDTO;
  };
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
        const ec = montarEstadoCuenta(s);
        const tienda = { tipo: "tienda" as const, id: esc.tiendaC };
        return {
          esc,
          antes,
          despues: await leerCajaEntera(s, esc.maestro),
          tiendaC: await leerTienda(s, esc.maestro, esc.tiendaC),
          mensajeroM: await leerMensajero(s, esc.maestro, esc.mensajeroM),
          bodegaZ: await leerBodega(tx, s, esc.maestro, esc.zonaZ),
          ec: {
            tiendaTodo: await leerEstadoCuenta(ec, esc.maestro, { cuenta: tienda }),
            tiendaDesde12: await leerEstadoCuenta(ec, esc.maestro, { cuenta: tienda, desde: "2026-09-12" }),
            tiendaHasta11: await leerEstadoCuenta(ec, esc.maestro, { cuenta: tienda, hasta: "2026-09-11" }),
            tiendaCobros: await leerEstadoCuenta(ec, esc.maestro, { cuenta: tienda, chip: "cobros" }),
            mensajeroTodo: await leerEstadoCuenta(ec, esc.maestro, { cuenta: { tipo: "mensajero", id: esc.mensajeroM } }),
            bodegaTodo: await leerEstadoCuenta(ec, esc.maestro, { cuenta: { tipo: "bodega", id: esc.zonaZ } }),
          },
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

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // TB.6 — EL ESTADO DE CUENTA (R16, R20–R25). Literales A MANO; el orden es ascendente (D4) y el
  // saldo corrido es el de la cuenta ENTERA (R21). `hoy` es el dia CR de la siembra: el pago de un
  // gasto lo escribe el servicio real con la fecha de hoy.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const hoy = () => fechaCalendarioCR(new Date());

  // Tienda C, todo el libro:
  //   c1 10 sep  +10 000,00 → 10 000,00  cierres
  //   c2 10 sep   −2 000,00 →  8 000,00  cierres      (mismo instante y created_at: desempata el id)
  //   c3 11 sep   −1 500,00 →  6 500,00  cobros       (23:30 CR: sigue siendo el 11)
  //   c4 11 sep     −300,00 →  6 200,00  cierres      (mismo instante; SOLO el created_at la pone detras)
  //   c5 12 sep   −3 000,00 →  3 200,00  pagos        (00:30 CR del 12)
  //   c6 15 sep   +3 000,00 →  6 200,00  pagos        (la anulacion de c5)
  //   pc hoy      −1 000,00 →  5 200,00  pagos        (el pago de un gasto, servicio real)
  // Totales netos (D3): el par c5/c6 esta ENTERO en el periodo → fuera. Abonos 10 000,00; cargos
  // 2 000 + 1 500 + 300 + 1 000 = 4 800,00. Final 0 + 10 000 − 4 800 = 5 200,00 = el saldo de la tienda.
  it("TB.6 R20–R23: la tienda C entera, fila a fila, con su saldo corrido", () => {
    const e = foto().ec.tiendaTodo;
    expect(e.filas.map(lineaDe)).toEqual([
      "2026-09-10|-|10000.00|10000.00|cierres",
      "2026-09-10|2000.00|-|8000.00|cierres",
      "2026-09-11|1500.00|-|6500.00|cobros",
      "2026-09-11|300.00|-|6200.00|cierres",
      "2026-09-12|3000.00|-|3200.00|pagos",
      "2026-09-15|-|3000.00|6200.00|pagos",
      `${hoy()}|1000.00|-|5200.00|pagos`,
    ]);
    expect({
      saldoInicial: e.saldoInicial,
      abonos: e.abonos,
      cargos: e.cargos,
      saldoFinal: e.saldoFinal,
      saldoActual: e.saldoActual,
      sentido: e.sentido,
      total: e.total,
    }).toEqual({
      saldoInicial: "0.00",
      abonos: "10000.00",
      cargos: "4800.00",
      saldoFinal: "5200.00",
      saldoActual: "5200.00",
      sentido: "ordenex_debe",
      total: 7,
    });
    // R22: el final del estado de cuenta es el saldo del listado de `/wallet/tiendas`.
    expect(e.saldoActual).toBe(foto().tiendaC.saldo);
  });

  it("TB.6 R25/R71: el pago anulado (c5) sale tachado con su constancia y NO anulable; su anulacion (c6) es contra-asiento", () => {
    const [, , , , c5, c6, pc] = foto().ec.tiendaTodo.filas;
    expect({ anulacion: c5.anulacion, anulable: c5.anulable, esContra: c5.esContraAsiento }).toEqual({
      anulacion: { motivo: "Pago a la cuenta equivocada 458", por: foto().esc.maestroNombre, fecha: hoy() },
      anulable: false,
      esContra: false,
    });
    expect({ anulacion: c6.anulacion, anulable: c6.anulable, esContra: c6.esContraAsiento }).toEqual({
      anulacion: null,
      anulable: false,
      esContra: true,
    });
    // El pago de un gasto, vigente y con su documento: anulable.
    expect({ anulacion: pc.anulacion, anulable: pc.anulable }).toEqual({ anulacion: null, anulable: true });
    // Lo que produce un cierre no se anula (R65).
    expect(foto().ec.tiendaTodo.filas[0]).toMatchObject({ naceDeUnCierre: true, anulable: false });
  });

  // desde = 12 sep: el saldo inicial es el del cierre del 11 CR (c1..c4: 6 200,00; c3 y c4 son de las
  // 23:30 del 11 en CR aunque en UTC ya sean del 12 — R16). Filas: c5, c6 y el pago de hoy. El par
  // c5/c6 queda ENTERO dentro → abonos 0,00; cargos 1 000,00. Final 6 200 − 1 000 = 5 200,00.
  it("TB.6 R16/R20/D3: desde el 12 sep — saldo inicial 6 200,00, el par anulado fuera de los totales", () => {
    const e = foto().ec.tiendaDesde12;
    expect(e.filas.map(lineaDe)).toEqual([
      "2026-09-12|3000.00|-|3200.00|pagos",
      "2026-09-15|-|3000.00|6200.00|pagos",
      `${hoy()}|1000.00|-|5200.00|pagos`,
    ]);
    expect([e.saldoInicial, e.abonos, e.cargos, e.saldoFinal]).toEqual(["6200.00", "0.00", "1000.00", "5200.00"]);
  });

  // hasta = 11 sep (cota exclusiva: el inicio del 12 CR = 06:00Z). c3 y c4 (05:30Z del 12) ENTRAN;
  // c5 (06:30Z) no. Final 0 + 10 000 − 3 800 = 6 200,00.
  it("TB.6 R16: hasta el 11 sep — las 23:30 CR del 11 entran, las 00:30 del 12 no", () => {
    const e = foto().ec.tiendaHasta11;
    expect(e.filas.map(lineaDe)).toEqual([
      "2026-09-10|-|10000.00|10000.00|cierres",
      "2026-09-10|2000.00|-|8000.00|cierres",
      "2026-09-11|1500.00|-|6500.00|cobros",
      "2026-09-11|300.00|-|6200.00|cierres",
    ]);
    expect([e.saldoInicial, e.abonos, e.cargos, e.saldoFinal]).toEqual(["0.00", "10000.00", "3800.00", "6200.00"]);
  });

  it("TB.6 R21/R24: el chip «Cobros» solo trae c3, con el saldo corrido de la cuenta ENTERA (6 500,00)", () => {
    const e = foto().ec.tiendaCobros;
    expect(e.filas.map(lineaDe)).toEqual(["2026-09-11|1500.00|-|6500.00|cobros"]);
    expect(e.total).toBe(1);
    // Las tarjetas no dependen del chip.
    expect([e.abonos, e.cargos, e.saldoFinal]).toEqual(["10000.00", "4800.00", "5200.00"]);
  });

  // Mensajero M: m1 +4 500 (4 500) · m2 −2 000 (2 500) · m3 −1 000 (1 500) · m4 +1 000 (2 500) ·
  // m5 +1 500 (4 000) · m6 −700 (3 300). El par m3/m4 (el pago y su anulacion) fuera de los totales:
  // abonos 4 500 + 1 500 = 6 000,00; cargos 2 000 + 700 = 2 700,00; final 3 300,00 = la cuenta por pagar.
  it("TB.6 R20–R23: el mensajero M, fila a fila, y la cuenta por pagar", () => {
    const e = foto().ec.mensajeroTodo;
    expect(e.filas.map(lineaDe)).toEqual([
      "2026-09-10|-|4500.00|4500.00|cierres",
      "2026-09-10|2000.00|-|2500.00|cierres",
      "2026-09-11|1000.00|-|1500.00|pagos",
      "2026-09-11|-|1000.00|2500.00|pagos",
      "2026-09-15|-|1500.00|4000.00|cierres",
      "2026-09-15|700.00|-|3300.00|pagos",
    ]);
    expect([e.saldoInicial, e.abonos, e.cargos, e.saldoFinal, e.saldoActual, e.sentido]).toEqual([
      "0.00",
      "6000.00",
      "2700.00",
      "3300.00",
      "3300.00",
      "ordenex_debe",
    ]);
    expect(e.saldoActual).toBe(foto().mensajeroM.cuentaPorPagar);
  });

  // Bodega Z: b1 declarado 5 000 (10 sep) → 5 000 · b2 declarado 4 500 (11 sep) → 9 500 · b2
  // recibido 4 000 (12 sep) → 5 500. La rechazada no aparece. Final 0 + 9 500 − 4 000 = 5 500,00 =
  // el pendiente de `/wallet/satelites`.
  it("TB.6 R20–R22: la bodega Z, con el pendiente acumulado", () => {
    const e = foto().ec.bodegaTodo;
    expect(e.filas.map(lineaDe)).toEqual([
      "2026-09-10|5000.00|-|5000.00|declarado",
      "2026-09-11|4500.00|-|9500.00|declarado",
      "2026-09-12|-|4000.00|5500.00|recibido",
    ]);
    expect([e.saldoInicial, e.abonos, e.cargos, e.saldoFinal, e.saldoActual, e.sentido]).toEqual([
      "0.00",
      "4000.00",
      "9500.00",
      "5500.00",
      "5500.00",
      "por_entregar",
    ]);
    expect(e.saldoActual).toBe(foto().bodegaZ.saldoSinConciliar);
  });
});
