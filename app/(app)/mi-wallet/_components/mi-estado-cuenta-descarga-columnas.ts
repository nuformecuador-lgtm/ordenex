/**
 * FICHA 464 (design §5.2; R2, R5, R27–R31) — la hoja «Detalle por orden» de `/mi-wallet`, vista por la
 * propia tienda.
 *
 * Módulo PURO (sin React ni DOM). Sin «Tienda» (todas son suyas, R34) y SIN «Mensajero»: a la tienda no
 * se le revela quién de Ordenex movió el cierre (R5; el servidor además manda `null`).
 *
 * El motivo sin reparto es el MISMO texto del panel de esta pantalla (`DETALLE_MI_MOVIMIENTO_SIN_REPARTO`,
 * el que pinta `DetalleMiMovimientoCierre`), dicho desde la tienda.
 */
import type { DetalleDeLaDescarga } from "@/components/shared/estado-cuenta/EstadoCuenta";
import type { EntradaFilaDetalle } from "@/components/shared/descarga-con-detalle";
import { DETALLE_POR_ORDEN_COMUN } from "@/components/shared/wallet/detalle-por-orden-descarga";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

import { DETALLE_MI_MOVIMIENTO_SIN_REPARTO, resultadosTexto } from "./detalle-mi-movimiento-labels";

/** R2 — ámbito PROPIO de la hoja de detalle de `/mi-wallet`. */
export const AMBITO_DESCARGA_MI_WALLET_DETALLE = "mi-wallet-detalle-orden";

/**
 * R27 — catálogo ELEGIBLE de la hoja de detalle, en este orden («N.º» va delante y es FIJA, R17). La
 * enumeración es CONTRATO y se fija con un `toEqual` escrito a mano.
 */
export const COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_MI_WALLET: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "movimiento", encabezado: "Movimiento" },
  { clave: "cierre", encabezado: "Cierre del" },
  { clave: "guia", encabezado: "Guía" },
  { clave: "remision", encabezado: "Remisión" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "resultado", encabezado: "Resultado" },
  { clave: "monto", encabezado: "Monto" },
];

/**
 * Proyecta UNA orden de un movimiento de la tienda a una fila de la hoja de detalle. «Fecha» y
 * «Movimiento» son las celdas de la fila de su movimiento (R28); lo demás, lo congelado en el cierre
 * (R29); el monto, el STRING del servidor (R31). Ni identificadores (R30) ni el mensajero (R5).
 */
export function filaDetallePorOrdenMiWallet({ fila, cierre, orden }: EntradaFilaDetalle): DescargaFila {
  return {
    fecha: fila.fecha ?? null,
    movimiento: fila.movimiento ?? null,
    cierre: fechaDiaMovimientoCR(cierre.fecha),
    guia: orden.guia,
    remision: orden.remision,
    destinatario: orden.destinatario,
    resultado: resultadosTexto(orden.resultados),
    monto: orden.aporte, // STRING tal cual (money-safe)
  };
}

/** La hoja de detalle de `/mi-wallet`, lista para `EstadoCuenta`. */
export const DETALLE_DESCARGA_MI_WALLET: DetalleDeLaDescarga = {
  hoja: {
    ...DETALLE_POR_ORDEN_COMUN,
    columnas: COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_MI_WALLET,
    ambitoColumnas: AMBITO_DESCARGA_MI_WALLET_DETALLE,
  },
  filaDetalleDe: filaDetallePorOrdenMiWallet,
  sinReparto: DETALLE_MI_MOVIMIENTO_SIN_REPARTO,
};
