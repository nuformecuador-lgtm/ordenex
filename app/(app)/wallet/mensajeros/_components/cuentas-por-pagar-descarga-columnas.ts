/**
 * Feature 170 (T D.2, design §3/§7) — columnas de EXPORT de las cuentas por pagar a
 * mensajeros.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<CuentaPorPagarResumenDTO>`
 * de `CuentasPorPagarTable`, cuyo `render` devuelve montos coloreados y un `Badge` (R7).
 *
 * MONEY-SAFE: los tres montos viajan como los STRING que devolvió el servidor, TAL CUAL.
 * Sin `parseFloat`/`Number` y sin el símbolo de colón de `money` (presentación, y rompería
 * la celda como número). Tampoco se recalcula nada: `cuentaPorPagar` la deriva el servidor,
 * y restar aquí «devengado − pagado» sería una segunda verdad que puede discrepar.
 *
 * Lo que NO sale: `mensajeroId` (uuid interno, R23). El identificador de negocio de la fila
 * es el NOMBRE del mensajero, que es lo que la tabla enseña.
 *
 * Los encabezados salen de `ENCABEZADOS_DESCARGA_MAESTRO`, que es `COLUMNAS_MAESTRO` —el mismo
 * objeto del que la tabla toma sus cabeceras— con UNA divergencia deliberada: «Devengado» y
 * «Pagado» llevan aquí la salvedad de los pagos anulados. En pantalla no hace falta porque el
 * aviso de la feature 172 va justo encima de la tabla; el archivo se reenvía sin él. Renombrar
 * una columna en pantalla sigue renombrándola también en el archivo.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

import { ENCABEZADOS_DESCARGA_MAESTRO, SIGNO_BADGE } from "./wallet-mensajeros-labels";

/** Columnas del archivo, en el orden de la pantalla: las cinco que la tabla pinta. */
export const COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR: DescargaColumna[] = [
  { clave: "mensajero", encabezado: ENCABEZADOS_DESCARGA_MAESTRO.mensajero },
  { clave: "devengado", encabezado: ENCABEZADOS_DESCARGA_MAESTRO.devengado },
  { clave: "pagado", encabezado: ENCABEZADOS_DESCARGA_MAESTRO.pagado },
  { clave: "cuentaPorPagar", encabezado: ENCABEZADOS_DESCARGA_MAESTRO.cuentaPorPagar },
  { clave: "estado", encabezado: ENCABEZADOS_DESCARGA_MAESTRO.estado },
];

/**
 * Proyecta la cuenta por pagar de un mensajero a una fila de export con valores CRUDOS (R7).
 * El estado sale como la ETIQUETA del badge (R8) —"Pendiente" / "Al día"—, nunca el valor
 * interno del signo; el `?.`/`??` cae al valor crudo si el enum ganara un signo sin badge.
 */
export function filaDescargaCuentaPorPagar(
  mensajero: CuentaPorPagarResumenDTO,
): DescargaFila {
  return {
    mensajero: mensajero.mensajeroNombre,
    devengado: mensajero.devengado, // STRING tal cual (money-safe)
    pagado: mensajero.pagado,
    cuentaPorPagar: mensajero.cuentaPorPagar,
    estado: SIGNO_BADGE[mensajero.signo]?.label ?? mensajero.signo,
  };
}
