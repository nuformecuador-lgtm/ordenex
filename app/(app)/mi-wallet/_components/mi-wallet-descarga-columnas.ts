/**
 * Feature 170 (T C.3, design §3/§7) — columnas de EXPORT del desglose de movimientos de la
 * TIENDA (su propia vista, `/mi-wallet`).
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<…>` de
 * `DesgloseTiendaLedger`, cuyo `render` devuelve una insignia de tipo (R7).
 *
 * MONEY-SAFE: el monto se emite como el STRING que llega del servidor, TAL CUAL. Sin
 * `parseFloat`/`Number` y sin el símbolo de colón (presentación).
 *
 * Lo que NO sale: `id`, `origenId` y `tiendaId` (uuid internos, R23; el `tiendaId` además es
 * el mismo para todo el archivo — es el ledger de UNA tienda) ni `registradoPor`.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import { CATEGORIA_TIENDA_LABEL, ORIGEN_TIENDA_LABEL, TIPO_TIENDA_LABEL } from "./mi-wallet-labels";

/** Columnas emitidas por la descarga del ledger de la tienda, en su orden de pantalla. */
export const COLUMNAS_DESCARGA_MI_WALLET: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "tipo", encabezado: "Tipo" },
  { clave: "concepto", encabezado: "Concepto" },
  { clave: "monto", encabezado: "Monto" },
  { clave: "origen", encabezado: "Origen" },
];

/** Origen legible: la MISMA composición que pinta la tabla (etiqueta · descripción). */
function origen(movimiento: WalletTiendaMovimientoDTO): string {
  const base = ORIGEN_TIENDA_LABEL[movimiento.origenTipo] ?? movimiento.origenTipo;
  return movimiento.descripcion ? `${base} · ${movimiento.descripcion}` : base;
}

/**
 * Proyecta un movimiento del ledger de la tienda a una fila de export con valores CRUDOS
 * (R7). Tipo y concepto salen como su ETIQUETA LEGIBLE (R8), la misma de pantalla: un
 * archivo que dijera `cod_recaudado` obligaría a traducir a mano.
 */
export function filaDescargaMiWallet(movimiento: WalletTiendaMovimientoDTO): DescargaFila {
  return {
    fecha: fechaDiaISO(movimiento.fechaMovimiento),
    tipo: TIPO_TIENDA_LABEL[movimiento.tipo] ?? movimiento.tipo,
    concepto: CATEGORIA_TIENDA_LABEL[movimiento.categoria] ?? movimiento.categoria,
    monto: movimiento.monto, // STRING tal cual (money-safe)
    origen: origen(movimiento),
  };
}
