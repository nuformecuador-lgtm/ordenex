// FICHA 347 — EL DINERO DE UNA ORDEN, DERIVADO. Modulo PURO.
//
// Sin Prisma salvo `Decimal` (que es aritmetica), sin repositorios, sin servicios, sin Next,
// sin reloj y sin efectos al importarse. Money-safe: nada de `Number(`, `parseFloat(` ni
// `parseInt(` sobre un importe; toda la aritmetica con `Prisma.Decimal` y toda salida STRING
// escala 2.
//
// ─── NI UNA FORMULA DE DINERO NUEVA (R16) ────────────────────────────────────────────────
//
// Aqui NO se calcula dinero: se LLAMA a las dos funciones que ya lo producen en el cierre.
//
//  - `derivarIngresoOrden(input, tarifa)` — lo que Ordenex factura por UNA gestion, sobre las
//    ENTRADAS CONGELADAS de esa orden en ese cierre (`cierre_detail`), nunca sobre la tarifa
//    vigente hoy (R17).
//  - `pagoTiendaOrdenex(totalGeneral, fleteConIva, comisionConIva)` — lo que le queda a la
//    tienda de lo que se recogio.
//
// La ACUMULACION tampoco es nueva: es la misma que `agregarIngresosPorConcepto` ya hace sobre
// un cierre entero, PARTICIONADA por orden — exactamente igual que `aporteDeOrden` de la ficha
// 344, y exacta por el mismo motivo: cada aporte que devuelve `derivarIngresoOrden` viene ya a
// escala 2 (`round2`/`aplicarPorcentaje`), asi que sumar dos decimales da dos decimales y no
// hay deriva de redondeo.
//
// Y la AGRUPACION «concepto + su IVA» en `fleteConIva`/`comisionConIva` tampoco se inventa: es
// la que `CierresAdminRepository.toIngresoOrdenex` ya escribe y la que la FIRMA de
// `pagoTiendaOrdenex` exige por contrato — esa funcion recibe justo esos dos parametros.
//
// ─── LAS DOS INVARIANTES, Y LAS DOS POR CONSTRUCCION ──────────────────────────────────────
//
//   ordenex + tienda === liquidadoRecaudado                   (R20)
//   liquidadoRecaudado + pendienteRecaudado === recaudado      (R21)
//
// La primera es cierta porque `tienda` SE CALCULA COMO ESA RESTA
// (`pagoTiendaOrdenex(liquidadoRecaudado, fleteConIva, comisionConIva)`) y `ordenex` es
// exactamente `fleteConIva + comisionConIva`. No es una coincidencia aritmetica que haya que
// vigilar: es la definicion. La segunda es cierta porque las gestiones de entrega se
// PARTICIONAN en dos —liquidadas y no liquidadas— y cada una cae en una y solo una.

import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";

import {
  CRITERIO_DE_APORTE,
  satisfaceCriterio,
  type CriterioDeAporte,
  type OrdenCongelada,
} from "@/lib/utils/aporte-por-orden";
import { derivarIngresoOrden, pagoTiendaOrdenex } from "@/lib/utils/ingreso-ordenex";

/* -------------------------------------------------------------------------- */
/* 1. El criterio del recaudo                                                  */
/* -------------------------------------------------------------------------- */

