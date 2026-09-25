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
import { CLAVE_CANDADO_459 } from "./_fixtures/escrituras-459";
import { upCon } from "./_fixtures/reclasificacion-459-sql";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 459 / T B.14 — LA INVARIANTE CON TODO (R7, R8, R89; y R21, R39, R48, R72, R75).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Sobre el escenario de la fase 0 (todos los caminos que escriben en la caja o en el libro de las
// tiendas, sembrados por los SERVICIOS REALES) se ejecutan, uno a uno, los caminos NUEVOS de la
// ficha: pago por cuenta, su anulacion, saldo inicial, aporte, anulacion del aporte y un cobro de un
// costo RECLASIFICADO (la fila que escribe la migracion de T C.4). Tras CADA paso se comprueba:
//
//   R7 — cifra principal = ganancia + «De las tiendas» + capital, al centimo, sobre el libro ENTERO
//        (la identidad vale para cualquier conjunto) y sobre la diferencia con el «antes».
//   R8 — Δ«De las tiendas» = Σ saldos de las tiendas del escenario + Σ cobros de un costo de esas
//        tiendas que NO estan reclasificados. Se mide por DIFERENCIA: la base local es compartida y
//        trae su propia historia (la de antes de esta ficha, donde R8 no tiene por que cuadrar: L1);
//        las tiendas del escenario son nuevas, asi que su parte del libro es exactamente la suya.
//
// Y que cada paso escribio filas (una invariante sobre un libro vacio no prueba nada).
//
// AISLAMIENTO: todo en UNA transaccion REPEATABLE READ que SIEMPRE se revierte. Toma, ademas del
// lock de las escrituras reales, el candado de los archivos de la 459 que COMMITEAN (el saldo
// inicial es unico en toda la base): sin el, el `pg_advisory_xact_lock` del saldo inicial que esta
// transaccion sostiene hasta el final dejaria esperando —y caducando— a esos tests.
//
// MUTACION DE LA TAREA: «el reverso del pago por cuenta como propio» (NATURALEZA de
// `ingreso_reverso_pago_por_cuenta_tienda` = "propio") → rojo: tras anular, «De las tiendas» no
// vuelve a subir y la ganancia sube.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface Paso {
  nombre: string;
  lectura: LecturaCaja459;
  saldos: string; // Σ saldos de las dos tiendas del escenario
  cobrosNoReclasificados: string;
  filasNuevasEnCaja: number;
  saldoTiendaA: string;
}

interface Medida {
  antes: LecturaCaja459;
  pasos: Paso[];
  estados: Record<string, string>;
  respuestas: Record<string, string>;
  /** La salida que escribio la migracion REAL, comparada con su cobro. */
  reclasificada: {
    salidas: number;
    mismoMonto: boolean;
    mismoInstante: boolean;
    categoria: string;
    descripcion: string | null;
  } | null;
}

const suma = (xs: string[]) => xs.reduce((a, x) => a.add(new Prisma.Decimal(x)), new Prisma.Decimal(0)).toFixed(2);

