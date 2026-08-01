/**
 * Feature 170 (T C.3, design §3/§7) — columnas de EXPORT del desglose por cierre de UN
 * mensajero (vista de los roles de acceso total, `/wallet/mensajeros`).
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<…>` de
 * `DesglosePagosMensajero`, cuyo `render` devuelve una insignia de tipo (R7).
 *
 * MONEY-SAFE: el monto se emite como el STRING que llega del servidor, TAL CUAL. Sin
 * `parseFloat`/`Number` (un `Decimal(10,2)` largo no cabe exacto en un `number`) y sin el
 * símbolo de colón, que es presentación y rompería la celda como número.
 *
 * Lo que NO sale: `id`, `origenId` y `mensajeroId` (uuid internos, R23; el `mensajeroId`
 * además es el mismo para todo el archivo — es el desglose de UNA persona) ni
 * `registradoPor`. El NOMBRE del mensajero tampoco es columna: identifica al archivo entero,
 * no a la fila, y su sitio es el título de la descarga (R12/R13), que cablea el frontend.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import { CATEGORIA_PAGO_LABEL, DESGLOSE_COLUMNAS, ORIGEN_PAGO_LABEL, TIPO_PAGO_LABEL } from "./wallet-mensajeros-labels";

/**
 * Columnas emitidas por la descarga del desglose, en su orden de pantalla. Los encabezados
 * salen de `DESGLOSE_COLUMNAS`, el MISMO objeto del que la tabla saca los suyos: así el
 * archivo no puede acabar con una cabecera distinta de la que se ve.
 */
export const COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO: DescargaColumna[] = [
  { clave: "fecha", encabezado: DESGLOSE_COLUMNAS.fecha },
  { clave: "tipo", encabezado: DESGLOSE_COLUMNAS.tipo },
  { clave: "concepto", encabezado: DESGLOSE_COLUMNAS.concepto },
  { clave: "monto", encabezado: DESGLOSE_COLUMNAS.monto },
  { clave: "origen", encabezado: DESGLOSE_COLUMNAS.origen },
];

/** Origen legible: la MISMA composición que pinta la tabla (etiqueta · descripción). */
function origen(movimiento: PagoMensajeroMovimientoDTO): string {
  const base = ORIGEN_PAGO_LABEL[movimiento.origenTipo] ?? movimiento.origenTipo;
  return movimiento.descripcion ? `${base} · ${movimiento.descripcion}` : base;
}

/**
 * Proyecta un movimiento del libro del mensajero a una fila de export con valores CRUDOS
 * (R7). Tipo y concepto salen como su ETIQUETA LEGIBLE (R8), la misma de pantalla.
 */
export function filaDescargaDesgloseMensajero(
  movimiento: PagoMensajeroMovimientoDTO,
): DescargaFila {
  return {
    fecha: fechaDiaISO(movimiento.fechaMovimiento),
    tipo: TIPO_PAGO_LABEL[movimiento.tipo] ?? movimiento.tipo,
    concepto: CATEGORIA_PAGO_LABEL[movimiento.categoria] ?? movimiento.categoria,
    monto: movimiento.monto, // STRING tal cual (money-safe)
    origen: origen(movimiento),
  };
}
