/**
 * Feature 170 (T E.5, design §3/§7) — columnas de EXPORT de las secciones por resultado del
 * DETALLE de un cierre (`DetalleSecciones`): entregadas, reprogramadas, devueltas,
 * rechazadas e incidentes.
 *
 * **Una declaración POR SECCIÓN, y una descarga por sección** (decisión del humano, P2 de la
 * feature 170). Cada sección declara sus columnas porque las cinco no comparten las
 * específicas: una entrega lleva método de pago y comisión; una reprogramación, la fecha nueva;
 * un rechazo, el origen y el ingreso de bodega; un incidente, la causa y la indemnización.
 * Fundirlas da una hoja con celdas vacías, y ése fue el motivo de no hacerlo aquí.
 *
 * **Feature 230 (2026-08-18): ese archivo único AHORA EXISTE**, en
 * `cierres-gestiones-fundida-descarga-columnas.ts`, y su punto de entrada es otro: cruza los
 * cierres de varios mensajeros desde los listados, no una sección de un cierre abierto. El
 * humano vio el ejemplo con las celdas vacías y aceptó el coste para ESE caso de uso. **Las
 * cinco descargas de este módulo NO se retiran** —siguen siendo la salida estrecha y legible de
 * un cierre concreto—, así que lo de arriba sigue explicando por qué existen cinco y no una.
 * La marca de evidencia (`TIENE_EVIDENCIA_*`, `tieneEvidencia`) es de ELLAS: la hoja fundida no
 * lleva columna de evidencia en absoluto.
 *
 * **Lo que NO sale, y es el punto de esta tanda: la EVIDENCIA.** `evidenciaUrl` es una URL
 * FIRMADA: una hoja de cálculo que se reenvía por correo con esa URL dentro es un enlace a
 * la foto que funciona sin sesión (R22). Se emite en su lugar «Tiene evidencia: Sí/No», que
 * es el dato que el lector necesita sin regalar el acceso.
 *
 * Tampoco salen `gestionId` ni `ordenId` (uuid internos, R23): el identificador de negocio
 * de la fila es `numRemision`, que es el que la tabla enseña.
 *
 * Módulo PURO: sin React ni DOM. MONEY-SAFE: todos los montos viajan como el STRING del
 * snapshot, TAL CUAL, sin `parseFloat`/`Number` y sin el símbolo de colón de `money`.
 */
import type { CierreDetalleGestion } from "@/lib/interfaces/services/ICierreDiaService";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";

import {
  CAUSA_INCIDENTE_COL,
  COMISION_CON_IVA_LABEL,
  FLETE_CON_IVA_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  FULFILLMENT_COL,
  INDEMNIZACION_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
  INGRESO_TOTAL_COL,
  MONTO_COBRAR_COL,
  PAGO_MENSAJERO_COL,
  RECHAZO_MANUAL_BADGE_LABEL,
  RECHAZO_ORIGEN_COL,
  RECHAZO_SLA_BADGE_LABEL,
} from "./cierre-labels";
import { celdasMediosPago, COLUMNAS_MEDIOS_PAGO } from "./medios-pago-descarga-columnas";

/** Encabezado de la marca de evidencia: dice SI la hay, nunca dónde está (R22). */
export const TIENE_EVIDENCIA_COL = "Tiene evidencia";
/** Valores de esa marca (texto separado de la lógica, i18n-ready). */
export const TIENE_EVIDENCIA_SI = "Sí";
export const TIENE_EVIDENCIA_NO = "No";

/** Las columnas comunes a las cinco secciones, en el orden de `COLUMNAS_COMUNES`. */
const COMUNES: DescargaColumna[] = [
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "direccion", encabezado: "Dirección" },
  { clave: "ubicacion", encabezado: "Ubicación" },
  { clave: "producto", encabezado: "Producto" },
  { clave: "tienda", encabezado: "Tienda" },
];

/**
 * Jerarquía geográfica en una línea, con la MISMA composición que la columna "Ubicación" de
 * la tabla (`ubicacion` de `cierre-detalle-shared`), reescrita aquí para no importar un
 * módulo con React. Los tramos vacíos se omiten; si no queda ninguno, celda vacía.
 */
function ubicacion(gestion: CierreDetalleGestion): string | null {
  const partes = [
    gestion.zonaNombre,
    gestion.provinciaNombre,
    gestion.cantonNombre,
    gestion.distritoNombre,
  ].filter((parte): parte is string => Boolean(parte));
  return partes.length === 0 ? null : partes.join(" · ");
}

