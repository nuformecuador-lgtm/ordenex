/**
 * Feature 170 (T E.2 y T E.3, design §3/§7) — columnas de EXPORT de las CUATRO tablas de
 * cierre de bodega:
 *
 *  - `CierresBodegaAdminModule`: pendientes de decisión y resueltos (E.2).
 *  - `ConsolidacionBodegaModule`: cierres del día a consolidar y cierres de bodega
 *    solicitados (E.3).
 *
 * Viven en un solo módulo porque son la misma familia de datos (`CierreBodegaResumen` y su
 * `Lite`) y comparten labels; cada tabla declara SUS columnas, que no son las mismas: la
 * cola de pendientes no tiene estado ni motivo (todas están `solicitado`), el histórico del
 * maestro sí, y el del adminSatelite muestra la fecha de SOLICITUD en vez de la de resolución.
 *
 * Módulo PURO: sin React ni DOM. MONEY-SAFE: los totales viajan como el STRING del snapshot,
 * TAL CUAL, sin `parseFloat`/`Number` y sin el símbolo de colón.
 *
 * Lo que NO sale: `cierreBodegaId`, `cierreDiaId`, `zonaId`, `mensajeroId` y
 * `solicitadoPorId` (uuid internos, R23). De cada persona sale su NOMBRE, que es lo que la
 * tabla enseña.
 */
import type {
  CierreBodegaResumen,
  CierreBodegaResumenLite,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import {
  ESTADO_LABEL,
  INGRESO_BODEGA_RECHAZOS_COL,
  PAGO_MENSAJERO_COL,
} from "./cierre-labels";

// ---------------------------------------------------------------------------
// E.2 — Cierres de bodega del maestro/admin
// ---------------------------------------------------------------------------

/** Columnas de la COLA de cierres de bodega pendientes, en el orden de la pantalla. */
export const COLUMNAS_DESCARGA_BODEGA_PENDIENTES: DescargaColumna[] = [
  { clave: "zona", encabezado: "Zona" },
  { clave: "solicito", encabezado: "Solicitó" },
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "cierresDelDia", encabezado: "Cierres del día" },
  { clave: "general", encabezado: "Total general" },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
  { clave: "ingresoBodega", encabezado: INGRESO_BODEGA_RECHAZOS_COL },
];

/**
 * Proyecta un cierre de bodega de la cola. `cantidadCierres` sale como NÚMERO crudo (R7): la
 * tabla lo pinta con `String(...)` porque una celda de HTML necesita texto, pero una hoja de
 * cálculo prefiere el número —que se puede sumar y ordenar—.
 */
export function filaDescargaBodegaPendiente(cierre: CierreBodegaResumen): DescargaFila {
  return {
    zona: cierre.zonaNombre,
    solicito: cierre.solicitadoPorNombre,
    fecha: fechaDiaISO(cierre.solicitadoAt),
    cierresDelDia: cierre.cantidadCierres,
    general: cierre.totales.general, // STRING tal cual (money-safe)
    pagoMensajero: cierre.totalPagoMensajero,
    ingresoBodega: cierre.totalIngresoBodegaRechazos,
  };
}

/** Columnas del HISTÓRICO de cierres de bodega resueltos, en el orden de la pantalla. */
export const COLUMNAS_DESCARGA_BODEGA_RESUELTOS: DescargaColumna[] = [
  { clave: "estado", encabezado: "Estado" },
  { clave: "zona", encabezado: "Zona" },
  { clave: "solicito", encabezado: "Solicitó" },
  { clave: "fechaResuelta", encabezado: "Fecha resuelta" },
  { clave: "general", encabezado: "Total general" },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
  { clave: "ingresoBodega", encabezado: INGRESO_BODEGA_RECHAZOS_COL },
  { clave: "motivo", encabezado: "Motivo" },
];

/**
 * Proyecta un cierre de bodega resuelto. Estado como ETIQUETA LEGIBLE (R8); fecha de
 * resolución y motivo pueden ser `null` ⇒ celda VACÍA, no el "—" de presentación (R7).
 */
export function filaDescargaBodegaResuelto(cierre: CierreBodegaResumen): DescargaFila {
  return {
    estado: ESTADO_LABEL[cierre.estado] ?? cierre.estado,
    zona: cierre.zonaNombre,
    solicito: cierre.solicitadoPorNombre,
    fechaResuelta: cierre.resueltoAt === null ? null : fechaDiaISO(cierre.resueltoAt),
    general: cierre.totales.general,
    pagoMensajero: cierre.totalPagoMensajero,
    ingresoBodega: cierre.totalIngresoBodegaRechazos,
    motivo: cierre.motivoRechazo,
  };
}

// ---------------------------------------------------------------------------
// E.3 — Consolidación de bodega (adminSatelite)
// ---------------------------------------------------------------------------

/** Columnas de los cierres del día A CONSOLIDAR, en el orden de la pantalla. */
export const COLUMNAS_DESCARGA_CONSOLIDABLES: DescargaColumna[] = [
  { clave: "mensajero", encabezado: "Mensajero" },
  { clave: "efectivo", encabezado: "Efectivo" },
  { clave: "simpe", encabezado: "SINPE" },
  { clave: "transferencia", encabezado: "Transferencia" },
  { clave: "general", encabezado: "Total general" },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
  { clave: "ingresoBodega", encabezado: INGRESO_BODEGA_RECHAZOS_COL },
];

/** Proyecta un cierre del día consolidable. Los cinco montos, STRING tal cual (money-safe). */
export function filaDescargaConsolidable(cierre: CierreBodegaResumenLite): DescargaFila {
  return {
    mensajero: cierre.mensajeroNombre,
    efectivo: cierre.totales.efectivo,
    simpe: cierre.totales.simpe,
    transferencia: cierre.totales.transferencia,
    general: cierre.totales.general,
    pagoMensajero: cierre.totalPagoMensajero,
    ingresoBodega: cierre.totalIngresoBodegaRechazos,
  };
}

/** Columnas de los cierres de bodega YA SOLICITADOS por la zona, en el orden de la pantalla. */
export const COLUMNAS_DESCARGA_BODEGA_SOLICITADOS: DescargaColumna[] = [
  { clave: "estado", encabezado: "Estado" },
  { clave: "fechaSolicitud", encabezado: "Fecha solicitud" },
  { clave: "cierresDelDia", encabezado: "Cierres del día" },
  { clave: "general", encabezado: "Total general" },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
  { clave: "ingresoBodega", encabezado: INGRESO_BODEGA_RECHAZOS_COL },
  { clave: "motivo", encabezado: "Motivo" },
];

/**
 * Proyecta un cierre de bodega del histórico propio del adminSatelite. Esta tabla enseña la
 * fecha de SOLICITUD (no la de resolución) y no muestra la zona —son todos de la suya—, así
 * que el archivo tampoco las lleva (R24).
 */
export function filaDescargaBodegaSolicitado(cierre: CierreBodegaResumen): DescargaFila {
  return {
    estado: ESTADO_LABEL[cierre.estado] ?? cierre.estado,
    fechaSolicitud: fechaDiaISO(cierre.solicitadoAt),
    cierresDelDia: cierre.cantidadCierres,
    general: cierre.totales.general,
    pagoMensajero: cierre.totalPagoMensajero,
    ingresoBodega: cierre.totalIngresoBodegaRechazos,
    motivo: cierre.motivoRechazo,
  };
}
