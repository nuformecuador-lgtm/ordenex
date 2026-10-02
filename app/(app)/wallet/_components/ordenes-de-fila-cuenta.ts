import type { DescargaFilasResult } from "@/components/shared/DataTable";
import { SUFIJO_REINTENTO, filasLocales, mensajeLimite } from "@/components/shared/descarga-resultado";
import { verOrdenesDeFilaAction } from "@/lib/actions/estado-cuenta";
import { descargaConfig } from "@/lib/config/descarga";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";

import type { FuenteDetalleMovimiento, VistaDetalle } from "./DetalleMovimientoCierre";
import { filaDescargaDetalleMovimiento } from "./detalle-movimiento-descarga-columnas";
import { DETALLE_MOVIMIENTO_ERROR, DETALLE_MOVIMIENTO_SIN_REPARTO } from "./detalle-movimiento-labels";

// FICHA 458-D (R19, 344/345) — LAS ÓRDENES DE UNA FILA DE CIERRE del estado de cuenta de una tienda o
// de un mensajero, en la oficina. Es la FUENTE del mismo panel de la ficha 344
// (`DetalleMovimientoCierre`): cambia la lectura (`verOrdenesDeFilaAction`, con la cuenta de la
// página y el movimiento de la fila), no lo que se ve.
//
// La cuenta y el movimiento viajan como ids y no se pintan (H6); el servidor lee el movimiento CON la
// cuenta en el `WHERE` (uno de otra cuenta = inexistente) y, en la tienda, solo SUS órdenes. FICHA 468
// (R27/R28): en el mensajero, el pago devengado lista sus órdenes (con su tienda); el pago tomado del
// efectivo de un cierre no se reparte por guía y el panel lo dice en palabras, con el enlace a SU cierre
// en el origen de la fila.

export type CuentaConOrdenes = { tipo: "tienda" | "mensajero"; id: string };

/** Prefijo de la clave SWR: otra lectura, otra caché (el libro de la caja usa la suya). */
export const CLAVE_ORDENES_DE_FILA = "estado-cuenta:ordenes-de-fila";

async function leerPagina(cuenta: CuentaConOrdenes, movimientoId: string, page: number, pageSize?: number) {
  return verOrdenesDeFilaAction({ cuenta, movimientoId, page, ...(pageSize === undefined ? {} : { pageSize }) });
}

/**
 * R32 del detalle (344) — el archivo son TODAS las órdenes de la fila: se leen las páginas del mismo
 * borde con el tope de página del servidor, y por encima del tope de las descargas no hay archivo
 * (nunca uno al que le falten filas).
 */
async function descargar(cuenta: CuentaConOrdenes, movimientoId: string): Promise<DescargaFilasResult> {
  const tamano = detalleMovimientoConfig.MAX_PAGE_SIZE;
  try {
    const primera = await leerPagina(cuenta, movimientoId, 1, tamano);
    if (primera.status === "sin_reparto") {
      return { status: "error", mensaje: DETALLE_MOVIMIENTO_SIN_REPARTO[primera.motivo] };
    }
    if (primera.status !== "ok") throw new Error(primera.status);
    const { total } = primera.data;
    if (total > descargaConfig.MAX_FILAS) {
      return { status: "error", mensaje: mensajeLimite(total, descargaConfig.MAX_FILAS) };
    }
    const ordenes: OrdenAporteDTO[] = [...primera.data.ordenes];
    for (let page = 2; ordenes.length < total; page += 1) {
      const r = await leerPagina(cuenta, movimientoId, page, tamano);
      if (r.status !== "ok") throw new Error(r.status);
      if (r.data.ordenes.length === 0) break;
      ordenes.push(...r.data.ordenes);
    }
    // El resultado lo arma el adaptador común (tope único de la app, R26/R28): nunca a mano.
    return filasLocales(ordenes, filaDescargaDetalleMovimiento);
  } catch {
    return { status: "error", mensaje: `${DETALLE_MOVIMIENTO_ERROR} ${SUFIJO_REINTENTO}` };
  }
}

/** La fuente del panel para las filas de cierre de ESTA cuenta. */
export function fuenteOrdenesDeFila(cuenta: CuentaConOrdenes): FuenteDetalleMovimiento {
  return {
    clave: `${CLAVE_ORDENES_DE_FILA}:${cuenta.tipo}`,
    leer: async (movimientoId, page): Promise<VistaDetalle> => {
      const r = await leerPagina(cuenta, movimientoId, page);
      if (r.status === "sin_reparto") return { modo: "sin_reparto", motivo: r.motivo };
      if (r.status !== "ok") throw new Error(r.status);
      return { modo: "ok", data: r.data };
    },
    descargar: (movimientoId) => descargar(cuenta, movimientoId),
  };
}
