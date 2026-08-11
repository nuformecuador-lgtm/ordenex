// Feature 196 (T4.4, design §6/§7) — etiquetas i18n-ready y helpers de formato del ranking
// CONGELADO. Fuera del componente, como en `ranking-labels.ts` (docs/conventions: los textos
// de UI no viven incrustados en el JSX).
//
// Money-safe y paridad con la feature 76 (R31): `pct` y `premioMonto` llegan del servidor
// como STRING ya redondeado. Aquí solo se les antepone el símbolo; NUNCA hay `parseFloat`,
// `Number` ni división sobre un monto o un porcentaje.
//
// Los tres rótulos que la pantalla del ranking EN VIVO ya tiene (`Posición`, `Mensajero`,
// `% del día`) se REUSAN de `ranking-labels.ts` en vez de reescribirse: son la misma columna
// de la misma magnitud, y dos literales con el mismo contenido acabarían divergiendo.

import { RANKING_COLUMNAS } from "../../_components/ranking-labels";

/**
 * Encabezados de las columnas de la tabla del histórico (design §6/§7). Son los MISMOS
 * que declara el archivo de descarga (`ranking-historico-descarga-columnas.ts`), que los
 * importa de aquí para que pantalla y archivo no puedan decir cosas distintas (R32).
 *
 * `Puesto` y `Posición` NO son sinónimos y por eso son dos columnas:
 *  - `puesto` es el lugar en la lista completa congelada (1..N), lo tiene todo el mundo;
 *  - `posicion` es el podio (1/2/3) y solo lo tienen los elegibles (R6/R9).
 * Fundirlas haría ilegible por qué el 4.º de la lista no cobra premio.
 */
export const RANKING_HISTORICO_COLUMNAS = {
  puesto: "Puesto",
  posicion: RANKING_COLUMNAS.posicion,
  mensajero: RANKING_COLUMNAS.mensajero,
  porcentaje: RANKING_COLUMNAS.porcentaje,
  entregadas: "Entregadas",
  asignadas: "Asignadas",
  premio: "Premio",
} as const;

/**
 * Formateo FIJO a la zona de Costa Rica, patrón `HistorialOrdenTimeline`: la lectura del
 * instante de generación no puede depender de la zona horaria del entorno que renderiza,
 * o el mismo snapshot diría una hora distinta en cada máquina.
 */
const FECHA_HORA_CR = new Intl.DateTimeFormat("es-CR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

/** R24 — el instante en que el cron congeló la fecha, legible. ISO inválido ⇒ «—». */
export function instanteGeneracion(generadoAt: string): string {
  const fecha = new Date(generadoAt);
  return Number.isNaN(fecha.getTime()) ? "—" : FECHA_HORA_CR.format(fecha);
}

/**
 * Nombre visible del listado: encabezado de la tarjeta, nombre de la hoja, base del nombre
 * de archivo y nombre accesible del control de descarga. UN literal para los cuatro usos,
 * igual que `TITULO_DESCARGA` en el ranking en vivo.
 *
 * Lleva la FECHA CONSULTADA dentro a propósito (R35): `nombreArchivoDescarga` deriva el
 * nombre del archivo del título, así que con esto —y solo con esto— dos descargas de dos
 * fechas distintas dejan de llamarse igual.
 */
export function tituloRankingHistorico(fecha: string): string {
  return `Ranking del día ${fecha}`;
}

/** Textos de la pantalla del histórico. Los TRES estados de R26 son literales distintos. */
export const RANKING_HISTORICO_LABELS = {
  pageTitulo: "Histórico del ranking",
  pageDescripcion:
    "Resultado congelado del ranking diario de mensajeros. Es de solo lectura: no se recalcula ni se edita.",
  tablaAria: "Ranking congelado del día",
  selectorFecha: "Fecha del histórico",
  generadoEl: (instante: string) => `Generado el ${instante}`,
  /** Cabecera con filas = 0: el cron SÍ corrió (R11/R26). */
  sinActividad: "Ese día no hubo actividad: ningún mensajero tuvo entregas ni asignaciones.",
  /** Sin cabecera: el cron NO corrió esa fecha (R26). Incluye todo lo anterior al despliegue. */
  sinSnapshot: "No se generó el snapshot de esta fecha.",
  sinSnapshotDetalle:
    "El histórico solo tiene los días que el congelado diario alcanzó a cerrar. Probá con otra fecha.",
  volverAlVivo: "Ver el ranking de hoy",
} as const;