/** Celdas comunes a las cinco secciones. Valores CRUDOS: `null` es celda vacía, no "—". */
function celdasComunes(gestion: CierreDetalleGestion): DescargaFila {
  return {
    numGuia: gestion.numGuia,
    numRemision: gestion.numRemision,
    destinatario: gestion.destinatario,
    direccion: gestion.direccion,
    ubicacion: ubicacion(gestion),
    producto: gestion.producto,
    tienda: gestion.tiendaNombre,
  };
}

/** «Sí»/«No» en vez de la URL firmada (R22). Nunca la ruta ni el enlace. */
function tieneEvidencia(gestion: CierreDetalleGestion): string {
  return gestion.evidenciaUrl ? TIENE_EVIDENCIA_SI : TIENE_EVIDENCIA_NO;
}

// ---------------------------------------------------------------------------
// Entregadas
// ---------------------------------------------------------------------------

export const COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS: DescargaColumna[] = [
  ...COMUNES,
  { clave: "montoCobrar", encabezado: MONTO_COBRAR_COL },
  { clave: "fulfillment", encabezado: FULFILLMENT_COL },
  { clave: "recibido", encabezado: "Recibido" },
  ...COLUMNAS_MEDIOS_PAGO,
  { clave: "fleteConIva", encabezado: FLETE_CON_IVA_LABEL },
  { clave: "comisionConIva", encabezado: COMISION_CON_IVA_LABEL },
  { clave: "ingresoTotal", encabezado: INGRESO_TOTAL_COL },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
];

/**
 * El recaudo sale con UNA COLUMNA POR MEDIO DE PAGO —«Efectivo», «SINPE», «Transferencia»—, no
 * en la celda única «Método» que llevaba el desglose concatenado (feature 213, R26-R31): la
 * hoja de cálculo suma la columna de un medio sin tener que parsear «Efectivo 100 + SINPE 50».
 *
 * El encabezado sigue siendo la ETIQUETA LEGIBLE del medio (R8), nunca el value del enum, y los
 * montos siguen MONEY-SAFE: el STRING del snapshot tal cual. El medio por el que no entró dinero
 * deja la celda VACÍA (`null`), que no es un cero.
 */
export function filaDescargaGestionEntregada(gestion: CierreDetalleGestion): DescargaFila {
  const ingreso = gestion.ingresoOrdenex;
  return {
    ...celdasComunes(gestion),
    montoCobrar: ingreso ? ingreso.montoCobrar : null,
    fulfillment: ingreso?.tarifa?.fulfillment ?? null,
    recibido: gestion.montoRecibido,
    ...celdasMediosPago(gestion.pagos),
    fleteConIva: ingreso ? ingreso.fleteConIva : null,
    comisionConIva: ingreso ? ingreso.comisionConIva : null,
    ingresoTotal: ingreso ? ingreso.total : null,
    pagoMensajero: gestion.pagoMensajero,
  };
}

// ---------------------------------------------------------------------------
// Reprogramadas
// ---------------------------------------------------------------------------

export const COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS: DescargaColumna[] = [
  ...COMUNES,
  { clave: "montoCobrar", encabezado: MONTO_COBRAR_COL },
  { clave: "fulfillment", encabezado: FULFILLMENT_COL },
  { clave: "nuevaFecha", encabezado: "Nueva fecha" },
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
];

/**
 * Una reprogramación no deriva ningún concepto de ingreso (la fórmula devuelve vacío), así
 * que la tabla no pinta esas columnas y el archivo tampoco las lleva (R24).
 */
export function filaDescargaGestionReprogramada(
  gestion: CierreDetalleGestion,
): DescargaFila {
  return {
    ...celdasComunes(gestion),
    montoCobrar: gestion.ingresoOrdenex ? gestion.ingresoOrdenex.montoCobrar : null,
    fulfillment: gestion.ingresoOrdenex?.tarifa?.fulfillment ?? null,
    nuevaFecha: gestion.fechaReprogramacion,
    motivo: gestion.motivo,
    pagoMensajero: gestion.pagoMensajero,
  };
}

// ---------------------------------------------------------------------------
// Devueltas
// ---------------------------------------------------------------------------

export const COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS: DescargaColumna[] = [
  ...COMUNES,
  { clave: "montoCobrar", encabezado: MONTO_COBRAR_COL },
  { clave: "fulfillment", encabezado: FULFILLMENT_COL },
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "fleteDevolucionConIva", encabezado: FLETE_DEV_CON_IVA_LABEL },
  { clave: "ingresoTotal", encabezado: INGRESO_TOTAL_COL },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
];

