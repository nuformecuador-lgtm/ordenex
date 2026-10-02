/**
 * FICHA 464 (design §5.2; R2, R26, R28–R31) — la hoja «Detalle por orden» del estado de cuenta de UNA
 * tienda, visto desde la oficina.
 *
 * Módulo PURO (sin React ni DOM). Sin columna «Tienda»: todas las órdenes son de esta tienda (el
 * servidor lo acota, R34). Con «Mensajero»: la oficina sí lo ve, como en el detalle de la fila.
 *
 * El motivo sin reparto es el MISMO texto del panel que despliega la fila en esta pantalla
 * (`DetalleMovimientoCierre` con la fuente de la cuenta, que pinta `DETALLE_MOVIMIENTO_SIN_REPARTO`).
 */
import type { DetalleDeLaDescarga } from "@/components/shared/estado-cuenta/EstadoCuenta";
import type { EntradaFilaDetalle } from "@/components/shared/descarga-con-detalle";
import { DETALLE_POR_ORDEN_COMUN } from "@/components/shared/wallet/detalle-por-orden-descarga";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

import { DETALLE_MOVIMIENTO_SIN_REPARTO, resultadosTexto } from "../../_components/detalle-movimiento-labels";

/** R2 — ámbito PROPIO de la hoja de detalle del estado de cuenta de una tienda. */
export const AMBITO_DESCARGA_WALLET_TIENDA_DETALLE = "wallet-tienda-detalle-orden";

/**
 * R26 — catálogo ELEGIBLE de la hoja de detalle, en este orden («N.º» va delante y es FIJA, R17). La
 * enumeración es CONTRATO y se fija con un `toEqual` escrito a mano.
 */
export const COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_TIENDA: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "movimiento", encabezado: "Movimiento" },
  { clave: "cierre", encabezado: "Cierre del" },
  { clave: "mensajero", encabezado: "Mensajero" },
  { clave: "guia", encabezado: "Guía" },
  { clave: "remision", encabezado: "Remisión" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "resultado", encabezado: "Resultado" },
  { clave: "monto", encabezado: "Monto" },
];

/**
 * Proyecta UNA orden de un movimiento de la tienda a una fila de la hoja de detalle. «Fecha» y
 * «Movimiento» son las celdas de la fila de su movimiento (R28); lo demás, lo congelado en el cierre
 * (R29); el monto, el STRING del servidor (R31); ningún identificador (R30).
 */
export function filaDetallePorOrdenTienda({ fila, cierre, orden }: EntradaFilaDetalle): DescargaFila {
  return {
    fecha: fila.fecha ?? null,
    movimiento: fila.movimiento ?? null,
    cierre: fechaDiaMovimientoCR(cierre.fecha),
    mensajero: cierre.mensajeroNombre,
    guia: orden.guia,
    remision: orden.remision,
    destinatario: orden.destinatario,
    resultado: resultadosTexto(orden.resultados),
    monto: orden.aporte, // STRING tal cual (money-safe)
  };
}

/** La hoja de detalle del estado de cuenta de una tienda (oficina), lista para `EstadoCuenta`. */
export const DETALLE_DESCARGA_WALLET_TIENDA: DetalleDeLaDescarga = {
  hoja: {
    ...DETALLE_POR_ORDEN_COMUN,
    columnas: COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_TIENDA,
    ambitoColumnas: AMBITO_DESCARGA_WALLET_TIENDA_DETALLE,
  },
  filaDetalleDe: filaDetallePorOrdenTienda,
  sinReparto: DETALLE_MOVIMIENTO_SIN_REPARTO,
};
