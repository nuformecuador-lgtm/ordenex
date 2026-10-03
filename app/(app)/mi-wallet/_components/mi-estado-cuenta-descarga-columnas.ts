/**
 * FICHA 464 → 468 (design §7.1; R24, R32, R49, R51) — la hoja «Detalle por guía» de `/mi-wallet`, vista
 * por la propia tienda.
 *
 * Módulo PURO (sin React ni DOM). Sin «Tienda» (todas son suyas, R48) y SIN «Mensajero»: a la tienda no
 * se le revela quién de Ordenex movió el cierre (R49; el servidor además manda `null`). El resultado de
 * cada gestión, con la MISMA etiqueta del panel de esta pantalla (`resultadosTexto` de `/mi-wallet`).
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

import { resultadosTexto } from "./detalle-mi-movimiento-labels";

/** Ámbito PROPIO de la hoja de detalle de `/mi-wallet` (se conserva el de la 464, R52). */
export const AMBITO_DESCARGA_MI_WALLET_DETALLE = "mi-wallet-detalle-orden";

/** R32 — la hoja «Detalle por guía» de `/mi-wallet`, en este orden (CONTRATO, `toEqual` a mano). */
export const COLUMNAS_DESCARGA_DETALLE_GUIA_MI_WALLET: DescargaColumna[] = [
  COLUMNA_LIBRO.guia,
  COLUMNA_LIBRO.remision,
  COLUMNA_LIBRO.destinatario,
  COLUMNA_LIBRO.cierre,
  COLUMNA_LIBRO.resultado,
  COLUMNA_LIBRO.concepto,
  COLUMNA_LIBRO.detalle,
  COLUMNA_LIBRO.entra,
  COLUMNA_LIBRO.sale,
];

/**
 * R34/R49 — la fila de cabecera de un bloque de guía, con la etiqueta de resultados del panel de
 * `/mi-wallet`. «Mensajero» no se declara en esta hoja, así que no sale (y el servidor manda `null`).
 */
export function filaCabeceraGuiaMiWallet(bloque: BloqueDeGuiaDTO): DescargaFila {
  return filaCabeceraDeGuia(bloque, resultadosTexto);
}

/** La hoja de detalle de `/mi-wallet`, lista para `EstadoCuenta`. */
export const DETALLE_DESCARGA_MI_WALLET: DetalleDeLaDescarga = {
  cabeceraDe: filaCabeceraGuiaMiWallet,
  hoja: {
    titulo: LIBRO_KARDEX_HOJAS.detalle,
    etiquetaOpcion: LIBRO_KARDEX_HOJAS.conDetalle,
    etiquetaSinDetalle: LIBRO_KARDEX_HOJAS.sinDetalle,
    columnas: COLUMNAS_DESCARGA_DETALLE_GUIA_MI_WALLET,
    columnasFijas: FIJAS_DETALLE_POR_GUIA,
    ambitoColumnas: AMBITO_DESCARGA_MI_WALLET_DETALLE,
  },
  resultadosTexto,
};
