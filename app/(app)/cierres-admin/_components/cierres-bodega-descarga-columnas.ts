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
  // ⭑ FICHA 431 (T17, R28): `ESTADO_LABEL` YA NO SE IMPORTA AQUI. En un archivo de cierre de
  // bodega el estado se lee con el vocabulario de la conciliacion; `ESTADO_LABEL` sigue intacto
  // para el cierre de MENSAJERO, que comparte el enum pero no el significado (D3).
  ESTADO_CONCILIACION_LABEL,
  FALTA_POR_RECIBIR_LABEL,
  INGRESO_BODEGA_RECHAZOS_COL,
  MONTO_RECIBIDO_LABEL,
  PAGO_MENSAJERO_COL,
  PARA_LA_CENTRAL_LABEL,
  estadoConciliacionDe,
} from "./cierre-labels";

/**
 * ⭑ FICHA 431 (T17, R28) — EL ESTADO DE UNA CONSOLIDACION EN UN ARCHIVO.
 *
 * Sale su ETIQUETA LEGIBLE —«Pendiente de conciliar» / «Recibido» / «Recibido incompleto»— y
 * NUNCA el valor del enum: quien abra la hoja lee lo mismo que ve en pantalla. Se deriva con la
 * MISMA funcion que pinta el badge, asi que el archivo y la tarjeta no pueden discrepar.
 *
 * ⚠️ LO QUE ESTO RETIRA, dicho: «Rechazado» deja de aparecer. Una consolidacion `rechazado`
 * —cero en produccion— se lee ahora por su marca, que esta vacia, o sea «Pendiente de
 * conciliar». La fila sigue en la base y sigue bajando al archivo; lo que cambia es su rotulo,
 * que es exactamente lo que R16 pide.
 */
function estadoDeConciliacion(cierre: CierreBodegaResumen): string {
  return ESTADO_CONCILIACION_LABEL[estadoConciliacionDe(cierre)];
}

/**
 * ⭑ FICHA 431 (T17, R24) — las DOS columnas de la marca, al final de los DOS listados que las
 * llevan. Van las ultimas y ninguna columna existente se mueve, asi que un consumidor que lea
 * por posicion no se rompe — el mismo criterio con el que la 393 metio «Para la central».
 *
 * `montoRecibido` sale VACIO cuando no hay marca, jamas `"0.00"`: cero recibido significa que
 * alguien conto y no habia nada, que es otra cosa. `faltaPorRecibir` SI sale siempre —sin
 * marcar vale el efectivo integro— y llega DERIVADO del servidor, sin recalcular aqui.
 *
 * La NOTA de la conciliacion NO baja al archivo: es texto libre, mismo criterio que la 362.
 */
const COLUMNAS_MARCA = [
  { clave: "montoRecibido", encabezado: MONTO_RECIBIDO_LABEL },
  { clave: "faltaPorRecibir", encabezado: FALTA_POR_RECIBIR_LABEL },
] as const;

/** Los dos valores de la marca de una fila, money-safe (STRING del servidor, tal cual). */
function filaMarca(cierre: CierreBodegaResumen): DescargaFila {
  return {
    montoRecibido: cierre.montoRecibido,
    faltaPorRecibir: cierre.faltaPorRecibir,
  };
}

/**
 * Feature 393 (R22, D7) — «Para la central» en el archivo de los TRES listados de cierre de
 * bodega, y no en el cuarto.
 *
 * Va porque la persona usa ese número para CUADRAR CON LA CENTRAL, y cuadrar se hace en una
 * hoja, no mirando una pantalla: dejarlo sólo en la tarjeta lo deja justo fuera de donde se
 * usa. Va la ÚLTIMA de cada listado y ninguna columna existente se mueve, así que un consumidor
 * que lea por posición no se rompe.
 *
 * El listado de `cierre_dia` CONSOLIDABLES no la gana (R21): ahí no hay cierre de bodega
 * todavía y el número no tiene sujeto — `CierreBodegaResumenLite` ni siquiera lo lleva.
 *
 * `efectivoCubreDescuentos` NO va al archivo: es un aviso de pantalla, no una cifra, y una
 * columna booleana en una hoja de dinero se acaba sumando.
 *
 * MONEY-SAFE: la proyección LEE el STRING ya derivado por el servidor. No recalcula la resta —
 * hacerlo aquí sería una segunda fórmula para el mismo número, y el archivo podría acabar
 * diciendo algo distinto de la tarjeta.
 */
