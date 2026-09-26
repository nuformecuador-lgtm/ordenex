import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";
import {
  cargarCatalogo459,
  enTransaccionRevertida459,
  leerCajaEntera,
  leerTienda,
  menos,
  montarServicios459,
  sembrarEscenario459,
  type Escenario459,
  type LecturaCaja459,
} from "./_fixtures/caja-459";
import { UP_COMPLETAR_461 } from "./_fixtures/completar-caja-461-sql";
import { CLAVE_CANDADO_459 } from "./_fixtures/escrituras-459";
import { upCon } from "./_fixtures/reclasificacion-459-sql";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 459 / T B.14 → FICHA 461 / T B.12 — LA INVARIANTE CON TODO, Y SIN EXCEPCION.
// (R7, R8, R23, R24, R25, R26, R31, R32, R33, R59, R61 de la 461; R21, R39, R48, R72, R75 de la 459.)
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Sobre el escenario de la fase 0 (todos los caminos que escriben en la caja o en el libro de las
// tiendas, sembrados por los SERVICIOS REALES; desde la 461 el cobro de Ordenex a la tienda B ya
// escribe su CARGO en la caja) se ejecutan, uno a uno, los caminos nuevos de la 459 y de la 461.
// Tras CADA paso se comprueba:
//
//   R7 — cifra principal = ganancia + «De las tiendas» + capital, al centimo, sobre el libro ENTERO
//        y sobre la diferencia con el «antes».
//   R8 — Δ«De las tiendas» = Σ saldos de las tiendas del escenario. SIN EXCEPCION (HD2 de la 461):
//        la 459 sumaba aqui «+ cobros de un costo no reclasificados»; ese sumando desaparece porque
//        el cobro tiene su contrapartida en la caja (R1) y los cobros previos la reciben por la
//        migracion de datos (R31). Se mide por DIFERENCIA: la base local trae su propia historia
//        (L1); las tiendas del escenario son nuevas, asi que su parte del libro es exactamente la suya.
//
// LO QUE ESTA FICHA AÑADE AL RECORRIDO —y por que en este orden—:
//
//   6. Dos cobros LEGADOS de la tienda B, sembrados por INSERT directo SIN linea de caja: es el estado
//      que dejo la 381 y que motiva la 461. En esa foto R8 NO se cumple, y el test lo AFIRMA con la
//      cifra exacta (la suma de los dos): una invariante que cuadrara aqui estaria midiendo mal.
//   7. El primero se RECLASIFICA con el SQL REAL de la 459 (R61: esa migracion no se toca y sigue
//      funcionando sobre un cobro sin linea de caja).
//   8. El segundo recibe su linea de caja con el SQL REAL de la migracion de datos de la 461 (R31,
//      R32: al reclasificado NO se la escribe; R33: la fila lleva `cobro_tienda_completado`).
//      Con los dos, R8 vuelve a cuadrar SIN excepcion.
//   9. Se ANULA el cobro del escenario (el que registro el servicio, con su cargo): credito a la
//      tienda + reverso del cargo (R10/R12/R25): «De las tiendas» sube, la ganancia baja, la cifra
//      principal no se mueve.
//
// Y que cada paso escribio filas (una invariante sobre un libro vacio no prueba nada).
//
// AISLAMIENTO: todo en UNA transaccion REPEATABLE READ que SIEMPRE se revierte, con el candado de
// los archivos de la 459 que COMMITEAN (el saldo inicial es unico en toda la base).
//
// MUTACIONES DE LA TAREA (design §14.2 de la 461): (1) quitar `emitirCargoDeCobro` → R8 se rompe en
// «escenario» por 2 500,50; (6) anular sin el credito → R8 en «anulacion del cobro»; (8) la migracion
// de datos escribe tambien para el reclasificado → R8 en «cobro completado» y filas 2 ≠ 1.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Los dos cobros LEGADOS (381: sin linea de caja) que se siembran a mano en el paso 6. */
const LEGADO_RECLASIFICADO = "700.00";
const LEGADO_COMPLETADO = "300.00";
const LEGADOS = new Prisma.Decimal(LEGADO_RECLASIFICADO).add(LEGADO_COMPLETADO).toFixed(2); // 1000.00
/** El cobro del ESCENARIO (lo registra `CobroTiendaService` en `sembrarEscenario459`). */
const COBRO_DEL_ESCENARIO = "2500.50";
/**
 * FICHA 457 (T5.4, R23): un cobro GRANDE a la tienda B la deja EN CONTRA (7 015,62 − 20 000,00 = −12 984,38);
 * sobre esa deuda la tienda le paga 4 000,00 a Ordenex y luego ese pago se anula.
 */
const COBRO_GRANDE_B = "20000.00";
const PAGO_DE_B = "4000.00";

interface Paso {
  nombre: string;
  lectura: LecturaCaja459;
  saldos: string; // Σ saldos de las dos tiendas del escenario
  filasNuevasEnCaja: number;
  saldoTiendaA: string;
  saldoTiendaB: string;
}

interface Medida {
  antes: LecturaCaja459;
  pasos: Paso[];
  estados: Record<string, string>;
  respuestas: Record<string, string>;
  /** La salida que escribio la migracion REAL de la 459, comparada con su cobro legado. */
  reclasificada: {
    salidas: number;
    mismoMonto: boolean;
    mismoInstante: boolean;
    categoria: string;
    descripcion: string | null;
  } | null;
  /** La linea que escribio la migracion REAL de la 461, comparada con su cobro legado. */
  completada: {
    lineas: number;
    lineasDelReclasificado: number;
    mismoMonto: boolean;
    mismoInstante: boolean;
    categoria: string;
    origen: string;
    descripcion: string | null;
  } | null;
  /** Los dos contra-asientos de la anulacion del cobro del escenario. */
  anulacion: { creditos: number; reversos: number; montoCredito: string; montoReverso: string } | null;
  /** Ficha 457: las cuatro filas del pago de la tienda B a Ordenex y de su anulacion, por origen. */
  abono: {
    creditos: number;
    debitos: number;
    ingresos: number;
    egresos: number;
    montos: string[];
    mismoInstanteRegistro: boolean;
    mismoInstanteAnulacion: boolean;
  } | null;
}

const suma = (xs: string[]) => xs.reduce((a, x) => a.add(new Prisma.Decimal(x)), new Prisma.Decimal(0)).toFixed(2);

describeSiHayBase("⭑ 459/T B.14 → 461/T B.12 — R7 y R8 al centimo tras cada camino, sin excepcion (Postgres real)", () => {
  let prisma: PrismaClient;
  let medida: Medida | undefined;
  let fallo: unknown;

  function m(): Medida {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la medida no llego a tomarse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    try {
      const cat = await cargarCatalogo459(prisma);
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${CLAVE_CANDADO_459})`);
        return medir(tx, cat);
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function medir(tx: TxDeTest, cat: Awaited<ReturnType<typeof cargarCatalogo459>>): Promise<Medida> {
    const s = montarServicios459(tx);
    const lector = { usuarioId: "00000000-0000-4000-8000-000000000459", rol: "maestro" as const };
    const antes = await leerCajaEntera(s, lector);
    let filasPrevias = await tx.walletMovimiento.count();
    const esc = await sembrarEscenario459(tx, cat);
    const pasos: Paso[] = [];
    const estados: Record<string, string> = {};
    const respuestas: Record<string, string> = {};
    let reclasificada: Medida["reclasificada"] = null;
    let completada: Medida["completada"] = null;
    let anulacion: Medida["anulacion"] = null;
    let abono: Medida["abono"] = null;

    const foto = async (nombre: string) => {
      const lectura = await leerCajaEntera(s, esc.maestro);
      const a = await leerTienda(s, esc.maestro, esc.tiendaA);
      const b = await leerTienda(s, esc.maestro, esc.tiendaB);
      const filas = await tx.walletMovimiento.count();
      pasos.push({
        nombre,
        lectura,
        saldos: suma([a.saldo, b.saldo]),
        filasNuevasEnCaja: filas - filasPrevias,
        saldoTiendaA: a.saldo,
        saldoTiendaB: b.saldo,
      });
      estados[nombre] = lectura.resumen.estado;
      filasPrevias = filas;
    };

    await foto("escenario");

    // 1 — pago por cuenta de la tienda A.
    const pago = await s.pagoPorCuenta.registrar(
      {
        claveIdempotencia: randomUUID(),
        tiendaId: esc.tiendaA,
        beneficiario: "Imprenta",
        monto: "1234.56",
        metodo: "SINPE",
        referencia: "INV-459",
        motivo: "Etiquetas",
      },
      null,
      esc.maestro,
    );
    respuestas.pagoPorCuenta = pago.status;
    if (pago.status !== "ok") throw new Error(`pago por cuenta: ${JSON.stringify(pago)}`);
    await foto("pago por cuenta");

    // 2 — su anulacion.
    respuestas.anularPagoPorCuenta = (
      await s.pagoPorCuenta.anular({ pagoId: pago.pago.id, motivo: "Duplicado" }, esc.maestro)
    ).status;
    await foto("anulacion del pago por cuenta");

    // 3 — saldo inicial (fechado el primer dia de la caja sin capital: R71).
    const primer = await new WalletMovimientoRepository(s.cliente).primerDiaDeLaCaja({ excluirCapital: true });
    const saldoInicial = await s.aporteCapital.registrar(
      {
        claveIdempotencia: randomUUID(),
        clase: "saldo_inicial",
        monto: "1000000.00",
        fecha: primer ?? fechaCalendarioCR(new Date()),
        motivo: "Saldo del banco",
      },
      null,
      esc.maestro,
    );
    respuestas.saldoInicial = saldoInicial.status;
    await foto("saldo inicial");

    // 4 — aporte.
    const aporte = await s.aporteCapital.registrar(
      {
        claveIdempotencia: randomUUID(),
        clase: "aporte",
        monto: "50000.25",
        fecha: fechaCalendarioCR(new Date()),
        motivo: "Aporte del socio",
      },
      null,
      esc.maestro,
    );
    respuestas.aporte = aporte.status;
    if (aporte.status !== "ok") throw new Error(`aporte: ${JSON.stringify(aporte)}`);
    await foto("aporte");

    // 5 — anulacion del aporte.
    respuestas.anularAporte = (
      await s.aporteCapital.anular({ aporteId: aporte.aporte.id, motivo: "Error" }, esc.maestro)
    ).status;
    await foto("anulacion del aporte");

    // 6 — dos cobros LEGADOS de la tienda B, como los dejaba la 381: debito `cobro_manual` sin linea
    // de caja. INSERT directo a proposito: el servicio de hoy ya no puede producir este estado (R1),
    // y es exactamente lo que las dos migraciones de datos (459 y 461) tienen que arreglar.
    const legadoReclasificado = await sembrarCobroLegado(tx, esc, LEGADO_RECLASIFICADO, "Legado 381 · reclasificar");
    const legadoCompletado = await sembrarCobroLegado(tx, esc, LEGADO_COMPLETADO, "Legado 381 · completar");
    await foto("cobros legados sin linea de caja");

    // 7 — el primero, RECLASIFICADO por el SQL REAL de la migracion de la 459 (R61: no se toca).
    reclasificada = await reclasificar(tx, esc, legadoReclasificado);
    await foto("cobro reclasificado");

    // 8 — el segundo recibe su LINEA DE CAJA por el SQL REAL de la migracion de datos de la 461
    // (R31/R32/R33): el reclasificado y el cobro del escenario (que ya tiene cargo) quedan fuera.
    completada = await completar(tx, legadoCompletado, legadoReclasificado);
    await foto("cobro completado");

    // 9 — ANULAR el cobro del escenario (registrado por el servicio, con su cargo): R10/R12/R25.
    const cobroDelEscenario = await tx.walletTiendaMovimiento.findFirstOrThrow({
      where: { tiendaId: esc.tiendaB, categoria: "cobro_manual", monto: new Prisma.Decimal(COBRO_DEL_ESCENARIO) },
      select: { id: true },
    });
    const anulado = await s.cobroTienda.anular({ cobroId: cobroDelEscenario.id, motivo: "Cobro equivocado" }, esc.maestro);
    respuestas.anularCobro = anulado.status;
    anulacion = await contraAsientosDe(tx, cobroDelEscenario.id);
    await foto("anulacion del cobro");

    // ── FICHA 457 (T5.4, R23) ─────────────────────────────────────────────────────────────────
    // 10 — un cobro GRANDE de Ordenex a la tienda B la deja EN CONTRA (la precondicion del pago, R14).
    respuestas.cobroGrande = (
      await s.cobroTienda.registrarCobro(
        { claveIdempotencia: randomUUID(), tiendaId: esc.tiendaB, monto: COBRO_GRANDE_B, descripcion: "Cobro grande 457" },
        esc.maestro,
      )
    ).status;
    await foto("cobro grande a la tienda B");

    // 11 — la tienda B le PAGA a Ordenex (efectivo de terceros: sube «Entro», la cifra y «De las tiendas»).
    const pagoDeB = await s.abonoTienda.registrar(
      {
        claveIdempotencia: randomUUID(),
        tiendaId: esc.tiendaB,
        monto: PAGO_DE_B,
        metodo: "SINPE",
        referencia: "SINPE-457",
        motivo: "Pago de lo que debía por los fletes",
        fechaPago: fechaCalendarioCR(new Date()),
      },
      null,
      esc.maestro,
    );
    respuestas.pagoDeTienda = pagoDeB.status;
    if (pagoDeB.status !== "ok") throw new Error(`pago de la tienda: ${JSON.stringify(pagoDeB)}`);
    await foto("pago de la tienda B a Ordenex");

    // 12 — su anulacion: la tienda vuelve a deber; «Salio» sube y la cifra y «De las tiendas» bajan.
    respuestas.anularPagoDeTienda = (
      await s.abonoTienda.anular({ abonoId: pagoDeB.abono.id, motivo: "Referencia equivocada" }, esc.maestro)
    ).status;
    abono = await asientosDelAbono(tx, pagoDeB.abono.id);
    await foto("anulacion del pago de la tienda B");

    // 13 — anular el saldo inicial: la caja vuelve a «flujo» (R21).
    if (saldoInicial.status === "ok") {
      respuestas.anularSaldoInicial = (
        await s.aporteCapital.anular({ aporteId: saldoInicial.aporte.id, motivo: "Cifra equivocada" }, esc.maestro)
      ).status;
    }
    await foto("anulacion del saldo inicial");

    return { antes, pasos, estados, respuestas, reclasificada, completada, anulacion, abono };
  }

  /** Ficha 457: las cuatro filas del pago de la tienda a Ordenex y de su anulacion, por su origen. */
  async function asientosDelAbono(tx: TxDeTest, abonoId: string): Promise<NonNullable<Medida["abono"]>> {
    const tienda = await tx.walletTiendaMovimiento.findMany({ where: { origenTipo: "abono_tienda", origenId: abonoId } });
    const caja = await tx.walletMovimiento.findMany({ where: { origenTipo: "abono_tienda", origenId: abonoId } });
    const instante = (filas: { categoria: string; fechaMovimiento: Date }[], cat: string) =>
      filas.find((f) => f.categoria === cat)?.fechaMovimiento.getTime();
    return {
      creditos: tienda.filter((f) => f.categoria === "abono_tienda").length,
      debitos: tienda.filter((f) => f.categoria === "abono_tienda_anulado").length,
      ingresos: caja.filter((f) => f.categoria === "ingreso_abono_tienda").length,
      egresos: caja.filter((f) => f.categoria === "egreso_reverso_abono_tienda").length,
      montos: [...tienda, ...caja].map((f) => f.monto.toFixed(2)),
      mismoInstanteRegistro: instante(tienda, "abono_tienda") === instante(caja, "ingreso_abono_tienda"),
      mismoInstanteAnulacion: instante(tienda, "abono_tienda_anulado") === instante(caja, "egreso_reverso_abono_tienda"),
    };
  }

  /** Un cobro como los de la 381: `debito/cobro_manual`, origen manual, SIN linea de caja, fechado en el pasado. */
  async function sembrarCobroLegado(tx: TxDeTest, esc: Escenario459, monto: string, descripcion: string) {
    return tx.walletTiendaMovimiento.create({
      data: {
        tiendaId: esc.tiendaB,
        tipo: "debito",
        categoria: "cobro_manual",
        monto: new Prisma.Decimal(monto),
        origenTipo: "manual",
        origenId: null,
        descripcion,
        registradoPor: esc.maestro.usuarioId,
        fechaMovimiento: new Date("2026-09-20T15:00:00.000Z"),
      },
      select: { id: true, monto: true, fechaMovimiento: true },
    });
  }

  /**
   * Ejecuta el `migration.sql` REAL (`db/migrations/20260925120300_reclasificar_cobros_459`) con la
   * lista y el control sustituidos por el cobro legado —los 203 ids aprobados no existen en una base
   * de test—, dentro de la transaccion revertida de este archivo. Si la migracion lanza, el test cae
   * entero: no hay SAVEPOINT que lo trague.
   */
  async function reclasificar(
    tx: TxDeTest,
    esc: Escenario459,
    cobro: { id: string; monto: Prisma.Decimal; fechaMovimiento: Date },
  ): Promise<NonNullable<Medida["reclasificada"]>> {
    const monto = cobro.monto.toFixed(2);
    await tx.$executeRawUnsafe(upCon([{ id: cobro.id, monto }], { n: 1, suma: monto, tienda: esc.tiendaB }));
    const salidas = await tx.walletMovimiento.findMany({
      where: { origenTipo: "cobro_manual_reclasificado", origenId: cobro.id },
    });
    const [s] = salidas;
    return {
      salidas: salidas.length,
      mismoMonto: s !== undefined && s.monto.toFixed(2) === monto,
      mismoInstante: s !== undefined && s.fechaMovimiento.getTime() === cobro.fechaMovimiento.getTime(),
      categoria: s?.categoria ?? "",
      descripcion: s?.descripcion ?? null,
    };
  }

  /** Ejecuta el `migration.sql` REAL de `20260926120200_cobro_tienda_461_completar_caja`, TAL CUAL. */
  async function completar(
    tx: TxDeTest,
    cobro: { id: string; monto: Prisma.Decimal; fechaMovimiento: Date },
    reclasificado: { id: string },
  ): Promise<NonNullable<Medida["completada"]>> {
    await tx.$executeRawUnsafe(UP_COMPLETAR_461);
    const lineas = await tx.walletMovimiento.findMany({ where: { origenId: cobro.id } });
    const [l] = lineas;
    return {
      lineas: lineas.length,
      lineasDelReclasificado: await tx.walletMovimiento.count({
        where: { origenId: reclasificado.id, categoria: "ingreso_cobro_tienda" },
      }),
      mismoMonto: l !== undefined && l.monto.toFixed(2) === cobro.monto.toFixed(2),
      mismoInstante: l !== undefined && l.fechaMovimiento.getTime() === cobro.fechaMovimiento.getTime(),
      categoria: l?.categoria ?? "",
      origen: l?.origenTipo ?? "",
      descripcion: l?.descripcion ?? null,
    };
  }

  async function contraAsientosDe(tx: TxDeTest, cobroId: string): Promise<NonNullable<Medida["anulacion"]>> {
    const creditos = await tx.walletTiendaMovimiento.findMany({
      where: { origenTipo: "cobro_tienda", origenId: cobroId, categoria: "cobro_tienda_anulado" },
    });
    const reversos = await tx.walletMovimiento.findMany({
      where: { origenTipo: "cobro_tienda", origenId: cobroId, categoria: "egreso_reverso_cobro_tienda" },
    });
    return {
      creditos: creditos.length,
      reversos: reversos.length,
      montoCredito: creditos[0]?.monto.toFixed(2) ?? "",
      montoReverso: reversos[0]?.monto.toFixed(2) ?? "",
    };
  }

  const delta = (p: Paso, f: (l: LecturaCaja459) => string) => menos(f(p.lectura), f(m().antes));

  it("anti-vacuidad: todos los pasos respondieron `ok` y CADA paso escribio en la caja lo que le toca", () => {
    expect(m().respuestas).toEqual({
      pagoPorCuenta: "ok",
      anularPagoPorCuenta: "ok",
      saldoInicial: "ok",
      aporte: "ok",
      anularAporte: "ok",
      anularCobro: "ok",
      cobroGrande: "ok",
      pagoDeTienda: "ok",
      anularPagoDeTienda: "ok",
      anularSaldoInicial: "ok",
    });
    expect(m().pasos.map((p) => [p.nombre, p.filasNuevasEnCaja])).toEqual([
      // 22 de la 459 + el CARGO del cobro del escenario (461/R1): 23.
      ["escenario", 23],
      ["pago por cuenta", 1],
      ["anulacion del pago por cuenta", 1],
      ["saldo inicial", 1],
      ["aporte", 1],
      ["anulacion del aporte", 1],
      // Los legados se siembran SOLO en el libro de la tienda: la caja no se toca.
      ["cobros legados sin linea de caja", 0],
      ["cobro reclasificado", 1],
      ["cobro completado", 1],
      // El REVERSO del cargo (el credito va al libro de la tienda).
      ["anulacion del cobro", 1],
      // Ficha 457: el cargo del cobro grande; la ENTRADA del pago de la tienda; el EGRESO de su anulacion.
      // Mutacion 1 de design §13 de la 457 (sin `emitirIngresoDeAbono`) → aqui 0 y R8 rota en el paso 11.
      ["cobro grande a la tienda B", 1],
      ["pago de la tienda B a Ordenex", 1],
      ["anulacion del pago de la tienda B", 1],
      ["anulacion del saldo inicial", 1],
    ]);
  });

  it("⭑ 457 (R17/R20/R31/R32): el pago de la tienda B dejo un credito y una entrada con el mismo instante; su anulacion, un debito y un egreso con el mismo instante; los cuatro por 4 000,00", () => {
    expect(m().abono).toEqual({
      creditos: 1,
      debitos: 1,
      ingresos: 1,
      egresos: 1,
      montos: [PAGO_DE_B, PAGO_DE_B, PAGO_DE_B, PAGO_DE_B],
      mismoInstanteRegistro: true,
      mismoInstanteAnulacion: true,
    });
  });

  it("R61 (revision m1 de la 459): la salida del cobro reclasificado la escribio el SQL REAL de la migracion de la 459", () => {
    expect(m().reclasificada).toMatchObject({
      salidas: 1,
      mismoMonto: true,
      mismoInstante: true,
      categoria: "egreso_pago_por_cuenta_tienda",
    });
    // La descripcion la compone la migracion («Nombre Apellido · descripcion del cobro»).
    expect(m().reclasificada?.descripcion).toMatch(/ · /);
  });

  it("R31/R32/R33: la migracion de datos de la 461 completa SOLO al legado sin reclasificar, en su fecha, con su origen", () => {
    expect(m().completada).toMatchObject({
      lineas: 1,
      lineasDelReclasificado: 0, // R32: al reclasificado NO se le escribe cargo
      mismoMonto: true,
      mismoInstante: true, // R31: la fecha ORIGINAL del cobro, no la de hoy
      categoria: "ingreso_cobro_tienda",
      origen: "cobro_tienda_completado", // R33
    });
    expect(m().completada?.descripcion).toMatch(/ · Legado 381 · completar$/);
  });

  it("R10/R12/R13: anular el cobro deja UN credito a la tienda y UN reverso en la caja, los dos por el monto del cobro", () => {
    expect(m().anulacion).toEqual({
      creditos: 1,
      reversos: 1,
      montoCredito: COBRO_DEL_ESCENARIO,
      montoReverso: COBRO_DEL_ESCENARIO,
    });
  });

  it("R7: cifra principal = ganancia + «De las tiendas» + capital, tras CADA paso (libro entero y diferencia)", () => {
    for (const p of m().pasos) {
      const r = p.lectura.resumen;
      expect(suma([r.ganancia, r.deTerceros, r.capital]), `R7 libro entero · ${p.nombre}`).toBe(r.enCaja);
      expect(
        suma([delta(p, (l) => l.resumen.ganancia), delta(p, (l) => l.resumen.deTerceros), delta(p, (l) => l.resumen.capital)]),
        `R7 diferencia · ${p.nombre}`,
      ).toBe(delta(p, (l) => l.resumen.enCaja));
      expect(r.deOrdenex, `«De Ordenex» · ${p.nombre}`).toBe(suma([r.ganancia, r.capital]));
    }
  });

  it("R8 (HD2): Δ«De las tiendas» = Σ saldos de las tiendas, SIN excepcion, tras CADA paso — salvo en la foto legada, que falla por la cifra exacta", () => {
    for (const p of m().pasos) {
      if (p.nombre === "cobros legados sin linea de caja") {
        // El estado de la 381: dos debitos en el libro de la tienda y NADA en la caja. R8 se rompe
        // por EXACTAMENTE la suma de los dos, y las dos migraciones (pasos 7 y 8) lo arreglan.
        expect(delta(p, (l) => l.resumen.deTerceros), `R8 rota a proposito · ${p.nombre}`).toBe(
          suma([p.saldos, LEGADOS]),
        );
        continue;
      }
      if (p.nombre === "cobro reclasificado") {
        // La 459 arreglo UNO; el otro legado sigue sin linea de caja hasta el paso 8. R8 se rompe
        // por EXACTAMENTE ese importe, y ni un centimo mas: la reclasificacion cerro el suyo.
        expect(delta(p, (l) => l.resumen.deTerceros), `R8 rota solo por el legado pendiente · ${p.nombre}`).toBe(
          suma([p.saldos, LEGADO_COMPLETADO]),
        );
        continue;
      }
      expect(delta(p, (l) => l.resumen.deTerceros), `R8 · ${p.nombre}`).toBe(p.saldos);
    }
  });

  it("R23–R26, R39/R48/R72/R75: cada camino mueve EXACTAMENTE su cifra", () => {
    const pasos = m().pasos;
    const cambio = (i: number) => {
      const [a, b] = [pasos[i - 1].lectura.resumen, pasos[i].lectura.resumen];
      return {
        enCaja: menos(b.enCaja, a.enCaja),
        deTerceros: menos(b.deTerceros, a.deTerceros),
        capital: menos(b.capital, a.capital),
        ganancia: menos(b.ganancia, a.ganancia),
        saldoTiendaA: menos(pasos[i].saldoTiendaA, pasos[i - 1].saldoTiendaA),
        saldoTiendaB: menos(pasos[i].saldoTiendaB, pasos[i - 1].saldoTiendaB),
      };
    };
    const nada = { enCaja: "0.00", deTerceros: "0.00", capital: "0.00", ganancia: "0.00", saldoTiendaA: "0.00", saldoTiendaB: "0.00" };
    expect(cambio(1)).toEqual({ ...nada, enCaja: "-1234.56", deTerceros: "-1234.56", saldoTiendaA: "-1234.56" });
    expect(cambio(2)).toEqual({ ...nada, enCaja: "1234.56", deTerceros: "1234.56", saldoTiendaA: "1234.56" });
    expect(cambio(3)).toEqual({ ...nada, enCaja: "1000000.00", capital: "1000000.00" });
    expect(cambio(4)).toEqual({ ...nada, enCaja: "50000.25", capital: "50000.25" });
    expect(cambio(5)).toEqual({ ...nada, enCaja: "-50000.25", capital: "-50000.25" });
    // 6 — los legados: solo baja el saldo de la tienda B; la caja no se entera (ese es el fallo).
    expect(cambio(6)).toEqual({ ...nada, saldoTiendaB: `-${LEGADOS}` });
    // 7 — el reclasificado: sale de la caja y de «De las tiendas»; el libro de la tienda no cambia (R87 de la 459).
    expect(cambio(7)).toEqual({ ...nada, enCaja: `-${LEGADO_RECLASIFICADO}`, deTerceros: `-${LEGADO_RECLASIFICADO}` });
    // 8 — el completado (R23/R24 de la 461): la cifra principal NO se mueve (el cargo no es efectivo),
    // «De las tiendas» baja y la ganancia sube por el mismo importe; el libro de la tienda no cambia.
    expect(cambio(8)).toEqual({ ...nada, deTerceros: `-${LEGADO_COMPLETADO}`, ganancia: LEGADO_COMPLETADO });
    // 9 — la anulacion del cobro (R25/R26): lo contrario exacto del cargo, y el saldo de B vuelve.
    expect(cambio(9)).toEqual({
      ...nada,
      deTerceros: COBRO_DEL_ESCENARIO,
      ganancia: `-${COBRO_DEL_ESCENARIO}`,
      saldoTiendaB: COBRO_DEL_ESCENARIO,
    });
    // ── Ficha 457 (R19/R23/R39, design §4.1) ──
    // 10 — el cobro grande (461): un cargo. La cifra principal no se mueve; «De las tiendas» baja y la
    // ganancia sube 20 000,00; la tienda B queda EN CONTRA.
    expect(cambio(10)).toEqual({ ...nada, deTerceros: `-${COBRO_GRANDE_B}`, ganancia: COBRO_GRANDE_B, saldoTiendaB: `-${COBRO_GRANDE_B}` });
    expect(pasos[10].saldoTiendaB).toBe("-12984.38"); // 7 015,62 − 20 000,00
    // 11 — el pago de la tienda a Ordenex (R19, DH1): «Entro», la cifra principal y «De las tiendas» suben
    // 4 000,00 y el saldo de B sube lo mismo; la ganancia y el capital NO se mueven.
    // Mutaciones 2 y 3 de §13 (propio / cargo) → aqui la ganancia se moveria o la cifra no.
    expect(cambio(11)).toEqual({ ...nada, enCaja: PAGO_DE_B, deTerceros: PAGO_DE_B, saldoTiendaB: PAGO_DE_B });
    expect(menos(pasos[11].lectura.resumen.entradas, pasos[10].lectura.resumen.entradas)).toBe(PAGO_DE_B);
    expect(menos(pasos[11].lectura.resumen.salidas, pasos[10].lectura.resumen.salidas)).toBe("0.00");
    expect(pasos[11].saldoTiendaB).toBe("-8984.38");
    // 12 — su anulacion (R39): «Salio» sube 4 000,00; la cifra y «De las tiendas» bajan lo mismo; la
    // tienda vuelve a deber; ganancia y capital intactos. Mutacion 8 de §13 (sin el debito) → R8 rota aqui.
    expect(cambio(12)).toEqual({ ...nada, enCaja: `-${PAGO_DE_B}`, deTerceros: `-${PAGO_DE_B}`, saldoTiendaB: `-${PAGO_DE_B}` });
    expect(menos(pasos[12].lectura.resumen.salidas, pasos[11].lectura.resumen.salidas)).toBe(PAGO_DE_B);
    expect(menos(pasos[12].lectura.resumen.entradas, pasos[11].lectura.resumen.entradas)).toBe("0.00");
    expect(pasos[12].saldoTiendaB).toBe("-12984.38");
    expect(cambio(13)).toEqual({ ...nada, enCaja: "-1000000.00", capital: "-1000000.00" });
  });

  it("R14/R21 (459): la caja esta en «saldo» mientras el saldo inicial esta vigente, y vuelve a «flujo» al anularlo", () => {
    expect(m().estados).toEqual({
      escenario: "flujo",
      "pago por cuenta": "flujo",
      "anulacion del pago por cuenta": "flujo",
      "saldo inicial": "saldo",
      aporte: "saldo",
      "anulacion del aporte": "saldo",
      "cobros legados sin linea de caja": "saldo",
      "cobro reclasificado": "saldo",
      "cobro completado": "saldo",
      "anulacion del cobro": "saldo",
      "cobro grande a la tienda B": "saldo",
      "pago de la tienda B a Ordenex": "saldo",
      "anulacion del pago de la tienda B": "saldo",
      "anulacion del saldo inicial": "flujo",
    });
  });
});
