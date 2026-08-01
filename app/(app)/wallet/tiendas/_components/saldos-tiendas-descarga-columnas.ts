/**
 * Feature 170 (T D.1, design §3/§7) — columnas de EXPORT de los saldos de tiendas.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<SaldoTiendaResumenDTO>`
 * de `SaldosTiendasTable`, cuyo `render` devuelve un `<span>` coloreado y un `Badge` (R7).
 *
 * MONEY-SAFE: el saldo se emite como el STRING que devolvió el servidor, TAL CUAL. Sin
 * `parseFloat`/`Number` (un `Decimal(12,2)` no cabe exacto en un `number`) y sin el símbolo
 * de colón de `money`, que es presentación y además convertiría la celda en texto que la
 * hoja no puede sumar.
 *
 * Lo que NO sale: `tiendaId` (uuid interno, R23). El identificador de negocio de la fila es
 * el NOMBRE de la tienda, que es lo que la tabla enseña.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";

import { SALDO_SIGNO_LABEL } from "./saldo-tienda-signo-label";

/** Columnas del archivo, en el orden de la pantalla: las tres que la tabla pinta. */
export const COLUMNAS_DESCARGA_SALDOS_TIENDAS: DescargaColumna[] = [
  { clave: "tienda", encabezado: "Tienda" },
  { clave: "saldo", encabezado: "Saldo a favor" },
  { clave: "estado", encabezado: "Estado" },
];

/**
 * Proyecta el saldo de una tienda a una fila de export con valores CRUDOS (R7). El estado
 * sale como su ETIQUETA LEGIBLE (R8), la misma del badge; el `??` cae al valor del enum si
 * éste ganara un signo sin etiqueta — se lee peor, pero nunca miente.
 */
export function filaDescargaSaldoTienda(tienda: SaldoTiendaResumenDTO): DescargaFila {
  return {
    tienda: tienda.tiendaNombre,
    saldo: tienda.saldo, // STRING tal cual (money-safe): sin parseo, sin símbolo
    estado: SALDO_SIGNO_LABEL[tienda.signo] ?? tienda.signo,
  };
}