describeSiHayBase("⭑ 459/T B.14 — R7 y R8 al centimo tras cada camino nuevo (Postgres real)", () => {
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

    const foto = async (nombre: string) => {
      const lectura = await leerCajaEntera(s, esc.maestro);
      const a = await leerTienda(s, esc.maestro, esc.tiendaA);
      const b = await leerTienda(s, esc.maestro, esc.tiendaB);
      const filas = await tx.walletMovimiento.count();
      pasos.push({
        nombre,
        lectura,
        saldos: suma([a.saldo, b.saldo]),
        cobrosNoReclasificados: await cobrosNoReclasificados(tx, esc),
        filasNuevasEnCaja: filas - filasPrevias,
        saldoTiendaA: a.saldo,
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

    // 6 — el cobro de un costo de la tienda B, RECLASIFICADO por el SQL REAL de la migracion de
    // T C.4 (revision m1: antes era un insert de Prisma escrito a mano, y una migracion que no
    // escribia nada lo dejaba verde). El libro de la tienda NO cambia.
    reclasificada = await reclasificar(tx, esc);
    await foto("cobro reclasificado");

    // 7 — anular el saldo inicial: la caja vuelve a «flujo» (R21).
    if (saldoInicial.status === "ok") {
      respuestas.anularSaldoInicial = (
        await s.aporteCapital.anular({ aporteId: saldoInicial.aporte.id, motivo: "Cifra equivocada" }, esc.maestro)
      ).status;
    }
    await foto("anulacion del saldo inicial");

    return { antes, pasos, estados, respuestas, reclasificada };
  }

  /** Σ de los cobros de un costo de las tiendas del escenario que no tienen su salida reclasificada. */
  async function cobrosNoReclasificados(tx: TxDeTest, esc: Escenario459): Promise<string> {
    const cobros = await tx.walletTiendaMovimiento.findMany({
      where: { tiendaId: { in: [esc.tiendaA, esc.tiendaB] }, categoria: "cobro_manual" },
      select: { id: true, monto: true },
    });
    const reclasificados = new Set(
      (
        await tx.walletMovimiento.findMany({
          where: { origenTipo: "cobro_manual_reclasificado", origenId: { in: cobros.map((c) => c.id) } },
          select: { origenId: true },
        })
      ).map((r) => r.origenId),
    );
    return suma(cobros.filter((c) => !reclasificados.has(c.id)).map((c) => c.monto.toFixed(2)));
  }

  /**
   * Ejecuta el `migration.sql` REAL (`db/migrations/20260925120300_reclasificar_cobros_459`) con la
   * lista y el control sustituidos por el cobro de la tienda B del escenario —los 203 ids aprobados
   * no existen en una base de test—, dentro de la transaccion revertida de este archivo. Si la
   * migracion lanza, el test cae entero: no hay SAVEPOINT que lo trague.
   */
  async function reclasificar(tx: TxDeTest, esc: Escenario459): Promise<NonNullable<Medida["reclasificada"]>> {
    const cobro = await tx.walletTiendaMovimiento.findFirstOrThrow({
      where: { tiendaId: esc.tiendaB, categoria: "cobro_manual" },
    });
    const monto = cobro.monto.toFixed(2);
    await tx.$executeRawUnsafe(
      upCon([{ id: cobro.id, monto }], { n: 1, suma: monto, tienda: esc.tiendaB }),
    );
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

  const delta = (p: Paso, f: (l: LecturaCaja459) => string) => menos(f(p.lectura), f(m().antes));

  it("anti-vacuidad: todos los pasos respondieron `ok` y CADA paso escribio en la caja", () => {
    expect(m().respuestas).toEqual({
      pagoPorCuenta: "ok",
      anularPagoPorCuenta: "ok",
      saldoInicial: "ok",
      aporte: "ok",
      anularAporte: "ok",
      anularSaldoInicial: "ok",
    });
    expect(m().pasos.map((p) => [p.nombre, p.filasNuevasEnCaja])).toEqual([
      ["escenario", 22],
      ["pago por cuenta", 1],
      ["anulacion del pago por cuenta", 1],
      ["saldo inicial", 1],
      ["aporte", 1],
      ["anulacion del aporte", 1],
      ["cobro reclasificado", 1],
      ["anulacion del saldo inicial", 1],
    ]);
  });

  it("revision m1: la salida del cobro reclasificado la escribio el SQL REAL de la migracion", () => {
    expect(m().reclasificada).toMatchObject({
      salidas: 1,
      mismoMonto: true,
      mismoInstante: true,
      categoria: "egreso_pago_por_cuenta_tienda",
    });
    // La descripcion la compone la migracion («Nombre Apellido · descripcion del cobro»): un insert
    // escrito a mano en el test no la produciria.
    expect(m().reclasificada?.descripcion).toMatch(/ · /);
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

  it("R8/R89: Δ«De las tiendas» = Σ saldos + cobros de un costo NO reclasificados, tras CADA paso", () => {
    for (const p of m().pasos) {
      expect(delta(p, (l) => l.resumen.deTerceros), `R8 · ${p.nombre}`).toBe(
        suma([p.saldos, p.cobrosNoReclasificados]),
      );
    }
    // Y la reclasificacion es la que mueve el segundo sumando: antes 2 500,50, despues 0,00.
    const porNombre = Object.fromEntries(m().pasos.map((p) => [p.nombre, p]));
    expect(porNombre["anulacion del aporte"].cobrosNoReclasificados).toBe("2500.50");
    expect(porNombre["cobro reclasificado"].cobrosNoReclasificados).toBe("0.00");
  });

  it("R39/R48/R72/R75: cada camino mueve EXACTAMENTE su cifra, y nunca la ganancia", () => {
    const pasos = m().pasos;
    const cambio = (i: number) => {
      const [a, b] = [pasos[i - 1].lectura.resumen, pasos[i].lectura.resumen];
      return {
        enCaja: menos(b.enCaja, a.enCaja),
        deTerceros: menos(b.deTerceros, a.deTerceros),
        capital: menos(b.capital, a.capital),
        ganancia: menos(b.ganancia, a.ganancia),
        saldoTiendaA: menos(pasos[i].saldoTiendaA, pasos[i - 1].saldoTiendaA),
      };
    };
    expect(cambio(1)).toEqual({ enCaja: "-1234.56", deTerceros: "-1234.56", capital: "0.00", ganancia: "0.00", saldoTiendaA: "-1234.56" });
    expect(cambio(2)).toEqual({ enCaja: "1234.56", deTerceros: "1234.56", capital: "0.00", ganancia: "0.00", saldoTiendaA: "1234.56" });
    expect(cambio(3)).toEqual({ enCaja: "1000000.00", deTerceros: "0.00", capital: "1000000.00", ganancia: "0.00", saldoTiendaA: "0.00" });
    expect(cambio(4)).toEqual({ enCaja: "50000.25", deTerceros: "0.00", capital: "50000.25", ganancia: "0.00", saldoTiendaA: "0.00" });
    expect(cambio(5)).toEqual({ enCaja: "-50000.25", deTerceros: "0.00", capital: "-50000.25", ganancia: "0.00", saldoTiendaA: "0.00" });
    // El reclasificado: sale de la caja y de «De las tiendas»; el libro de la tienda no cambia (R87).
    expect(cambio(6)).toEqual({ enCaja: "-2500.50", deTerceros: "-2500.50", capital: "0.00", ganancia: "0.00", saldoTiendaA: "0.00" });
    expect(cambio(7)).toEqual({ enCaja: "-1000000.00", deTerceros: "0.00", capital: "-1000000.00", ganancia: "0.00", saldoTiendaA: "0.00" });
  });

  it("R14/R21: la caja esta en «saldo» mientras el saldo inicial esta vigente, y vuelve a «flujo» al anularlo", () => {
    expect(m().estados).toEqual({
      escenario: "flujo",
      "pago por cuenta": "flujo",
      "anulacion del pago por cuenta": "flujo",
      "saldo inicial": "saldo",
      aporte: "saldo",
      "anulacion del aporte": "saldo",
      "cobro reclasificado": "saldo",
      "anulacion del saldo inicial": "flujo",
    });
  });
});