const PARA_LA_CENTRAL_COLUMNA = {
  clave: "paraLaCentral",
  encabezado: PARA_LA_CENTRAL_LABEL,
} as const;

/**
 * Identificadores de ÁMBITO de la preferencia de columnas de las CUATRO descargas (314/R1, R10).
 *
 * Uno por tabla, igual que los catálogos: las cuatro publican juegos distintos, así que una
 * clave compartida haría que ocultar «Motivo» en los resueltos moviera la preferencia de los
 * solicitados. Cada identificador es la mitad de una clave de `localStorage`
 * (`ordenex:descarga-columnas:<ámbito>`), y `ambito-columnas.guardia` vigila que no se repita.
 */
export const AMBITO_DESCARGA_BODEGA_PENDIENTES = "cierres-bodega-pendientes";
export const AMBITO_DESCARGA_BODEGA_RESUELTOS = "cierres-bodega-resueltos";
export const AMBITO_DESCARGA_CONSOLIDABLES = "cierres-consolidables";
export const AMBITO_DESCARGA_BODEGA_SOLICITADOS = "cierres-bodega-solicitados";

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
  PARA_LA_CENTRAL_COLUMNA, // feature 393/R22: la última, sin mover ninguna
  ...COLUMNAS_MARCA, // ⭑ ficha 431/R24
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
    paraLaCentral: cierre.paraLaCentral, // feature 393/R22: STRING del DTO, sin recalcular
    ...filaMarca(cierre), // ⭑ ficha 431/R24
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
  PARA_LA_CENTRAL_COLUMNA, // feature 393/R22: la última, sin mover ninguna
  ...COLUMNAS_MARCA, // ⭑ ficha 431/R24: las dos últimas, sin mover ninguna
];

/**
 * Proyecta un cierre de bodega resuelto. Estado como ETIQUETA LEGIBLE (R8); fecha de
 * resolución y motivo pueden ser `null` ⇒ celda VACÍA, no el "—" de presentación (R7).
 */
export function filaDescargaBodegaResuelto(cierre: CierreBodegaResumen): DescargaFila {
  return {
    estado: estadoDeConciliacion(cierre), // ⭑ ficha 431/R28: el vocabulario de la conciliación
    zona: cierre.zonaNombre,
    solicito: cierre.solicitadoPorNombre,
    fechaResuelta: cierre.resueltoAt === null ? null : fechaDiaISO(cierre.resueltoAt),
    general: cierre.totales.general,
    pagoMensajero: cierre.totalPagoMensajero,
    ingresoBodega: cierre.totalIngresoBodegaRechazos,
    motivo: cierre.motivoRechazo,
    paraLaCentral: cierre.paraLaCentral, // feature 393/R22: STRING del DTO, sin recalcular
    ...filaMarca(cierre), // ⭑ ficha 431/R24
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
  PARA_LA_CENTRAL_COLUMNA, // feature 393/R22: la última, sin mover ninguna
  // ⭑ ficha 431/R24/R26: la satélite descarga lo MISMO que ve. Sin estas dos, su archivo no
  // llevaría la diferencia que su pantalla sí enseña, y cuadrar fuera de la app —que es para lo
  // que se descarga— seguiría sin poder hacerse.
  ...COLUMNAS_MARCA,
];

/**
 * Proyecta un cierre de bodega del histórico propio del adminSatelite. Esta tabla enseña la
 * fecha de SOLICITUD (no la de resolución) y no muestra la zona —son todos de la suya—, así
 * que el archivo tampoco las lleva (R24).
 */
export function filaDescargaBodegaSolicitado(cierre: CierreBodegaResumen): DescargaFila {
  return {
    estado: estadoDeConciliacion(cierre), // ⭑ ficha 431/R28
    fechaSolicitud: fechaDiaISO(cierre.solicitadoAt),
    cierresDelDia: cierre.cantidadCierres,
    general: cierre.totales.general,
    pagoMensajero: cierre.totalPagoMensajero,
    ingresoBodega: cierre.totalIngresoBodegaRechazos,
    motivo: cierre.motivoRechazo,
    paraLaCentral: cierre.paraLaCentral, // feature 393/R22: STRING del DTO, sin recalcular
    ...filaMarca(cierre), // ⭑ ficha 431/R24
  };
}
