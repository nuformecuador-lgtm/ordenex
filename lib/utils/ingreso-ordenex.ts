import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type {
  IngresoOrdenexDTO,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
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
 * - `tarifa === null` (tienda sin tarifa vigente) -> todos los conceptos 0.00, sin lanzar (R9).
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
 * de la tienda de la orden. `tarifa === null` -> objeto vacio (todos 0.00 en el agregado, R9).
 */
export function derivarIngresoOrden(
  input: OrdenIngresoInput,
  tarifa: TarifaVigente | null,
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

/**
 * Feature 98 (design §3.2, R2/R7/R8/D1/D2) — costo del envio que la tienda paga por UNA orden
 * creada por la via API: FLETE + IVA del flete. Funcion PURA money-safe: toda la aritmetica
 * con `Prisma.Decimal`, salida STRING escala 2 (`ROUND_HALF_UP`), nunca number/parseFloat.
 *
 * Reutiliza EXACTAMENTE la seleccion de columna de `derivarIngresoOrden` (esCentral ->
 * variante GAM: `valorFleteGam`; si no `valorFlete`) y el mismo `aplicarPorcentaje(flete,
 * ivaFlete)` para el IVA del flete, para que "cuanto paga la tienda por una orden" se lea
 * IGUAL en el cierre (feature 42/69) y en la API. Si un dia divergieran, la misma plata se
 * leeria distinta.
 *
 * `tarifa === null` (tienda sin tarifa vigente) -> "0.00" (gap D1/R8): la orden se crea igual,
 * nunca `null`, nunca `error` por ausencia de tarifa.
 */
export function costoEnvioDeTarifa(tarifa: TarifaVigente | null, esCentral: boolean): string {
  if (tarifa === null) return "0.00"; // R8/D1: gap seguro, no bloquea la carga.
  const flete = new Prisma.Decimal(esCentral ? tarifa.valorFleteGam : tarifa.valorFlete);
  const ivaFlete = aplicarPorcentaje(flete, new Prisma.Decimal(tarifa.ivaFlete));
  return round2(flete.plus(ivaFlete)).toFixed(2); // D2: flete + IVA del flete.
}

/**
 * Feature 204 — los DOS importes derivados que el LISTADO de `/ordenes` muestra por fila:
 * "Flete + IVA" y "Comision + IVA". Salida STRING escala 2, money-safe.
 *
 * Existe porque hasta la 204 esas dos cifras se calculaban EN EL NAVEGADOR, sobre los
 * `number` de la tarifa, y NO daban lo mismo que el cierre. Medido contra las 66 ordenes
 * con tarifa activa de la base: 14 de ellas mostraban un centimo de mas o de menos.
 * Ejemplos reales (tarifa comisionCod 3.50%, ivaComisionCod 13.00%):
 *
 *   monto 14900.00 -> comision exacta 521.5; IVA exacto 67.795 -> HALF_UP -> 67.80 -> 589.30.
 *                     El navegador hacia 521.5 * 1.13, que en binario es
 *                     589.29499999999995907 (el medio exacto 589.295 no es representable) y
 *                     `toFixed(2)` bajaba a 589.29. UN CENTIMO DE MENOS.
 *   monto 16618.40 -> comision 581.644, que ESTA funcion redondea a 581.64 ANTES del IVA
 *                     (581.64 * 13% = 75.6132 -> 75.61) -> 657.25. El navegador aplicaba el
 *                     IVA a la comision SIN redondear (581.644 * 1.13 = 657.25772) y subia a
 *                     657.26. UN CENTIMO DE MAS. Y ese ni siquiera es un problema de binario:
 *                     es OTRA formula (un redondeo intermedio que el navegador no hacia).
 *
 * Por eso NO reimplementa nada: llama a `derivarIngresoOrden` con `resultado: "entregada"`,
 * que es lo que se le facturara a la tienda si la orden se entrega. Si un dia cambia la
 * formula del cierre, el listado cambia con ella; no pueden divergir por construccion.
 *
 * Los dos campos son SIEMPRE un STRING ("0.00" incluido), nunca `null`: la degradacion sin
 * tarifa vigente es cero, no "desconocido" (R9), que es lo que la columna ya mostraba.
 */
export interface CostosListadoOrden {
  fleteConIva: string; // flete (GAM o estandar segun zona) + su IVA; "0.00" sin tarifa
  comisionConIva: string; // comision COD + su IVA; "0.00" sin tarifa o si no cobra comision
}

/** Datos de la ORDEN que entran en las dos cifras (la tarifa va aparte). */
export interface CostosListadoOrdenInput {
  esCentral: boolean; // zona de la orden: elige la COLUMNA de flete (GAM vs estandar)
  montoCobrar: string | null; // COD a recaudar; null -> 0 (money-safe)
  cobraComision: boolean;
}

export function costosListadoOrden(
  tarifa: TarifaVigente | null,
  orden: CostosListadoOrdenInput,
): CostosListadoOrden {
  const derivado = derivarIngresoOrden({ resultado: "entregada", ...orden }, tarifa);
  // Un concepto ausente no aporta; los dos ausentes dan "0.00" (no `null`): esta columna
  // nunca dice "no aplica", dice cero.
  const conIva = (base?: Prisma.Decimal, iva?: Prisma.Decimal): string =>
    (base ?? new Prisma.Decimal(0)).plus(iva ?? 0).toFixed(2);
  return {
    fleteConIva: conIva(derivado.ingreso_flete, derivado.ingreso_iva_flete),
    comisionConIva: conIva(derivado.ingreso_comision_cod, derivado.ingreso_iva_comision_cod),
  };
}

/**
 * Suma el desglose por orden de un cierre en 1 total por concepto, para la vista de
 * auditoria del admin. NO es `agregarIngresosPorConcepto`: aquel emite movimientos de wallet
 * y OMITE los conceptos en 0.00 (R10); este emite SIEMPRE los 8 campos, porque una tabla de
 * auditoria con un concepto ausente y uno en cero no dicen lo mismo.
 *
 * Money-safe: suma con Prisma.Decimal sobre los STRING ya derivados, salida STRING escala 2.
 * Las gestiones sin desglose (vista en vivo, o cierre pre-snapshot) no aportan.
 */
export function totalesIngresoOrdenex(
  gestiones: Array<{ ingresoOrdenex?: IngresoOrdenexDTO | null }>,
): TotalesIngresoOrdenex {
  const acc = {
    montoCobrar: new Prisma.Decimal(0),
    fleteConIva: new Prisma.Decimal(0),
    fleteDevolucionConIva: new Prisma.Decimal(0),
    comisionConIva: new Prisma.Decimal(0),
    total: new Prisma.Decimal(0),
    flete: new Prisma.Decimal(0),
    ivaFlete: new Prisma.Decimal(0),
    fleteDevolucion: new Prisma.Decimal(0),
    ivaFleteDevolucion: new Prisma.Decimal(0),
    comisionCod: new Prisma.Decimal(0),
    ivaComisionCod: new Prisma.Decimal(0),
  };
  for (const g of gestiones) {
    const i = g.ingresoOrdenex;
    if (!i) continue;
    for (const k of Object.keys(acc) as Array<keyof typeof acc>) {
      const v = i[k];
      // `null` = el concepto no aplica a ese resultado; no aporta (no es un 0.00 real).
      if (v !== null && v !== undefined) acc[k] = acc[k].plus(v);
    }
  }
  return {
    montoCobrar: acc.montoCobrar.toFixed(2),
    fleteConIva: acc.fleteConIva.toFixed(2),
    fleteDevolucionConIva: acc.fleteDevolucionConIva.toFixed(2),
    comisionConIva: acc.comisionConIva.toFixed(2),
    total: acc.total.toFixed(2),
    flete: acc.flete.toFixed(2),
    ivaFlete: acc.ivaFlete.toFixed(2),
    fleteDevolucion: acc.fleteDevolucion.toFixed(2),
    ivaFleteDevolucion: acc.ivaFleteDevolucion.toFixed(2),
    comisionCod: acc.comisionCod.toFixed(2),
    ivaComisionCod: acc.ivaComisionCod.toFixed(2),
  };
}

/**
 * Ganancia de Ordenex: el ingreso BRUTO facturado menos lo que se le debe al mensajero.
 * Incluye los conceptos de devolucion (un rechazo tambien factura flete), asi que siempre
 * cuadra con el `total` del desglose. Puede ser NEGATIVA: un cierre de puras
 * reprogramaciones no factura nada y aun asi paga.
 *
 * Vive aca, y no duplicada en cada service, porque los dos detalles de admin (cierre de
 * mensajero y cierre de bodega) muestran el MISMO numero: si un dia divergieran, la misma
 * plata se leeria distinta segun por que pantalla se entra.
 *
 * Money-safe: resta con Prisma.Decimal sobre STRING, salida STRING escala 2.
 */
export function gananciaOrdenex(ingresoTotal: string, pagoMensajero: string): string {
  return new Prisma.Decimal(ingresoTotal).minus(pagoMensajero).toFixed(2);
}

/**
 * Pago a la tienda: la plata RECIBIDA (total general del cierre) menos los dos conceptos que
 * Ordenex le factura sobre esa plata — flete + IVA y comision + IVA.
 *
 * NO descuenta el flete de devolucion + IVA: una devolucion no cobra COD, asi que no aporta
 * al total general y no se le resta a lo recibido. Si un dia hay que cobrarlo tambien, se
 * cambia ACA y las dos pantallas de admin lo reflejan a la vez.
 *
 * Puede ser NEGATIVO si lo facturado supera lo recibido (p.ej. un cierre de puras
 * devoluciones con algo de efectivo suelto).
 *
 * Money-safe: resta con Prisma.Decimal sobre STRING, salida STRING escala 2.
 */
export function pagoTiendaOrdenex(
  totalGeneral: string,
  fleteConIva: string,
  comisionConIva: string,
): string {
  return new Prisma.Decimal(totalGeneral).minus(fleteConIva).minus(comisionConIva).toFixed(2);
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
 * resolviendo la tarifa de cada gestion por la TIENDA de su orden (feature 69/R20); la zona
 * solo elige la COLUMNA (`esCentral` -> variante GAM), sin cambio de formula (R21).
 * OMITE los conceptos cuyo total sea "0.00". Money-safe: suma con Prisma.Decimal, salida STRING.
 *
 * `gestiones` ya trae, por cada una, su input derivado y la tarifa vigente resuelta de su zona.
 */
export function agregarIngresosPorConcepto(
  gestiones: Array<{ input: OrdenIngresoInput; tarifa: TarifaVigente | null }>,
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
