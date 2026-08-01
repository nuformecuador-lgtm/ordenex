/**
 * Feature 170 (T F.1, design §3/§7) — columnas de EXPORT del RANKING DEL DÍA.
 *
 * Ojo con la pantalla: `/ranking` monta DOS tablas. Ésta declara la del RANKING (la
 * `<DataTable>` de mensajeros ordenada por porcentaje). La otra —los PREMIOS del podio— es
 * una `<table>` HTML cruda de tres filas de configuración con montos editables, y queda
 * FUERA del alcance por decisión ya ratificada del humano (P1). No se le cablea descarga ni
 * se proyecta aquí ni una celda suya.
 *
 * Módulo PURO: sin React ni DOM. Los encabezados de las tres columnas que la pantalla ya
 * rotula salen de `RANKING_COLUMNAS` (el MISMO objeto que titula la tabla), para que archivo
 * y pantalla no puedan divergir (R8/R24).
 *
 * Dos decisiones que conviene leer antes de tocar esto:
 *
 * 1. **El conteo crudo se parte en DOS columnas.** La tabla pinta una sola celda
 *    «Entregadas / asignadas» con `5/5`, que es glue de PRESENTACIÓN: en una hoja, `5/5` es
 *    texto que nadie puede sumar ni promediar (y algún Excel lo interpretaría como fecha).
 *    R7 pide valores CRUDOS, así que el archivo lleva los dos NÚMEROS que la tabla ya
 *    enseña, cada uno en su columna. No se añade información: se le quita el adorno.
 *
 * 2. **El porcentaje viaja como el STRING del servidor, sin `%`.** Igual que el criterio
 *    money-safe del resto del rollout: nada de `parseFloat`/`Number` sobre `pct` (el
 *    servidor ya lo redondeó y un `Number` intermedio convertiría `"100.0"` en `"100"`), y
 *    sin el símbolo, que es presentación y convertiría una celda numérica en texto. La
 *    unidad la dice el encabezado, que es literalmente el de la pantalla («% del día»).
 *
 * Lo que NO sale:
 * - `mensajeroId`: uuid interno (R23). El identificador de negocio de la fila es el NOMBRE.
 * - `premio`: el DTO lo trae, pero la tabla del ranking NO lo muestra — el monto del premio
 *   se ve en la OTRA tarjeta, la del podio, que está fuera de alcance. Exportarlo aquí sería
 *   publicar por el archivo un dato que esta tabla no enseña (R24) y, de paso, colar por la
 *   puerta de atrás la tabla que el humano dejó fuera.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { RankingRowDTO } from "@/lib/types/ranking";

import { RANKING_COLUMNAS } from "./ranking-labels";

/**
 * Columnas del archivo, en el orden de la pantalla. Las tres primeras reusan el rótulo de
 * la tabla; las dos últimas son el desglose de su cuarta columna (ver nota 1 de arriba).
 */
export const COLUMNAS_DESCARGA_RANKING: DescargaColumna[] = [
  { clave: "posicion", encabezado: RANKING_COLUMNAS.posicion },
  { clave: "mensajero", encabezado: RANKING_COLUMNAS.mensajero },
  { clave: "porcentaje", encabezado: RANKING_COLUMNAS.porcentaje },
  { clave: "entregadas", encabezado: "Entregadas" },
  { clave: "asignadas", encabezado: "Asignadas" },
];

/**
 * Proyecta una fila del ranking con valores CRUDOS (R7) y en el orden que el servidor ya
 * resolvió (R11): la tabla no reordena nada y el archivo tampoco.
 *
 * `posicion` es `null` fuera del podio y `pct` es `null` cuando no hubo asignadas. En los
 * dos casos la celda queda VACÍA, no con el «—» de la pantalla: el guion es presentación y
 * en una hoja se leería como un valor.
 */
export function filaDescargaRanking(fila: RankingRowDTO): DescargaFila {
  return {
    posicion: fila.posicion,
    mensajero: fila.nombre,
    porcentaje: fila.pct, // STRING tal cual del servidor: sin parseo y sin el símbolo «%»
    entregadas: fila.entregadasHoy,
    asignadas: fila.asignadasHoy,
  };
}