/**
 * LO QUE UNA GESTION DE ENTREGA RECAUDO. Misma forma que los criterios de la 344, para que
 * `satisfaceCriterio` lo entienda sin una segunda definicion (R24).
 *
 * ⚠ POR QUE SOLO `entregada`, y por que el filtro es EXPLICITO aunque hoy no cambie nada
 * (⟨Q1⟩, decision del humano del 2026-09-01 — NO se reabre).
 *
 * El pedido dice «lo recaudado de las ENTREGAS que se han hecho de ese producto», y esto lo
 * toma al pie de la letra. La alternativa era el criterio del ledger por tienda
 * (`CRITERIO_COD_RECAUDADO`), que acumula `monto_recibido` de TODA gestion del cierre —
 * entregada o no—.
 *
 * MEDIDO EN PRODUCCION antes de decidir: CERO gestiones con recaudo que no sean entrega. O sea
 * que hoy las dos definiciones dan EL MISMO NUMERO. El filtro explicito no esta para cambiar la
 * cifra: esta para que la cifra NO CAMBIE SOLA el dia que alguien registre un abono en una
 * reprogramacion. Sin el, ese abono entraria en una columna rotulada «entregas» sin que nadie
 * tocara una linea; con el, entra en la wallet (donde debe) y aqui no, y la diferencia es
 * visible y explicable.
 *
 * `exigeTarifa: false` — el recaudo EXISTE sin cierre: es lo COBRADO (un hecho de la gestion),
 * no lo derivado. `exigeMontoRecibido: true` — supresion de ceros: una gestion que no recaudo
 * nada no aporta (misma decision que la 344, ⟨Q2⟩ de aquella ficha).
 */
export const CRITERIO_RECAUDO_ENTREGA: CriterioDeAporte = {
  resultados: ["entregada"],
  exigeCobraComision: false,
  exigeTarifa: false,
  exigeMontoCobrar: false,
  exigeMontoRecibido: true,
};

/**
 * LOS RESULTADOS QUE LA CONSULTA TIENE QUE TRAER. DERIVADO, no escrito (R24).
 *
 * Es la union de los resultados del criterio de recaudo y de los de los SEIS conceptos de
 * `CRITERIO_DE_APORTE`, deduplicada y ordenada. Hoy vale `["entregada", "rechazada"]`, pero esa
 * lista NO se escribe en ninguna parte: el dia que la formula gane o pierda un resultado —como
 * paso al reves con la ficha 301, que saco `devuelta` de los conceptos de devolucion— la
 * consulta lo gana o lo pierde CON ELLA, en el mismo commit y sin que nadie se acuerde.
 *
 * El orden es por unidades de codigo (`sort()` por defecto sobre cadenas) y no
 * `localeCompare`: determinismo antes que correccion tipografica, misma regla que el resto de
 * la vertical (R25).
 */
export const RESULTADOS_QUE_APORTAN: readonly GestionResultado[] = (() => {
  const vistos = new Set<GestionResultado>(CRITERIO_RECAUDO_ENTREGA.resultados);
  for (const criterio of Object.values(CRITERIO_DE_APORTE)) {
    for (const resultado of criterio.resultados) vistos.add(resultado);
  }
  return [...vistos].sort();
})();

/* -------------------------------------------------------------------------- */
/* 2. Que es una gestion LIQUIDADA                                             */
/* -------------------------------------------------------------------------- */

/**
 * El estado de cierre en que el dinero SE MOVIO DE VERDAD.
 *
 * ⚠ ⟨Q2⟩, resuelta por el humano: «liquidado» exige cierre APROBADO, no que exista el snapshot.
 * `cierre_detail` se escribe al SOLICITAR, asi que hay un tercer estado —tarifa ya congelada,
 * dinero aun sin salir— y ese estado cuenta como PENDIENTE. El motivo es concreto y no teorico:
 * en este repo un cierre solicitado se ha llegado a BORRAR, y con el su snapshot; llamar
 * «liquidado» a eso seria dar por cobrado dinero que puede desaparecer.
 */
export const ESTADO_CIERRE_LIQUIDADO = "aprobado";

/** Una gestion de la orden, con los tres hechos que deciden si su dinero esta liquidado. */
export interface GestionDeDinero {
  readonly resultado: GestionResultado;
  /** STRING escala 2, o `null`. Lo que ESA gestion recaudo. Nunca `number`. */
  readonly montoRecibido: string | null;
  /** `cierre_dia.estado` de su cierre; `null` si la gestion no tiene cierre. */
  readonly cierreEstado: string | null;
  /** Las entradas congeladas de ESA orden en ESE cierre; `null` si no hay fila de snapshot. */
  readonly congelada: OrdenCongelada | null;
}

