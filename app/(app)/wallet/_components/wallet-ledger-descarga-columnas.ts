/**
 * Feature 170 (T C.3, design §3/§7) — columnas de EXPORT del libro de movimientos de la
 * caja principal.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<WalletMovimientoDTO>` de
 * `WalletLedger`, cuyo `render` devuelve insignias y un botón de reversa (R7).
 *
 * Lo que NO sale: `id` y `origenId` (uuid internos, R23) y `registradoPor` (uuid de un
 * usuario, que además la tabla no muestra — R23/R24).
 *
 * FICHA 458-E (R3, R55–R57) — «A quién» y «Registró» salen de la MISMA autoría que pinta la tabla
 * (`autoriaDelLibroCajaAction`, pedida por el módulo) y con los MISMOS textos: nombres, nunca ids.
 *
 * FICHA 468 (design §7.1; R1, R4, R17–R21, R29, R51) — la hoja «Movimientos» pasa a ser un KARDEX:
 * Fecha · Concepto · Detalle · A quién · Es dinero de · Entra · Sale · Cobrado a tiendas · Saldo ·
 * Registró. Fuera «Movimiento», «Motivo y origen», «Entra o sale», «Monto» y «Dueño» (R4): el sentido
 * lo dice la columna donde va el importe, que la decide el SERVIDOR (`kardex.filas[i].monto`), y el
 * dueño se llama «Es dinero de» con las MISMAS palabras de la tabla (`DUENO_LABEL`, R21). Los montos y
 * el saldo los coloca `filasKardex`; aquí solo va lo que no es dinero. La hoja 2 es «Detalle por guía»
 * (R29), agrupada por `filasDetallePorGuia`.
 */
import type { DataTableDescargaDetalle } from "@/components/shared/DataTable";
import { textoRegistro } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import { filaCabeceraDeGuia } from "@/components/shared/wallet/libro-kardex-descarga";
import {
  COLUMNA_LIBRO,
  FIJAS_DETALLE_POR_GUIA,
  FIJAS_MOVIMIENTOS,
  LIBRO_KARDEX_HOJAS,
} from "@/components/shared/wallet/libro-kardex-labels";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
import type { BloqueDeGuiaDTO } from "@/lib/types/libro-kardex";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

import { resultadosTexto } from "./detalle-movimiento-labels";
import { conceptoDeCaja, detalleDeCaja, fechaDeCaja } from "./libro-caja-kardex";
import { AUTORIA_CELDA, textoAQuien } from "./libro-caja-labels";
import { DUENO_LABEL } from "./wallet-labels";

/**
 * R1 — la hoja «Movimientos» de la caja, en este orden. La enumeración es CONTRATO y se fija con un
 * `toEqual` escrito a mano. Ninguna es un identificador.
 */
export const COLUMNAS_DESCARGA_WALLET_CAJA: DescargaColumna[] = [
  COLUMNA_LIBRO.fecha,
  COLUMNA_LIBRO.concepto,
  COLUMNA_LIBRO.detalle,
  COLUMNA_LIBRO.aQuien,
  COLUMNA_LIBRO.esDineroDe,
  COLUMNA_LIBRO.entra,
  COLUMNA_LIBRO.sale,
  COLUMNA_LIBRO.cobradoATiendas,
  COLUMNA_LIBRO.saldo,
  COLUMNA_LIBRO.registro,
];

/**
 * La fila de un movimiento de caja SIN montos ni saldo (los coloca `filasKardex` desde el kardex del
 * servidor). `autoria` es la de ESA fila, leída en lote; ausente ⇒ «—» en «A quién» y «Registró»
 * (nunca un id en su lugar). `ordenes` es el «N guía(s)» del kardex (ausente ⇒ no repartible). Los
 * textos salen de `libro-caja-kardex.ts`, los mismos que usa la hoja «Detalle por guía».
 */
export function filaBaseCaja(
  movimiento: WalletMovimientoDTO,
  autoria?: AutoriaDeFilaDTO,
  ordenes: number | null = null,
): DescargaFila {
  return {
    fecha: fechaDeCaja(movimiento),
    concepto: conceptoDeCaja(movimiento),
    detalle: detalleDeCaja(movimiento, ordenes),
    aQuien: autoria === undefined ? AUTORIA_CELDA.sinDato : textoAQuien(autoria.aQuien),
    // R21 / Feature 231 (R34): el MISMO texto que muestra la tabla; el dueño lo derivó el servidor.
    esDineroDe: DUENO_LABEL[movimiento.dueno] ?? movimiento.dueno,
    registro: autoria === undefined ? AUTORIA_CELDA.sinDato : textoRegistro(autoria.registro),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FICHA 464 → 468 — el selector de columnas y la hoja «Detalle por guía».
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ámbito de la preferencia de columnas de la hoja de movimientos de la caja. Se CONSERVA el de la 464:
 * la preferencia descarta las claves que ya no existen y las nuevas salen marcadas (R52).
 */
export const AMBITO_DESCARGA_WALLET_CAJA = "wallet-caja-libro";

/** Ámbito PROPIO de la hoja de detalle de la caja (se conserva el de la 464, R52). */
export const AMBITO_DESCARGA_WALLET_CAJA_DETALLE = "wallet-caja-detalle-orden";

/** R29 — la hoja «Detalle por guía» de la caja, en este orden (CONTRATO, `toEqual` a mano). */
export const COLUMNAS_DESCARGA_DETALLE_GUIA_CAJA: DescargaColumna[] = [
  COLUMNA_LIBRO.guia,
  COLUMNA_LIBRO.remision,
  COLUMNA_LIBRO.destinatario,
  COLUMNA_LIBRO.tienda,
  COLUMNA_LIBRO.mensajero,
  COLUMNA_LIBRO.cierre,
  COLUMNA_LIBRO.resultado,
  COLUMNA_LIBRO.concepto,
  COLUMNA_LIBRO.detalle,
  COLUMNA_LIBRO.entra,
  COLUMNA_LIBRO.sale,
  COLUMNA_LIBRO.cobradoATiendas,
];

/** R34/R39 — la fila de cabecera de un bloque de guía de la caja (con tienda y mensajero del cierre). */
export function filaCabeceraGuiaCaja(bloque: BloqueDeGuiaDTO): DescargaFila {
  return filaCabeceraDeGuia(bloque, resultadosTexto);
}

/** R51 — las columnas de la hoja «Movimientos» que no se pueden desmarcar. */
export const FIJAS_DESCARGA_WALLET_CAJA = FIJAS_MOVIMIENTOS;

/** La hoja de detalle de la caja, tal como la recibe el control de descarga (R24, R51). */
export const DETALLE_DESCARGA_WALLET_CAJA: DataTableDescargaDetalle = {
  titulo: LIBRO_KARDEX_HOJAS.detalle,
  etiquetaOpcion: LIBRO_KARDEX_HOJAS.conDetalle,
  etiquetaSinDetalle: LIBRO_KARDEX_HOJAS.sinDetalle,
  columnas: COLUMNAS_DESCARGA_DETALLE_GUIA_CAJA,
  columnasFijas: FIJAS_DETALLE_POR_GUIA,
  ambitoColumnas: AMBITO_DESCARGA_WALLET_CAJA_DETALLE,
};
