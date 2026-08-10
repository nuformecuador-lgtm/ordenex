/**
 * Feature 196 (T5.1, design §7) — columnas de EXPORT del RANKING CONGELADO de una fecha.
 *
 * Espejo de `ranking-descarga-columnas.ts` (el del ranking en vivo) y módulo igual de PURO:
 * sin React, sin DOM y sin nada de `lib/services`. Los encabezados salen de
 * `RANKING_HISTORICO_COLUMNAS`, el MISMO objeto que titula la tabla, para que archivo y
 * pantalla no puedan divergir (R32).
 *
 * Tres decisiones que conviene leer antes de tocar esto:
 *
 * 1. **El premio SÍ sale aquí, a diferencia del vivo.** En `/ranking` el premio vive en otra
 *    tarjeta —la de configuración del podio, fuera de alcance de la 170— y exportarlo desde
 *    la tabla del ranking habría publicado un dato que esa tabla no enseña. En el histórico
 *    el premio es una columna congelada de ESTA misma tabla (R7) y es justo el dato que hace
 *    auditable lo que se pagó ese día: dejarlo fuera vaciaría el archivo de su motivo.
 *
 * 2. **`Puesto` y `Posición` son dos columnas y no una.** `puesto` es el lugar en la lista
 *    completa (1..N) y lo tiene toda fila; `posicion` es el podio (1/2/3) y es `null` para
 *    quien no alcanzó el umbral (R9). Fundirlas dejaría el archivo sin explicar por qué el
 *    4.º de la lista no cobra.
 *
 * 3. **El porcentaje viaja como el STRING del servidor, sin `%`** (mismo criterio money-safe
 *    que el vivo): nada de `parseFloat`/`Number` —convertiría `"100.0"` en `"100"`— y sin el
 *    símbolo, que es presentación y volvería texto una celda numérica. La unidad la dice el
 *    encabezado, que es literalmente el de la pantalla («% del día»).
 *
 * Lo que NO sale:
 * - `mensajeroId`: uuid interno (R34). La fila se identifica por su NOMBRE CONGELADO (R16),
 *   que es además el único que sigue siendo cierto si el mensajero se renombró después.
 * - `premioDescripcion`: es el rótulo de configuración del premio («Bono oro»), no una
 *   magnitud; design §7 declara UNA columna de premio y la magnitud auditable es el monto.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { RankingSnapshotFilaDTO } from "@/lib/types/ranking-snapshot";

import { RANKING_HISTORICO_COLUMNAS } from "./ranking-historico-labels";

/** Columnas del archivo, EN EL ORDEN DE LA PANTALLA (design §7). */
export const COLUMNAS_DESCARGA_RANKING_HISTORICO: DescargaColumna[] = [
  { clave: "puesto", encabezado: RANKING_HISTORICO_COLUMNAS.puesto },
  { clave: "posicion", encabezado: RANKING_HISTORICO_COLUMNAS.posicion },
  { clave: "mensajero", encabezado: RANKING_HISTORICO_COLUMNAS.mensajero },
  { clave: "porcentaje", encabezado: RANKING_HISTORICO_COLUMNAS.porcentaje },
  { clave: "entregadas", encabezado: RANKING_HISTORICO_COLUMNAS.entregadas },
  { clave: "asignadas", encabezado: RANKING_HISTORICO_COLUMNAS.asignadas },
  { clave: "premio", encabezado: RANKING_HISTORICO_COLUMNAS.premio },
];

/**
 * Proyecta una fila congelada con valores CRUDOS y en el orden en que ya venía (R25/R32):
 * el orden lo congeló el cron en `puesto`, la tabla no lo toca y el archivo tampoco.
 *
 * `posicion`, `pct` y `premioMonto` son `null` en las filas fuera del podio. En los tres
 * casos la celda queda VACÍA, y no con el «—» de la pantalla: el guion es presentación y en
 * una hoja de cálculo se leería como un valor.
 */
export function filaDescargaRankingHistorico(
  fila: RankingSnapshotFilaDTO,
): DescargaFila {
  return {
    puesto: fila.puesto,
    posicion: fila.posicion,
    mensajero: fila.nombre,
    porcentaje: fila.pct, // STRING tal cual del servidor: sin parseo y sin el símbolo «%»
    entregadas: fila.entregadas,
    asignadas: fila.asignadas,
    premio: fila.premioMonto, // STRING escala 2, sin el «₡» de la pantalla
  };
}
