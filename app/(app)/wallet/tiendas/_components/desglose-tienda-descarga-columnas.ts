/**
 * Feature 171 (T2.2, design §7) — columnas de EXPORT del desglose de UNA tienda elegida
 * (`/wallet/tiendas`, vista de los roles de acceso total).
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<…>` de
 * `DesgloseMovimientosTienda`, cuyo `render` devuelve una insignia de tipo. El nombre del
 * archivo termina en `-descarga-columnas.ts` por CONVENCIÓN: así la guardia de datos
 * sensibles de la 170 lo descubre sola, sin que nadie tenga que apuntarlo en una lista
 * (R41). Por lo mismo, el módulo exporta EXACTAMENTE dos cosas: la guardia ejecuta con una
 * sonda toda función exportada, y un tercer export que no fuera una proyección la rompería.
 *
 * MONEY-SAFE: el monto se emite como el STRING que llega del servidor, TAL CUAL. Sin
 * `parseFloat`/`Number` (un `Decimal(12,2)` largo no cabe exacto en un `number`) y sin el
 * símbolo de colón, que es presentación y convertiría la celda en texto que la hoja no puede
 * sumar.
 *
 * Lo que NO sale: `id`, `tiendaId` y `origenId` (uuid internos) ni `registradoPor`. El
 * NOMBRE de la tienda tampoco es columna (P4): identifica al archivo entero —es el desglose
 * de UNA tienda— y su sitio es el título de la descarga, igual que en el del mensajero.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import {
  CATEGORIA_TIENDA_LABEL,
  DESGLOSE_TIENDA_COLUMNAS,
  ORIGEN_TIENDA_LABEL,
  TIPO_TIENDA_LABEL,
} from "./desglose-tienda-labels";

/**
 * Columnas emitidas por la descarga, en su orden de pantalla (R15). Los encabezados salen
 * de `DESGLOSE_TIENDA_COLUMNAS`, el MISMO objeto del que la tabla saca los suyos: el archivo
 * no puede acabar con una cabecera distinta de la que se ve.
 */
export const COLUMNAS_DESCARGA_DESGLOSE_TIENDA: DescargaColumna[] = [
  { clave: "fecha", encabezado: DESGLOSE_TIENDA_COLUMNAS.fecha },
  { clave: "tipo", encabezado: DESGLOSE_TIENDA_COLUMNAS.tipo },
  { clave: "concepto", encabezado: DESGLOSE_TIENDA_COLUMNAS.concepto },
  { clave: "monto", encabezado: DESGLOSE_TIENDA_COLUMNAS.monto },
  { clave: "origen", encabezado: DESGLOSE_TIENDA_COLUMNAS.origen },
];

/** Origen legible: la MISMA composición que pinta la tabla (etiqueta · descripción). */
function origen(movimiento: WalletTiendaMovimientoDTO): string {
  const base = ORIGEN_TIENDA_LABEL[movimiento.origenTipo] ?? movimiento.origenTipo;
  return movimiento.descripcion ? `${base} · ${movimiento.descripcion}` : base;
}

/**
 * Proyecta un movimiento del libro de la tienda a una fila de export con valores CRUDOS.
 * Tipo y concepto salen como su ETIQUETA LEGIBLE (R20), la misma de pantalla: un archivo que
 * dijera `iva_comision_cod` obligaría a traducir a mano.
 */
export function filaDescargaDesgloseTienda(
  movimiento: WalletTiendaMovimientoDTO,
): DescargaFila {
  return {
    fecha: fechaDiaISO(movimiento.fechaMovimiento),
    tipo: TIPO_TIENDA_LABEL[movimiento.tipo] ?? movimiento.tipo,
    concepto: CATEGORIA_TIENDA_LABEL[movimiento.categoria] ?? movimiento.categoria,
    monto: movimiento.monto, // STRING tal cual (money-safe)
    origen: origen(movimiento),
  };
}
