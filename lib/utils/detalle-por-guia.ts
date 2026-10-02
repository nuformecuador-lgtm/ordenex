import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";

import type { DetalleDeMovimientoLoteDTO } from "@/lib/types/detalle-en-lote";
import type {
  BloqueDeGuiaDTO,
  DetallePorGuiaDTO,
  FilaDeConceptoDTO,
  FilaSinGuiaDTO,
  MontoEnColumna,
  TotalesPorColumna,
} from "@/lib/types/libro-kardex";
import { totalesDe, totalesIguales } from "@/lib/utils/libro-kardex";

/**
 * Ficha 468 (design §4.2, R33–R46) — la hoja «Detalle por guía» AGRUPADA, armada en el SERVIDOR sobre el
 * detalle en lote de la 464 (que ya trae, por movimiento, sus ordenes con su aporte re-derivado).
 *
 * PURO y money-safe. No hay formula de dinero nueva: los aportes vienen ya calculados por
 * `aporteDeOrden`; aqui se COLOCAN en la columna de su movimiento, se SUMAN por bloque y en total, y lo
 * que le falte a un movimiento para llegar a su importe sale como «Diferencia sin repartir» (una
 * conciliacion: lo que falta para llegar a un monto que ya esta en el libro).
 *
 * LA INVARIANTE R45 SE AFIRMA AQUI: el TOTAL GENERAL tiene que ser igual al «Total del periodo» de la hoja
 * 1, columna a columna. Se cumple por construccion (cada centimo de cada movimiento esta en sus filas de
 * concepto, en su diferencia o en su fila sin guia); si alguien rompe la construccion, se LANZA y no sale
 * un archivo descuadrado.
 */

interface Entrada {
  /** Los movimientos de la hoja 1, EN SU ORDEN, con su importe ya colocado en su columna. */
  movimientos: ReadonlyArray<{ id: string; monto: MontoEnColumna }>;
  /** El detalle en lote de ESOS movimientos (cualquier orden; se cruza por `movimientoId`). */
  detalle: readonly DetalleDeMovimientoLoteDTO[];
  /** El «Total del periodo» de la hoja 1 (`kardex.totales`). */
  totalesHoja1: TotalesPorColumna;
}

interface FilaInterna extends FilaDeConceptoDTO {
  indice: number;
}

interface CierreDelBloque {
  fecha: string;
  resultados: GestionResultado[];
  remision: string;
  destinatario: string;
  tiendaNombre: string | null;
  mensajeroNombre: string | null;
}

interface BloqueInterno {
  guia: string | null;
  filas: FilaInterna[];
  cierres: Map<string, CierreDelBloque>;
}

/**
 * R37 — el orden de los bloques: las guias son numeros en TEXTO y se comparan sin `Number` (por longitud
 * y despues lexicograficamente: «9» < «10»). Las ordenes sin guia van detras, por remision.
 */
function compararBloques(a: BloqueDeGuiaDTO, b: BloqueDeGuiaDTO): number {
  if (a.guia !== null && b.guia !== null) {
    if (a.guia.length !== b.guia.length) return a.guia.length - b.guia.length;
    return a.guia < b.guia ? -1 : a.guia > b.guia ? 1 : 0;
  }
  if (a.guia !== null) return -1;
  if (b.guia !== null) return 1;
  return a.remision < b.remision ? -1 : a.remision > b.remision ? 1 : 0;
}