/**
 * LAS TRES CONDICIONES, declaradas UNA vez (`design.md §4.3`):
 *
 *  1. la gestion tiene cierre (implicito: sin cierre no hay `cierreEstado`);
 *  2. ese cierre esta APROBADO;
 *  3. existe su fila `cierre_detail` y con `tarifa_id IS NOT NULL`.
 *
 * La (3) es R23: sin tarifa congelada no se deriva NADA. `tarifaDe` devuelve `null` cuando
 * `tarifa_id IS NULL` y `derivarIngresoOrden` con `tarifa === null` devuelve `{}` — el gap R9
 * de la feature 42, que aqui se PRESERVA y no se convierte en `0,00`. Esa gestion se queda del
 * lado PENDIENTE: su recaudo es un hecho y se muestra; su reparto no existe y se deja en
 * blanco (R27/R30/R31).
 */
export function esLiquidada(gestion: GestionDeDinero): boolean {
  return (
    gestion.cierreEstado === ESTADO_CIERRE_LIQUIDADO &&
    gestion.congelada !== null &&
    gestion.congelada.tarifa !== null
  );
}

/* -------------------------------------------------------------------------- */
/* 3. El reparto de UNA orden                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Las cifras de dinero de UNA orden (o de un grupo de ordenes: el acumulador es el mismo).
 * TODO importe es STRING escala 2 (R22). `null` NO es cero: es «no hay nada liquidado».
 */
export interface RepartoDeOrden {
  /** Lo que las gestiones de ENTREGA cobraron. Existe con o sin cierre. */
  readonly recaudado: string;
  /** La parte de `recaudado` que esta en cierres APROBADOS con tarifa congelada. */
  readonly liquidadoRecaudado: string;
  /** El resto de `recaudado`. `liquidadoRecaudado + pendienteRecaudado === recaudado` (R21). */
  readonly pendienteRecaudado: string;
  /** Flete + IVA + comision COD + IVA. `null` = no hay ni una gestion liquidada (R30). */
  readonly ordenex: string | null;
  /** Lo recaudado liquidado menos lo que Ordenex le factura. `null` por el mismo motivo. */
  readonly tienda: string | null;
  /** Flete de devolucion + su IVA de las RECHAZADAS liquidadas. FUERA del reparto (R19). */
  readonly retorno: string | null;
  /** `true` si alguna de sus gestiones esta liquidada. Decide el rotulo de la fila del detalle. */
  readonly hayLiquidado: boolean;
}

/** Suma exacta de importes que ya vienen a escala 2. No es una formula: es un acumulador. */
function sumar(acc: Prisma.Decimal, aporte: Prisma.Decimal | undefined): Prisma.Decimal {
  return aporte === undefined ? acc : acc.plus(aporte);
}

/**
 * Las seis cifras de una orden a partir de SUS gestiones.
 *
 * ⚠ R18 — UNA ORDEN EN DOS CIERRES. No hay caso especial: cada gestion trae SU snapshot
 * congelado (`congelada`) porque el grano de la fila cruda es `(orden, gestion)`, asi que las
 * dos derivaciones ocurren con las entradas de SU cierre y se SUMAN. Lo que no se hace es
 * contar la orden dos veces en ningun cardinal: eso lo resuelve el llamador con un `Set`.
 *
 * ⚠ LAS GESTIONES ANULADAS NO LLEGAN AQUI, y se dice donde se decide: la consulta las deja
 * fuera con `anulada_at IS NULL` (⟨Q3⟩, decision del humano, ver `DineroProductosRepository`).
 *
 * ⚠ EL RETORNO NO ENTRA EN `ordenex` (R19). Si entrara, `ordenex + tienda` daria
 * `liquidadoRecaudado + retorno` y R20 dejaria de ser cierta. Y no es un detalle contable:
 * seria afirmar que de la plata que el mensajero trajo salio un cobro que NADIE RECAUDO. El
 * retorno es una cuenta por cobrar a la tienda, no una division de lo recogido — el
 * razonamiento esta escrito en `pagoTiendaOrdenex`, que NO lo descuenta.
 */