export function filaDescargaGestionDevuelta(gestion: CierreDetalleGestion): DescargaFila {
  const ingreso = gestion.ingresoOrdenex;
  return {
    ...celdasComunes(gestion),
    montoCobrar: ingreso ? ingreso.montoCobrar : null,
    fulfillment: ingreso?.tarifa?.fulfillment ?? null,
    motivo: gestion.motivo,
    fleteDevolucionConIva: ingreso ? ingreso.fleteDevolucionConIva : null,
    ingresoTotal: ingreso ? ingreso.total : null,
    pagoMensajero: gestion.pagoMensajero,
  };
}

// ---------------------------------------------------------------------------
// Rechazadas
// ---------------------------------------------------------------------------

export const COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS: DescargaColumna[] = [
  ...COMUNES,
  { clave: "origenRechazo", encabezado: RECHAZO_ORIGEN_COL },
  { clave: "montoCobrar", encabezado: MONTO_COBRAR_COL },
  { clave: "fulfillment", encabezado: FULFILLMENT_COL },
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "tieneEvidencia", encabezado: TIENE_EVIDENCIA_COL },
  { clave: "fleteDevolucionConIva", encabezado: FLETE_DEV_CON_IVA_LABEL },
  { clave: "ingresoTotal", encabezado: INGRESO_TOTAL_COL },
  { clave: "pagoMensajero", encabezado: PAGO_MENSAJERO_COL },
  { clave: "ingresoBodega", encabezado: INGRESO_BODEGA_RECHAZOS_COL },
];

/**
 * El ORIGEN del rechazo sale como la etiqueta del badge (R8): «Automático» si lo escaló el
 * cron de plazo vencido, «Manual» si lo registró el mensajero. La columna de evidencia sale
 * como Sí/No, NUNCA la URL firmada (R22).
 */
export function filaDescargaGestionRechazada(gestion: CierreDetalleGestion): DescargaFila {
  const ingreso = gestion.ingresoOrdenex;
  return {
    ...celdasComunes(gestion),
    origenRechazo:
      gestion.esRechazoSla === true ? RECHAZO_SLA_BADGE_LABEL : RECHAZO_MANUAL_BADGE_LABEL,
    montoCobrar: ingreso ? ingreso.montoCobrar : null,
    fulfillment: ingreso?.tarifa?.fulfillment ?? null,
    motivo: gestion.motivo,
    tieneEvidencia: tieneEvidencia(gestion),
    fleteDevolucionConIva: ingreso ? ingreso.fleteDevolucionConIva : null,
    ingresoTotal: ingreso ? ingreso.total : null,
    pagoMensajero: gestion.pagoMensajero,
    ingresoBodega: gestion.ingresoBodegaRechazo,
  };
}

// ---------------------------------------------------------------------------
// Incidentes (feature 158)
// ---------------------------------------------------------------------------

export const COLUMNAS_DESCARGA_GESTIONES_INCIDENTES: DescargaColumna[] = [
  ...COMUNES,
  { clave: "montoCobrar", encabezado: MONTO_COBRAR_COL },
  { clave: "fulfillment", encabezado: FULFILLMENT_COL },
  { clave: "causa", encabezado: CAUSA_INCIDENTE_COL },
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "tieneEvidencia", encabezado: TIENE_EVIDENCIA_COL },
  { clave: "indemnizacion", encabezado: INDEMNIZACION_COL },
];

/**
 * La causa sale como ETIQUETA LEGIBLE (R8): el slug del enum (`danado`) no se pinta nunca.
 *
 * `indemnizacion === null` NO es cero: es «todavía no se capturó» (el monto lo pone el admin
 * al aprobar). La celda queda VACÍA, que es la lectura correcta de un dato que aún no existe;
 * un 0 diría que no se indemniza, y es lo contrario.
 */
export function filaDescargaGestionIncidente(gestion: CierreDetalleGestion): DescargaFila {
  return {
    ...celdasComunes(gestion),
    montoCobrar: gestion.ingresoOrdenex ? gestion.ingresoOrdenex.montoCobrar : null,
    fulfillment: gestion.ingresoOrdenex?.tarifa?.fulfillment ?? null,
    causa: gestion.causaIncidente
      ? CAUSA_INCIDENTE_LABEL[gestion.causaIncidente] ?? gestion.causaIncidente
      : null,
    motivo: gestion.motivo,
    tieneEvidencia: tieneEvidencia(gestion),
    indemnizacion: gestion.indemnizacion,
  };
}
