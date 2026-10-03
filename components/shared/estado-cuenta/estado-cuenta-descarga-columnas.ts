/**
 * FICHA 458-D (T D.6, design §3.2; R3, R32) — columnas de EXPORT del estado de cuenta de una tienda, un
 * mensajero o una bodega satélite.
 *
 * Módulo PURO (sin React ni DOM). Ninguna columna de identificador (R3): la fila del servidor lleva `ref`
 * y `consolidacionId`, que viajan y nunca se pintan ni se descargan.
 *
 * FICHA 468 (design §7.1; R2, R3, R4, R17, R18, R51) — la hoja «Movimientos» pasa a ser un KARDEX:
 * Fecha · Concepto · Detalle · Entra · Sale · Saldo · Registró (sin «Registró» en `/mi-wallet`, R3/R49).
 * Fuera «Movimiento», «Motivo», «Origen», «Cómo se pagó», «Cargo», «Abono» y «Estado» (R4): el motivo,
 * el origen, el pago, el «N guía(s)» y la anulación van juntos en «Detalle» (R18), y el importe va en
 * «Entra» o «Sale» según lo decidió el SERVIDOR (`kardex.filas[i].monto`, R9). Los montos, el saldo
 * corrido y las filas del saldo inicial y del total los coloca `filasKardex`; aquí solo va lo que no es
 * dinero, leído con las MISMAS funciones que pinta la tabla (`estado-cuenta-lineas.ts`).
 */
import { textoDetalle, textoGuias } from "@/components/shared/wallet/libro-kardex-descarga";
import { COLUMNA_LIBRO, FIJAS_MOVIMIENTOS } from "@/components/shared/wallet/libro-kardex-labels";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

/** Una línea del extracto tal como se ve EN PANTALLA: la del saldo inicial o la de un movimiento. */
export interface LineaEstadoCuenta {
  fecha: string;
  movimiento: string;
  motivo: string | null;
  origen: string | null;
  /** FICHA 458-D — el método y la referencia del pago de la fila, en palabras; `null` si no es un pago. */
  pago: string | null;
  registro: string | null;
  cargo: string | null;
  abono: string | null;
  saldo: string;
  /** «Anulado el … por … · motivo», «Anulación», o `null` si está vigente. */
  estado: string | null;
}

/** R2 — la hoja «Movimientos» del estado de cuenta en la oficina (tienda, mensajero, bodega), en este orden. */
export const COLUMNAS_DESCARGA_ESTADO_CUENTA: DescargaColumna[] = [
  COLUMNA_LIBRO.fecha,
  COLUMNA_LIBRO.concepto,
  COLUMNA_LIBRO.detalle,
  COLUMNA_LIBRO.entra,
  COLUMNA_LIBRO.sale,
  COLUMNA_LIBRO.saldo,
  COLUMNA_LIBRO.registro,
];

/**
 * R3 — la hoja «Movimientos» de `/mi-wallet`: la misma SIN «Registró» (la tienda no ve los nombres de la
 * gente de Ordenex: el servidor no los manda y la pantalla no pinta esa línea, R49).
 */
export const COLUMNAS_DESCARGA_MI_ESTADO_CUENTA: DescargaColumna[] = [
  COLUMNA_LIBRO.fecha,
  COLUMNA_LIBRO.concepto,
  COLUMNA_LIBRO.detalle,
  COLUMNA_LIBRO.entra,
  COLUMNA_LIBRO.sale,
  COLUMNA_LIBRO.saldo,
];

/** R51 — Concepto, Entra, Sale y Saldo no se pueden desmarcar. */
export const FIJAS_DESCARGA_ESTADO_CUENTA = FIJAS_MOVIMIENTOS;

/**
 * FICHA 464 (R1/R2) — el ámbito del selector de columnas de la hoja de movimientos de CADA estado de
 * cuenta: uno por superficie, aunque compartan catálogo. Se CONSERVAN en la 468: la preferencia descarta
 * las claves que ya no existen y las columnas nuevas salen marcadas (R52).
 */
export const AMBITO_DESCARGA_ESTADO_CUENTA_TIENDA = "wallet-tienda-estado-cuenta";
export const AMBITO_DESCARGA_ESTADO_CUENTA_MENSAJERO = "wallet-mensajero-estado-cuenta";
export const AMBITO_DESCARGA_ESTADO_CUENTA_SATELITE = "wallet-satelite-estado-cuenta";
export const AMBITO_DESCARGA_MI_ESTADO_CUENTA = "mi-wallet-estado-cuenta";

/**
 * FICHA 468 (R17/R18) — proyecta UNA línea del extracto (la fila ya rotulada por la superficie, la MISMA
 * que pinta la tabla: `lineaDeFila`) a la fila de la hoja «Movimientos», SIN montos ni saldo (los coloca
 * `filasKardex` desde el kardex del servidor). «Detalle» junta con « · », en este orden y saltándose
 * las vacías, el origen, la descripción, la forma de pago, el «N guía(s)» (`ordenes`, del kardex) y el
 * estado de anulación. «Registró» sale si la hoja lo declara (en `/mi-wallet` no, R3/R49).
 */
export function filaBaseCuenta(linea: LineaEstadoCuenta, ordenes: number | null = null): DescargaFila {
  return {
    fecha: linea.fecha,
    concepto: linea.movimiento,
    detalle: textoDetalle([linea.origen, linea.motivo, linea.pago, textoGuias(ordenes), linea.estado]),
    registro: linea.registro,
  };
}