export function repartoDeOrden(gestiones: readonly GestionDeDinero[]): RepartoDeOrden {
  let recaudado = new Prisma.Decimal(0);
  let liquidadoRecaudado = new Prisma.Decimal(0);
  let fleteConIva = new Prisma.Decimal(0);
  let comisionConIva = new Prisma.Decimal(0);
  let retorno = new Prisma.Decimal(0);
  let hayLiquidado = false;

  for (const g of gestiones) {
    const liquidada = esLiquidada(g);
    if (liquidada) hayLiquidado = true;

    // (a) EL RECAUDO. Solo ENTREGAS, por el criterio declarado arriba. Se evalua con
    //     `satisfaceCriterio` —la misma funcion que la 344— y no con un `if` escrito aqui:
    //     una segunda forma del mismo criterio es exactamente lo que R24 prohibe.
    const recaudo = new Prisma.Decimal(g.montoRecibido ?? "0");
    const aportaRecaudo = satisfaceCriterio(CRITERIO_RECAUDO_ENTREGA, {
      resultado: g.resultado,
      cobraComision: g.congelada?.cobraComision ?? false,
      hayTarifa: g.congelada?.tarifa != null,
      hayMontoCobrar: new Prisma.Decimal(g.congelada?.montoCobrar ?? "0").gt(0),
      hayMontoRecibido: recaudo.gt(0),
    });
    if (aportaRecaudo) {
      recaudado = recaudado.plus(recaudo);
      if (liquidada) liquidadoRecaudado = liquidadoRecaudado.plus(recaudo);
    }

    // (b) LO DERIVADO. Solo de gestiones liquidadas (R23/R26): sin cierre aprobado y sin
    //     tarifa congelada no se emite NINGUNA cifra derivada, ni siquiera un cero.
    if (!liquidada || g.congelada === null) continue;
    const derivado = derivarIngresoOrden(
      {
        resultado: g.resultado,
        esCentral: g.congelada.esCentral,
        esZonaEspecial: g.congelada.esZonaEspecial,
        montoCobrar: g.congelada.montoCobrar,
        cobraComision: g.congelada.cobraComision,
      },
      g.congelada.tarifa,
    );
    fleteConIva = sumar(sumar(fleteConIva, derivado.ingreso_flete), derivado.ingreso_iva_flete);
    comisionConIva = sumar(
      sumar(comisionConIva, derivado.ingreso_comision_cod),
      derivado.ingreso_iva_comision_cod,
    );
    retorno = sumar(
      sumar(retorno, derivado.ingreso_flete_devolucion),
      derivado.ingreso_iva_flete_devolucion,
    );
  }

  return {
    recaudado: recaudado.toFixed(2),
    liquidadoRecaudado: liquidadoRecaudado.toFixed(2),
    // La resta que hace cierta R21 por construccion: la particion es de las GESTIONES, y cada
    // una cae en una sola mitad.
    pendienteRecaudado: recaudado.minus(liquidadoRecaudado).toFixed(2),
    // `null` y no `"0.00"` cuando no hay nada liquidado (R30): «no hubo» y «salio cero» son
    // hechos distintos, y la pantalla los pinta distinto.
    ordenex: hayLiquidado ? fleteConIva.plus(comisionConIva).toFixed(2) : null,
    tienda: hayLiquidado
      ? // R20 POR CONSTRUCCION: `tienda` es la RESTA, no un segundo conteo. Es la misma
        // funcion que produce el pago a la tienda en el cierre.
        pagoTiendaOrdenex(
          liquidadoRecaudado.toFixed(2),
          fleteConIva.toFixed(2),
          comisionConIva.toFixed(2),
        )
      : null,
    retorno: hayLiquidado ? retorno.toFixed(2) : null,
    hayLiquidado,
  };
}

/** `true` si esta orden no aporta NADA en ninguna de las cuatro cifras de dinero (R39). */
export function aporteEsCero(r: RepartoDeOrden): boolean {
  const cero = (v: string | null): boolean => v === null || new Prisma.Decimal(v).isZero();
  return cero(r.recaudado) && cero(r.ordenex) && cero(r.tienda) && cero(r.retorno);
}
