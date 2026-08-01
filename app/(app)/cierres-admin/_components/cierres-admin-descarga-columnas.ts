/**
 * Feature 170 (T E.1, design §3/§7) — columnas de EXPORT de las DOS tablas de «Cierres del
 * día» del admin: la cola de pendientes de decisión y el histórico de resueltos.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<CierreAdminResumen>` del
 * módulo, cuyo `render` devuelve insignias de estado y botones (R7).
 *
 * Son DOS declaraciones y no una porque las dos tablas NO enseñan lo mismo: la cola muestra
 * la fecha de solicitud y no tiene motivo; el histórico muestra la fecha de resolución y el
 * motivo del rechazo. Un solo juego de columnas obligaría a inventar celdas vacías en una de
 * las dos, y R24 dice justo lo contrario: se exporta lo que la tabla enseña.
 *
 * MONEY-SAFE: los tres totales viajan como los STRING del snapshot, TAL CUAL, sin
 * `parseFloat`/`Number` y sin el símbolo de colón de `money` (presentación, y rompería la
 * celda como número).
 *
 * Lo que NO sale: `cierreId`, `mensajeroId` y `destinoZonaId` (uuid internos, R23).
 */
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import {
  DESTINO_TIPO_LABEL,
  ESTADO_LABEL,
  INGRESO_BODEGA_RECHAZOS_COL,
  PAGO_MENSAJERO_COL,
} from "./cierre-labels";

/** Destino legible: tipo + zona, EXACTAMENTE como lo compone la columna de pantalla. */
function destino(cierre: CierreAdminResumen): string {
  return `${DESTINO_TIPO_LABEL[cierre.destinoTipo] ?? cierre.destinoTipo} · ${cierre.destinoZonaNombre}`;
}

/** Columnas de la COLA de pendientes de decisión, en el orden de la pantalla. */
export const COLUMNAS_DESCARGA_CIERRES_PENDIENTES: DescargaColumna[] = [
  { clave: "estado", encabezado: "Estado" },
  { clave: "mensajero", encabezado: "Mensajero" },
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "destino", encabezado: "Destino" },
  { clave: "general", encabezado: "Total general" },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
  { clave: "ingresoBodega", encabezado: INGRESO_BODEGA_RECHAZOS_COL },
];

/**
 * Proyecta un cierre de la cola a una fila de export con valores CRUDOS (R7). El estado sale
 * como ETIQUETA LEGIBLE (R8) —"Solicitado"/"Vencido"—, nunca el value del enum. La fecha, como
 * el DÍA calendario, igual que la tabla (R24).
 */
export function filaDescargaCierrePendiente(cierre: CierreAdminResumen): DescargaFila {
  return {
    estado: ESTADO_LABEL[cierre.estado] ?? cierre.estado,
    mensajero: cierre.mensajeroNombre,
    fecha: fechaDiaISO(cierre.solicitadoAt),
    destino: destino(cierre),
    general: cierre.totales.general, // STRING tal cual (money-safe)
    pagoMensajero: cierre.totalPagoMensajero,
    ingresoBodega: cierre.totalIngresoBodegaRechazos,
  };
}

/** Columnas del HISTÓRICO de cierres resueltos, en el orden de la pantalla. */
export const COLUMNAS_DESCARGA_CIERRES_HISTORICO: DescargaColumna[] = [
  { clave: "estado", encabezado: "Estado" },
  { clave: "mensajero", encabezado: "Mensajero" },
  { clave: "fechaResuelta", encabezado: "Fecha resuelta" },
  { clave: "destino", encabezado: "Destino" },
  { clave: "general", encabezado: "Total general" },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
  { clave: "ingresoBodega", encabezado: INGRESO_BODEGA_RECHAZOS_COL },
  { clave: "motivo", encabezado: "Motivo" },
];

/**
 * Proyecta un cierre del histórico. El estado va como su etiqueta ("Aprobado"/"Rechazado");
 * el marcador «Bloqueante hasta re-solicitud» que la tabla añade a un rechazado NO se emite
 * como celda porque no es un dato distinto: se DERIVA del propio estado (todo rechazado lo
 * lleva), así que la columna ya lo dice.
 *
 * `resueltoAt` y `motivoRechazo` pueden ser `null` (un cierre que sigue abierto no tiene
 * fecha de resolución): la celda queda VACÍA, no con el "—" de presentación (R7).
 */
export function filaDescargaCierreHistorico(cierre: CierreAdminResumen): DescargaFila {
  return {
    estado: ESTADO_LABEL[cierre.estado] ?? cierre.estado,
    mensajero: cierre.mensajeroNombre,
    fechaResuelta: cierre.resueltoAt === null ? null : fechaDiaISO(cierre.resueltoAt),
    destino: destino(cierre),
    general: cierre.totales.general, // STRING tal cual (money-safe)
    pagoMensajero: cierre.totalPagoMensajero,
    ingresoBodega: cierre.totalIngresoBodegaRechazos,
    motivo: cierre.motivoRechazo,
  };
}
