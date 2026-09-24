import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import {
  cargarCatalogo459,
  enTransaccionRevertida459,
  filasDelEscenario,
  leerCajaEntera,
  leerMensajero,
  leerTienda,
  menos,
  montarServicios459,
  sembrarEscenario459,
  type LecturaCaja459,
} from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 459 / FASE 0 (T0.2) — LA FOTOGRAFIA DE LO QUE **NO** PUEDE CAMBIAR (R92–R96).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El escenario de design §12.1 se siembra por los SERVICIOS REALES (`_fixtures/caja-459.ts`) y se
// lee por las lecturas REALES de las pantallas (`verResumenCaja`, `verDesgloseEgresos`,
// `listarSaldosTiendas`, `listarMovimientosDeTienda`, `listarCuentasPorPagar`,
// `listarPagosDeMensajero`). Todo lo que se afirma aqui son LITERALES: son el contrato que la
// ficha 459 promete no mover (HF2). NINGUNO se calcula con la funcion que se prueba; las cuentas
// estan hechas a mano en los comentarios.
//
// LA CAJA SE MIDE POR DIFERENCIA. La base local es compartida y trae movimientos de caja propios;
// `verResumenCaja` agrega el libro ENTERO. Por eso se lee antes y despues de sembrar, en la MISMA
// transaccion REPEATABLE READ, y se afirma la DIFERENCIA: todas estas cifras son sumas por cubeta,
// asi que la diferencia es exactamente lo que el escenario aporto. Los libros de tiendas y del
// mensajero no hacen falta restarlos: las tiendas y el mensajero son nuevos.
//
// UNA sola siembra (en `beforeAll`) alimenta todos los casos: si una mutacion rompe un camino de
// escritura hasta hacerlo lanzar, TODOS los casos caen en rojo con su nombre, que es lo correcto.
//
// Lo que esta ficha cambia A PROPOSITO (la «entrada» de la caja, «Dinero en caja» y «De
// terceros») vive en su PROPIO bloque, al final, con nombre propio: es lo unico que la T A.3
// reescribe. Todo lo demas debe seguir verde, sin tocar un literal, al cerrar cada bloque.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface Fotografia {
  pasos: Record<string, string>;
  antes: LecturaCaja459;
  despues: LecturaCaja459;
  filas: Awaited<ReturnType<typeof filasDelEscenario>>;
  tiendaA: Awaited<ReturnType<typeof leerTienda>>;
  tiendaB: Awaited<ReturnType<typeof leerTienda>>;
  mensajero: Awaited<ReturnType<typeof leerMensajero>>;
}

/** La diferencia de una cifra de la caja entre despues y antes. */
function delta(f: Fotografia, lector: (l: LecturaCaja459) => string): string {
  return menos(lector(f.despues), lector(f.antes));
}

