import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";
import type { TarifaVigentePorZona } from "@/lib/interfaces/repositories/ITarifaVigentePorZonaRepository";
import type { WalletIngresoConcepto } from "@/lib/types/wallet";

/**
 * Feature 42 (design §4, R8/R9/R26) — derivacion del INGRESO de Ordenex por gestion.
 * Funcion PURA, money-safe: toda la aritmetica con `Prisma.Decimal`, salida STRING escala 2.
 * Espejo estructural de `lib/utils/pago-mensajero.ts`/`ingreso-bodega.ts`. La gestion aporta
 * su `resultado`; la orden aporta `esCentral` (zona), `montoCobrar` (COD) y `cobraComision`.
 *
 * Reglas F1.4 aprobadas:
 * - `entregada` -> flete (valorFleteGam si esCentral, si no valorFlete) + IVA del flete; y
 *   SOLO si `cobraComision === true`: comision COD (% de montoCobrar) + su IVA. Si
 *   `cobraComision === false`, comision y su IVA quedan AUSENTES (no "0.00" forzado).
 * - `devuelta`|`rechazada` -> flete de DEVOLUCION (valorFleteDevueltoGam si esCentral, si no
 *   valorFleteDevuelto) + su IVA (mismo % ivaFlete). SIN comision COD (no hubo recaudo).
 * - `reprogramada` (u otro en transito) -> no aporta a ningun concepto.
 * - `tarifa === null` (zona sin tarifa vigente) -> todos los conceptos 0.00, sin lanzar (R9).
 */

// Datos de la orden/gestion necesarios para derivar el ingreso (sin acoplar a Prisma models).
export interface OrdenIngresoInput {
  resultado: GestionResultado;
  esCentral: boolean;
  montoCobrar: string | null; // COD a recaudar; null -> 0 (money-safe)
  cobraComision: boolean;
}

// Conceptos derivados de UNA gestion. Los ausentes (undefined) NO aportan al agregado (a
// diferencia de un 0.00 explicito, que es un valor real que participa en la suma).
export interface IngresoOrdenDerivado {
  ingreso_flete?: Prisma.Decimal;
  ingreso_flete_devolucion?: Prisma.Decimal;
  ingreso_comision_cod?: Prisma.Decimal;
  ingreso_iva_flete?: Prisma.Decimal;
  ingreso_iva_flete_devolucion?: Prisma.Decimal;
  ingreso_iva_comision_cod?: Prisma.Decimal;
}

function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// porcentaje: valor 0..100 -> factor / 100. Money-safe con Prisma.Decimal.
function aplicarPorcentaje(base: Prisma.Decimal, porcentaje: Prisma.Decimal): Prisma.Decimal {
  return round2(base.mul(porcentaje).div(100));
}

/**
 * Deriva los conceptos de ingreso de UNA gestion segun su `resultado` y la tarifa vigente
 * de la zona de la orden. `tarifa === null` -> objeto vacio (todos 0.00 en el agregado, R9).
 */
export function derivarIngresoOrden(
  input: OrdenIngresoInput,
  tarifa: TarifaVigentePorZona | null,
): IngresoOrdenDerivado {
  if (tarifa === null) return {}; // R9: gap seguro, no bloquea; ningun concepto aporta.

  const ivaFletePct = new Prisma.Decimal(tarifa.ivaFlete);

  if (input.resultado === "entregada") {
    const flete = new Prisma.Decimal(input.esCentral ? tarifa.valorFleteGam : tarifa.valorFlete);
    const ivaFlete = aplicarPorcentaje(flete, ivaFletePct);
    const out: IngresoOrdenDerivado = {
      ingreso_flete: round2(flete),
      ingreso_iva_flete: ivaFlete,
    };
    // R8/R26: comision COD y su IVA SOLO si la orden cobra comision.
    if (input.cobraComision) {
      const montoCobrar = new Prisma.Decimal(input.montoCobrar ?? "0");
      const comision = aplicarPorcentaje(montoCobrar, new Prisma.Decimal(tarifa.comisionCod));
      out.ingreso_comision_cod = comision;
      out.ingreso_iva_comision_cod = aplicarPorcentaje(
        comision,
        new Prisma.Decimal(tarifa.ivaComisionCod),
      );
    }
    return out;
  }

  if (input.resultado === "devuelta" || input.resultado === "rechazada") {
    const fleteDev = new Prisma.Decimal(
      input.esCentral ? tarifa.valorFleteDevueltoGam : tarifa.valorFleteDevuelto,
    );
    return {
      ingreso_flete_devolucion: round2(fleteDev),
      ingreso_iva_flete_devolucion: aplicarPorcentaje(fleteDev, ivaFletePct),
    };
  }

  // reprogramada (u otro en transito): no aporta a ningun concepto.
  return {};
}

// Un concepto de ingreso a insertar (categoria + monto STRING). El feed OMITE los que
// tengan total "0.00" (R10).
export interface ConceptoIngresoAgregado {
  categoria: WalletIngresoConcepto;
  monto: string; // STRING 2 dec (money-safe)
}

// Orden de emision de los conceptos (design §4).
const CONCEPTOS: WalletIngresoConcepto[] = [
  "ingreso_flete",
  "ingreso_flete_devolucion",
  "ingreso_comision_cod",
  "ingreso_iva_flete",
  "ingreso_iva_flete_devolucion",
  "ingreso_iva_comision_cod",
];

/**
 * Agrega los conceptos de TODAS las gestiones de un cierre en 1 total por concepto (R10),
 * resolviendo la tarifa de cada gestion via `tarifaPorZona(esCentral, montoCobrar,...)`.
 * OMITE los conceptos cuyo total sea "0.00". Money-safe: suma con Prisma.Decimal, salida STRING.
 *
 * `gestiones` ya trae, por cada una, su input derivado y la tarifa vigente resuelta de su zona.
 */
export function agregarIngresosPorConcepto(
  gestiones: Array<{ input: OrdenIngresoInput; tarifa: TarifaVigentePorZona | null }>,
): ConceptoIngresoAgregado[] {
  const totales = new Map<WalletIngresoConcepto, Prisma.Decimal>();
  for (const c of CONCEPTOS) totales.set(c, new Prisma.Decimal(0));

  for (const g of gestiones) {
    const derivado = derivarIngresoOrden(g.input, g.tarifa);
    for (const c of CONCEPTOS) {
      const aporte = derivado[c];
      if (aporte !== undefined) {
        totales.set(c, totales.get(c)!.add(aporte));
      }
    }
  }

  const out: ConceptoIngresoAgregado[] = [];
  for (const c of CONCEPTOS) {
    const total = round2(totales.get(c)!);
    // R10: no se emite movimiento para un concepto con total 0.00.
    if (total.gt(0)) out.push({ categoria: c, monto: total.toFixed(2) });
  }
  return out;
}
