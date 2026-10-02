/**
 * FICHA 468 (design §7.1; R24, R31, R43, R51) — la hoja «Detalle por guía» del estado de cuenta de UN
 * mensajero, visto desde la oficina. NUEVA: la 464 no daba detalle al mensajero (amplía su R7).
 *
 * Módulo PURO (sin React ni DOM). Con «Tienda» (las guías del mensajero son de varias tiendas) y SIN
 * «Mensajero» (es su propia cuenta). El pago devengado se reparte por guía; el pago tomado del efectivo
 * no, y va en «Movimientos sin guía» (R43, lo decide el servidor). El resultado de cada gestión, con la
 * MISMA etiqueta del panel de la fila (`resultadosTexto`).
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

/** Ámbito PROPIO de la hoja de detalle del estado de cuenta de un mensajero (nuevo en la 468). */
export const AMBITO_DESCARGA_WALLET_MENSAJERO_DETALLE = "wallet-mensajero-detalle-guia";

/** R31 — la hoja «Detalle por guía» del mensajero, en este orden (CONTRATO, `toEqual` a mano). */
export const COLUMNAS_DESCARGA_DETALLE_GUIA_MENSAJERO: DescargaColumna[] = [
  COLUMNA_LIBRO.guia,
  COLUMNA_LIBRO.remision,
  COLUMNA_LIBRO.destinatario,
  COLUMNA_LIBRO.tienda,
  COLUMNA_LIBRO.cierre,
  COLUMNA_LIBRO.resultado,
  COLUMNA_LIBRO.concepto,
  COLUMNA_LIBRO.detalle,
  COLUMNA_LIBRO.entra,
  COLUMNA_LIBRO.sale,
];

/** R34/R39 — la fila de cabecera de un bloque de guía, con su tienda congelada en el cierre. */
export function filaCabeceraGuiaMensajero(bloque: BloqueDeGuiaDTO): DescargaFila {
  return filaCabeceraDeGuia(bloque, resultadosTexto);
}

/** La hoja de detalle del estado de cuenta de un mensajero (oficina), lista para `EstadoCuenta`. */
export const DETALLE_DESCARGA_WALLET_MENSAJERO: DetalleDeLaDescarga = {
  cabeceraDe: filaCabeceraGuiaMensajero,
  hoja: {
    titulo: LIBRO_KARDEX_HOJAS.detalle,
    etiquetaOpcion: LIBRO_KARDEX_HOJAS.conDetalle,
    etiquetaSinDetalle: LIBRO_KARDEX_HOJAS.sinDetalle,
    columnas: COLUMNAS_DESCARGA_DETALLE_GUIA_MENSAJERO,
    columnasFijas: FIJAS_DETALLE_POR_GUIA,
    ambitoColumnas: AMBITO_DESCARGA_WALLET_MENSAJERO_DETALLE,
  },
  resultadosTexto,
};