describeSiHayBase("⭑ 459/FASE 0 — la fotografia de lo que no puede cambiar (Postgres real)", () => {
  let prisma: PrismaClient;
  let medida: Fotografia | undefined;
  let fallo: unknown;

  /**
   * La fotografia, o el error con el que fallo la siembra. POR QUE NO SE DEJA LANZAR EN EL
   * `beforeAll`: vitest marca entonces cada caso como SKIPPED, y un archivo con trece «skipped» es
   * exactamente el verde falso que este repo ya se comio (memoria «gate sin .env»). Asi, si una
   * mutacion rompe un camino de escritura, CADA caso cae en rojo con su nombre y con la causa.
   */
  function foto(): Fotografia {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la fotografia no llego a medirse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await medir(cat);
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  async function medir(cat: Awaited<ReturnType<typeof cargarCatalogo459>>): Promise<Fotografia> {
    return enTransaccionRevertida459(prisma, async (tx) => {
      const s = montarServicios459(tx);
      const idsCajaPrevios = new Set(
        (await tx.walletMovimiento.findMany({ select: { id: true } })).map((m) => m.id),
      );
      // El actor de la lectura «antes» solo tiene que tener acceso total: no se escribe nada.
      const lector = { usuarioId: "00000000-0000-4000-8000-000000000459", rol: "maestro" as const };
      const antes = await leerCajaEntera(s, lector);
      const esc = await sembrarEscenario459(tx, cat);
      return {
        pasos: esc.pasos,
        antes,
        despues: await leerCajaEntera(s, esc.maestro),
        filas: await filasDelEscenario(tx, esc, idsCajaPrevios),
        tiendaA: await leerTienda(s, esc.maestro, esc.tiendaA),
        tiendaB: await leerTienda(s, esc.maestro, esc.tiendaB),
        mensajero: await leerMensajero(s, esc.maestro, esc.mensajeroId),
      };
    });
  }

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("anti-vacuidad: los dieciocho pasos del escenario respondieron `ok`", () => {
    expect(foto().pasos).toEqual({
      solicitarCierre: "ok",
      aprobarCierre: "ok",
      aprobarCobroRechazo: "ok",
      pagoTiendaA: "ok",
      anularPagoTiendaA: "ok",
      pagoTiendaB: "ok",
      cobroCostoB: "ok",
      repartoMensajero: "ok",
      anularPagoMensajero: "ok",
      pagoMensajero: "ok",
      sueldo: "ok",
      reversarSueldo: "ok",
      gastoVariable: "ok",
      ajusteSuma: "ok",
      ajusteResta: "ok",
      aprobarGastoFijo: "ok",
      registrarPremio: "ok",
      anularPremio: "ok",
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // R92 — saldo y desglose de cada tienda
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // Tarifas (nivel 2, columna GAM porque las ordenes van a la zona central), IVA 13 %:
  //   A: flete 2 500,00 · devolucion 1 200,00 · comision 3,50 %
  //   B: flete 3 000,00 · devolucion 1 500,00 · comision 2,75 %
  //
  // Tienda A
  //   + contra-entrega O1                               14 900,00
  //   − flete O1 + O3 (prepagada)                        5 000,00  (2 × 2 500,00)
  //   − IVA flete                                          650,00  (2 × 325,00)
  //   − comision O1: 14 900 × 3,5 % = 521,50                521,50
  //   − IVA comision: 521,50 × 13 % = 67,795 → HALF_UP      67,80
  //   − cobro por rechazo (337): flete 1 000,00 + IVA 130,00
  //   − pago a tienda 5 000,00, + su anulacion (ajuste_credito) 5 000,00
  //   aFavor = 14 900 + 5 000 = 19 900,00
  //   cargos = 5 000 + 650 + 521,50 + 67,80 + 1 000 + 130 = 7 369,30
  //   pagado = 5 000,00 ; saldo = 19 900 − 7 369,30 − 5 000 = 7 530,70
  //
  // Tienda B
  //   + contra-entrega O2                               16 617,00
  //   − flete 3 000,00, IVA 390,00
  //   − comision 16 617 × 2,75 % = 456,9675 → 456,97 ; IVA 456,97 × 13 % = 59,4061 → 59,41
  //   − devolucion O4 (rechazada de calle) 1 500,00 + IVA 195,00
  //   − cobro de un costo 2 500,50 (cae en «cargos»)
  //   − pago a tienda 3 000,00
  //   cargos = 3 000 + 390 + 456,97 + 59,41 + 1 500 + 195 + 2 500,50 = 8 101,88
  //   saldo  = 16 617 − 8 101,88 − 3 000 = 5 515,12

  it("R92: saldo y desglose de la tienda A", () => {
    expect(foto().tiendaA).toEqual({
      saldo: "7530.70",
      signo: "positivo",
      desglose: {
        aFavor: "19900.00",
        cargos: "7369.30",
        pagado: "5000.00",
        saldo: "7530.70",
        signo: "positivo",
      },
    });
  });

  it("R92: saldo y desglose de la tienda B (el cobro de un costo es un cargo)", () => {
    expect(foto().tiendaB).toEqual({
      saldo: "5515.12",
      signo: "positivo",
      desglose: {
        aFavor: "16617.00",
        cargos: "8101.88",
        pagado: "3000.00",
        saldo: "5515.12",
        signo: "positivo",
      },
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // R93 — ganancia, composicion y desglose de egresos (diferencias sobre el libro entero)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // Ingresos PROPIOS del escenario:
  //   flete 8 000,00 (2 500 + 3 000 + 2 500) · IVA flete 1 040,00
  //   comision 978,47 (521,50 + 456,97) · IVA comision 127,21 (67,80 + 59,41)
  //   devolucion 2 500,00 (1 500 del cierre + 1 000 del 337) · IVA devolucion 325,00 (195 + 130)
  //   ajuste 51 000,25 = reverso del sueldo 45 000,00 + ajuste manual 1 000,25 + reverso del
  //   premio 5 000,00
  //   total = 8 000 + 1 040 + 978,47 + 127,21 + 2 500 + 325 + 51 000,25 = 63 970,93
  // Egresos PROPIOS:
  //   pago al mensajero 9 500,00 (P del cierre 3 × 1 500 = 4 500 + premio 5 000)
  //   sueldo 45 000,00 · gasto variable 12 345,67 · gasto fijo 80 000,00 · indemnizacion 6 500,00
  //   ajuste 500,10
  //   total = 9 500 + 45 000 + 12 345,67 + 80 000 + 6 500 + 500,10 = 153 845,77
  // Ganancia = 63 970,93 − 153 845,77 = −89 874,84

  it("R93: ganancia de Ordenex, ingresos y egresos propios", () => {
    expect({
      ingresosPropios: delta(foto(), (l) => l.resumen.ingresosPropios),
      egresosPropios: delta(foto(), (l) => l.resumen.egresosPropios),
      ganancia: delta(foto(), (l) => l.resumen.ganancia),
    }).toEqual({
      ingresosPropios: "63970.93",
      egresosPropios: "153845.77",
      ganancia: "-89874.84",
    });
  });

  it("R93: composicion de la ganancia, concepto por concepto", () => {
    expect({
      ingreso_flete: delta(foto(), (l) => l.composicion.ingresos.ingreso_flete),
      ingreso_flete_devolucion: delta(foto(), (l) => l.composicion.ingresos.ingreso_flete_devolucion),
      ingreso_comision_cod: delta(foto(), (l) => l.composicion.ingresos.ingreso_comision_cod),
      ingreso_iva_flete: delta(foto(), (l) => l.composicion.ingresos.ingreso_iva_flete),
      ingreso_iva_flete_devolucion: delta(
        foto(),
        (l) => l.composicion.ingresos.ingreso_iva_flete_devolucion,
      ),
      ingreso_iva_comision_cod: delta(foto(), (l) => l.composicion.ingresos.ingreso_iva_comision_cod),
      ingreso_ajuste: delta(foto(), (l) => l.composicion.ingresos.ingreso_ajuste),
      totalIngresos: delta(foto(), (l) => l.composicion.totalIngresos),
      egreso_pago_mensajero: delta(foto(), (l) => l.composicion.egresos.egreso_pago_mensajero),
      egreso_ajuste: delta(foto(), (l) => l.composicion.egresos.egreso_ajuste),
      otrosEgresos: delta(foto(), (l) => l.composicion.otrosEgresos),
      totalEgresos: delta(foto(), (l) => l.composicion.totalEgresos),
    }).toEqual({
      ingreso_flete: "8000.00",
      ingreso_flete_devolucion: "2500.00",
      ingreso_comision_cod: "978.47",
      ingreso_iva_flete: "1040.00",
      ingreso_iva_flete_devolucion: "325.00",
      ingreso_iva_comision_cod: "127.21",
      ingreso_ajuste: "51000.25",
      totalIngresos: "63970.93",
      egreso_pago_mensajero: "9500.00",
      egreso_ajuste: "500.10",
      otrosEgresos: "0.00",
      totalEgresos: "153845.77",
    });
  });

  it("R93: desglose de egresos (gasto fijo, variable, sueldo, indemnizacion)", () => {
    // Total = 80 000 + 12 345,67 + 45 000 + 6 500 = 143 845,67. El sueldo se cuenta aunque se
    // reversara: el reverso es un `ingreso_ajuste`, no resta del egreso (feature 45).
    expect({
      gastoFijo: delta(foto(), (l) => l.desglose.gastoFijo),
      gastoVariable: delta(foto(), (l) => l.desglose.gastoVariable),
      sueldo: delta(foto(), (l) => l.desglose.sueldo),
      indemnizacion: delta(foto(), (l) => l.desglose.indemnizacion),
      total: delta(foto(), (l) => l.desglose.total),
    }).toEqual({
      gastoFijo: "80000.00",
      gastoVariable: "12345.67",
      sueldo: "45000.00",
      indemnizacion: "6500.00",
      total: "143845.67",
    });
  });

  it("R93: «Salio» (todos los egresos de la caja) — no cambia con esta ficha", () => {
    // 153 845,77 propios + 8 000,00 de terceros (pagos a tienda 5 000 + 3 000) = 161 845,77.
    expect(delta(foto(), (l) => l.resumen.salidas)).toBe("161845.77");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // R94 — cuenta por pagar y libro del mensajero
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // P = 3 entregadas × 1 500,00 = 4 500,00 ; E = 2 000,00 (solo O1 en efectivo) → pagado al
  // aprobar min(P, E) = 2 000,00 ; pendiente 2 500,00.
  // Reparto 1 000,00 → su pago anulado (contraasiento `ajuste_devengo` 1 000,00) → pago 664,00.
  // Premio 5 000,00 devengado y anulado (`ajuste_pago` 5 000,00).
  // devengado = 4 500 + 5 000 + 1 000 = 10 500,00 ; pagado = 2 000 + 1 000 + 664 + 5 000 = 8 664,00
  // cuenta por pagar = 1 836,00 (= 2 500 − 664)

  it("R94: cuenta por pagar del mensajero (listado y libro coinciden)", () => {
    const cuenta = {
      devengado: "10500.00",
      pagado: "8664.00",
      cuentaPorPagar: "1836.00",
      signo: "positivo",
    };
    expect(foto().mensajero).toEqual({ ...cuenta, cuentaDelLibro: cuenta });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // R95/R96 — las filas que cada camino escribio en cada libro (origen | tipo | categoria | monto)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("R95/R96: filas de la CAJA, camino por camino", () => {
    expect(foto().filas.caja).toEqual([
      // aprobacion del cierre (42/43/44/158/173): 6 conceptos, contra-entrega, P e indemnizacion
      "cierre_dia|egreso|egreso_indemnizacion|6500.00",
      "cierre_dia|egreso|egreso_pago_mensajero|4500.00",
      "cierre_dia|ingreso|ingreso_cod_recaudado|31517.00",
      "cierre_dia|ingreso|ingreso_comision_cod|978.47",
      "cierre_dia|ingreso|ingreso_flete_devolucion|1500.00",
      "cierre_dia|ingreso|ingreso_flete|8000.00",
      "cierre_dia|ingreso|ingreso_iva_comision_cod|127.21",
      "cierre_dia|ingreso|ingreso_iva_flete_devolucion|195.00",
      "cierre_dia|ingreso|ingreso_iva_flete|1040.00",
      // gasto fijo aprobado (333), sueldo y su reverso, gasto variable (45)
      "gasto|egreso|egreso_gasto_fijo|80000.00",
      "gasto|egreso|egreso_gasto_variable|12345.67",
      "gasto|egreso|egreso_sueldo|45000.00",
      "gasto|ingreso|ingreso_ajuste|45000.00",
      // cobro por rechazo aprobado (337)
      "gestion_orden|ingreso|ingreso_flete_devolucion|1000.00",
      "gestion_orden|ingreso|ingreso_iva_flete_devolucion|130.00",
      // ajustes manuales (42)
      "manual|egreso|egreso_ajuste|500.10",
      "manual|ingreso|ingreso_ajuste|1000.25",
      // pagos a tienda y la anulacion (172/173)
      "pago_tienda|egreso|egreso_pago_tienda|3000.00",
      "pago_tienda|egreso|egreso_pago_tienda|5000.00",
      "pago_tienda|ingreso|ingreso_reverso_pago_tienda|5000.00",
      // premio del ranking y su anulacion (293)
      "ranking_snapshot_fila|egreso|egreso_pago_mensajero|5000.00",
      "ranking_snapshot_fila|ingreso|ingreso_ajuste|5000.00",
      // ⚠️ y NINGUNA del cobro de un costo (381/D1) ni de los pagos al mensajero ([P2] de la 173)
    ]);
  });

  it("R95/R96: filas del LIBRO DE LA TIENDA A", () => {
    expect(foto().filas.tiendaA).toEqual([
      "cierre_dia|credito|cod_recaudado|14900.00",
      "cierre_dia|debito|comision_cod|521.50",
      "cierre_dia|debito|flete|5000.00",
      "cierre_dia|debito|iva_comision_cod|67.80",
      "cierre_dia|debito|iva_flete|650.00",
      "gestion_orden|debito|flete_devolucion|1000.00",
      "gestion_orden|debito|iva_flete_devolucion|130.00",
      "pago_tienda|credito|ajuste_credito|5000.00",
      "pago_tienda|debito|pago_tienda|5000.00",
    ]);
  });

  it("R95/R96: filas del LIBRO DE LA TIENDA B (con el cobro de un costo)", () => {
    expect(foto().filas.tiendaB).toEqual([
      "cierre_dia|credito|cod_recaudado|16617.00",
      "cierre_dia|debito|comision_cod|456.97",
      "cierre_dia|debito|flete_devolucion|1500.00",
      "cierre_dia|debito|flete|3000.00",
      "cierre_dia|debito|iva_comision_cod|59.41",
      "cierre_dia|debito|iva_flete_devolucion|195.00",
      "cierre_dia|debito|iva_flete|390.00",
      "manual|debito|cobro_manual|2500.50",
      "pago_tienda|debito|pago_tienda|3000.00",
    ]);
  });

  it("R94/R95/R96: filas del LIBRO DEL MENSAJERO", () => {
    expect(foto().filas.mensajero).toEqual([
      "cierre_dia|devengo|pago_devengado|4500.00",
      "cierre_dia|devengo|premio_ranking|5000.00",
      "cierre_dia|pago|ajuste_pago|5000.00",
      "cierre_dia|pago|pago_efectivo|2000.00",
      "pago_mensajero|devengo|ajuste_devengo|1000.00",
      "pago_mensajero|pago|liquidacion|1000.00",
      "pago_mensajero|pago|liquidacion|664.00",
    ]);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ⭑ LO QUE ESTA FICHA CAMBIA A PROPOSITO — cifras de HOY (antes de la 459).
  //
  // Es el UNICO bloque que la T A.3 reescribe, con los literales nuevos calculados a mano en un
  // comentario. Hoy la caja suma como entrada el contra-entrega Y ADEMAS los cargos a la tienda
  // que salen de el (F2), y «De terceros» los lleva dentro.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // T A.3 (ficha 459): REESCRITO con la formula nueva. Las cifras de ANTES (fase 0, sobre
  // `6280fdbb`) eran: entradas 100 487,93 · enCaja −61 357,84 · deTerceros 28 517,00.
  describe("lo que esta ficha cambia a proposito (cifras con la formula de la 459)", () => {
    it("«Entro», la cifra principal, «De las tiendas», capital y «De Ordenex»", () => {
      // Cargos a tiendas del escenario (los seis conceptos del feed y del cobro por rechazo):
      //   flete 8 000 + IVA flete 1 040 + comision 978,47 + IVA comision 127,21
      //   + devolucion 2 500 + IVA devolucion 325 = 12 970,68
      // Entro = efectivo: contra-entrega 31 517,00 + reverso del pago a tienda 5 000,00
      //       + ajustes 51 000,25 (reverso del sueldo 45 000 + manual 1 000,25 + reverso del
      //         premio 5 000) = 87 517,25        (= 100 487,93 de antes − 12 970,68)
      // Cifra principal = 87 517,25 − 161 845,77 = −74 328,52
      // De las tiendas  = 31 517,00 + 5 000,00 − 8 000,00 − 12 970,68 = 15 546,32
      //                 = Σ saldos (7 530,70 + 5 515,12) + cobro de un costo 2 500,50  → R8
      // Capital 0,00 ; De Ordenex = ganancia −89 874,84 + 0 = −89 874,84
      // R7: −89 874,84 + 15 546,32 + 0 = −74 328,52 ✓
      expect({
        entradas: delta(foto(), (l) => l.resumen.entradas),
        enCaja: delta(foto(), (l) => l.resumen.enCaja),
        deTerceros: delta(foto(), (l) => l.resumen.deTerceros),
        capital: delta(foto(), (l) => l.resumen.capital),
        deOrdenex: delta(foto(), (l) => l.resumen.deOrdenex),
      }).toEqual({
        entradas: "87517.25",
        enCaja: "-74328.52",
        deTerceros: "15546.32",
        capital: "0.00",
        deOrdenex: "-89874.84",
      });
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T0.1 — la siembra es repetible: dos veces seguidas, sin error ni duplicados.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describeSiHayBase("459/T0.1 — el escenario se siembra dos veces sin choques", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("dos siembras en la misma transaccion escriben dos conjuntos IGUALES e independientes", async () => {
    const cat = await cargarCatalogo459(prisma);
    const medido = await enTransaccionRevertida459(prisma, async (tx) => {
      const previos = new Set(
        (await tx.walletMovimiento.findMany({ select: { id: true } })).map((m) => m.id),
      );
      const uno = await sembrarEscenario459(tx, cat);
      const filasUno = await filasDelEscenario(tx, uno, previos);
      const trasUno = new Set(
        (await tx.walletMovimiento.findMany({ select: { id: true } })).map((m) => m.id),
      );
      const dos = await sembrarEscenario459(tx, cat);
      const filasDos = await filasDelEscenario(tx, dos, trasUno);
      return { uno, dos, filasUno, filasDos };
    });

    // Las dos siembras son personas distintas: nada se deduplico contra la otra.
    expect(medido.dos.tiendaA).not.toBe(medido.uno.tiendaA);
    expect(medido.dos.cierreId).not.toBe(medido.uno.cierreId);
    // Y cada una escribio EXACTAMENTE lo mismo (22 filas de caja, 9 + 9 de tiendas, 7 del
    // mensajero): ni un duplicado ni una fila de menos.
    expect(medido.filasUno.caja).toHaveLength(22);
    expect(medido.filasDos).toEqual(medido.filasUno);
  }, 300_000);
});
