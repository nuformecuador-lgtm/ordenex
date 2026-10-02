/**
 * FICHA 464 → 468 (design §7.1; R24, R30, R51) — la hoja «Detalle por guía» del estado de cuenta de UNA
 * tienda, visto desde la oficina.
 *
 * Módulo PURO (sin React ni DOM). Sin columna «Tienda»: todas las guías son de esta tienda (el servidor
 * lo acota, R48). Con «Mensajero»: la oficina sí lo ve, como en el detalle de la fila. Las filas las
 * coloca `filasDetallePorGuia` (agrupadas por guía); el resultado de cada gestión, con la MISMA etiqueta
 * que el panel de la fila (`resultadosTexto`).
 */
import type { DetalleDeLaDescarga } from "@/components/shared/estado-cuenta/EstadoCuenta";
import {
  COLUMNA_LIBRO,
  FIJAS_DETALLE_POR_GUIA,
  LIBRO_KARDEX_HOJAS,
} from "@/components/shared/wallet/libro-kardex-labels";
import { filaCabeceraDeGuia } from "@/components/shared/wallet/libro-kardex-descarga";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { BloqueDeGuiaDTO } from "@/lib/types/libro-kardex";

import { resultadosTexto } from "../../_components/detalle-movimiento-labels";

/** Ámbito PROPIO de la hoja de detalle del estado de cuenta de una tienda (se conserva el de la 464, R52). */
export const AMBITO_DESCARGA_WALLET_TIENDA_DETALLE = "wallet-tienda-detalle-orden";

/** R30 — la hoja «Detalle por guía» de la tienda, en este orden (CONTRATO, `toEqual` a mano). */
export const COLUMNAS_DESCARGA_DETALLE_GUIA_TIENDA: DescargaColumna[] = [
  COLUMNA_LIBRO.guia,
  COLUMNA_LIBRO.remision,
  COLUMNA_LIBRO.destinatario,
  COLUMNA_LIBRO.mensajero,
  COLUMNA_LIBRO.cierre,
  COLUMNA_LIBRO.resultado,
  COLUMNA_LIBRO.concepto,
  COLUMNA_LIBRO.detalle,
  COLUMNA_LIBRO.entra,
  COLUMNA_LIBRO.sale,
];

/** R34/R39 — la fila de cabecera de un bloque de guía, con la etiqueta de resultados del panel de la oficina. */
export function filaCabeceraGuiaTienda(bloque: BloqueDeGuiaDTO): DescargaFila {
  return filaCabeceraDeGuia(bloque, resultadosTexto);
}

/** La hoja de detalle del estado de cuenta de una tienda (oficina), lista para `EstadoCuenta`. */
export const DETALLE_DESCARGA_WALLET_TIENDA: DetalleDeLaDescarga = {
  cabeceraDe: filaCabeceraGuiaTienda,
  hoja: {
    titulo: LIBRO_KARDEX_HOJAS.detalle,
    etiquetaOpcion: LIBRO_KARDEX_HOJAS.conDetalle,
    etiquetaSinDetalle: LIBRO_KARDEX_HOJAS.sinDetalle,
    columnas: COLUMNAS_DESCARGA_DETALLE_GUIA_TIENDA,
    columnasFijas: FIJAS_DETALLE_POR_GUIA,
    ambitoColumnas: AMBITO_DESCARGA_WALLET_TIENDA_DETALLE,
  },
  resultadosTexto,
};