export function agruparPorGuia({ movimientos, detalle, totalesHoja1 }: Entrada): DetallePorGuiaDTO {
  const conCobrado = totalesHoja1.cobradoATiendas !== null;
  const detallePorId = new Map(detalle.map((d) => [d.movimientoId, d]));
  const bloques = new Map<string, BloqueInterno>();
  const sinGuia: FilaSinGuiaDTO[] = [];

  for (const [indice, mov] of movimientos.entries()) {
    const d = detallePorId.get(mov.id);
    if (d === undefined) throw new Error("detalle por guia: un movimiento de la hoja no tiene detalle");

    // R40/R43/R46 — no repartible: exactamente una fila, con su monto en su columna.
    if (d.modo === "sin_reparto") {
      sinGuia.push({ tipo: "movimiento", movimientoId: mov.id, motivo: d.motivo, monto: mov.monto });
      continue;
    }

    // R35 — el aporte va en la MISMA columna del movimiento. Un reverso de cargo (negativo en
    // «Cobrado a tiendas») niega sus aportes: hoy ninguno es repartible, y la regla queda escrita igual.
    const montoMovimiento = new Prisma.Decimal(mov.monto.monto);
    const negar = montoMovimiento.isNegative();
    let sumaEnColumna = new Prisma.Decimal(0);
    for (const o of d.ordenes) {
      const aporte = negar ? new Prisma.Decimal(o.aporte).neg() : new Prisma.Decimal(o.aporte);
      sumaEnColumna = sumaEnColumna.plus(aporte);
      const clave = o.guia ?? `sin-guia:${o.clave}`;
      let bloque = bloques.get(clave);
      if (bloque === undefined) {
        bloque = { guia: o.guia, filas: [], cierres: new Map() };
        bloques.set(clave, bloque);
      }
      bloque.filas.push({
        movimientoId: mov.id,
        cierreFecha: d.cierre.fecha,
        resultados: o.resultados,
        monto: { columna: mov.monto.columna, monto: aporte.toFixed(2) },
        indice,
      });
      if (!bloque.cierres.has(d.cierre.fecha)) {
        bloque.cierres.set(d.cierre.fecha, {
          fecha: d.cierre.fecha,
          resultados: o.resultados,
          remision: o.remision,
          destinatario: o.destinatario,
          tiendaNombre: o.tiendaNombre,
          mensajeroNombre: d.cierre.mensajeroNombre,
        });
      }
    }

    // R41/R42 — lo que les falta a las guias para llegar al importe del movimiento (o el importe entero
    // si ninguna guia aporta), en la columna del movimiento.
    const diferencia = montoMovimiento.minus(sumaEnColumna);
    if (!diferencia.isZero()) {
      sinGuia.push({
        tipo: "diferencia",
        movimientoId: mov.id,
        cierreFecha: d.cierre.fecha,
        montoMovimiento: montoMovimiento.toFixed(2),
        sumaGuias: sumaEnColumna.toFixed(2),
        monto: { columna: mov.monto.columna, monto: diferencia.toFixed(2) },
      });
    }
  }

  const salida: BloqueDeGuiaDTO[] = [...bloques.values()].map((b) => {
    // R38 — los cierres ascendentes; R39 — la cabecera con lo congelado en el MAS RECIENTE.
    const cierres = [...b.cierres.values()].sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0));
    const reciente = cierres[cierres.length - 1];
    // R37 — dentro del bloque, por dia del cierre y, a igual dia, en el orden de la hoja 1.
    const filas = [...b.filas].sort((x, y) =>
      x.cierreFecha < y.cierreFecha ? -1 : x.cierreFecha > y.cierreFecha ? 1 : x.indice - y.indice,
    );
    return {
      guia: b.guia,
      remision: reciente.remision,
      destinatario: reciente.destinatario,
      tiendaNombre: reciente.tiendaNombre,
      mensajeroNombre: reciente.mensajeroNombre,
      cierres: cierres.map((c) => c.fecha),
      resultados: cierres.flatMap((c) => c.resultados),
      filas: filas.map((f) => ({ movimientoId: f.movimientoId, cierreFecha: f.cierreFecha, resultados: f.resultados, monto: f.monto })),
      // R36 — el total del bloque, columna a columna.
      total: totalesDe(
        filas.map((f) => f.monto),
        conCobrado,
      ),
    };
  });
  salida.sort(compararBloques);

  // R44 — el TOTAL GENERAL: filas de concepto + «Movimientos sin guía» + diferencias. Los «Total de la
  // guía» NO entran (serian doble conteo).
  const totalGeneral = totalesDe(
    [...salida.flatMap((b) => b.filas.map((f) => f.monto)), ...sinGuia.map((f) => f.monto)],
    conCobrado,
  );

  // R45 — la invariante, afirmada.
  if (!totalesIguales(totalGeneral, totalesHoja1)) {
    throw new Error(
      `detalle por guia: el TOTAL GENERAL no es el de la hoja de movimientos — ${JSON.stringify(totalGeneral)} frente a ${JSON.stringify(totalesHoja1)}`,
    );
  }

  return { bloques: salida, sinGuia, totalGeneral };
}
