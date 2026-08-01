/**
 * Feature 170 (tanda E) — etiquetas de texto de los cierres, en un módulo PURO.
 *
 * Todas estas constantes vivían en `cierre-detalle-shared.tsx`, que importa `Card`, `Badge`,
 * `Modal` y `DataTable`. Los módulos de columnas de export tienen que ser puros (design §3:
 * «sin React, sin DOM»), así que se PROMOVIERON aquí SIN EDITAR NI UN TEXTO —misma operación
 * que hizo la tanda B con `usuario-estado-label` y `ROL_LABELS`— y `cierre-detalle-shared`
 * las RE-EXPORTA: ningún consumidor de los que ya existían cambia una línea.
 *
 * Que el archivo descargado y la pantalla digan lo mismo (R8/R24) es cierto porque leen del
 * MISMO sitio, no porque hoy coincidan dos literales escritos en dos archivos.
 */
import type { MetodoPagoValue } from "@prisma/client";

import type { CierreResultado } from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";

// --- Etiquetas i18n-ready (texto separado de la lógica) ---
export const RESULTADO_LABEL: Record<CierreResultado, string> = {
  entregada: "Entregadas",
  reprogramada: "Reprogramadas",
  devuelta: "Devueltas",
  rechazada: "Rechazadas",
  incidente: "Incidentes", // feature 158/R18
};

export const METODO_LABEL: Record<MetodoPagoValue, string> = {
  efectivo: "Efectivo",
  SINPE: "SINPE",
  transferencia: "Transferencia",
};

export const ESTADO_LABEL: Record<CierreEstado, string> = {
  solicitado: "Solicitado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  vencido: "Vencido", // feature 41: etiqueta minima; el tratamiento diferenciado (R20) lo hace frontend_dev
};

/**
 * Destino de un cierre. Estaba DUPLICADA palabra por palabra en `CierresAdminModule` y en
 * `CierreDiaModule`; los dos la leen ahora de aquí, que es lo que hace cierto que el archivo
 * y las dos pantallas digan lo mismo (R8).
 */
export const DESTINO_TIPO_LABEL: Record<CierreDestinoTipo, string> = {
  bodega_central: "Bodega central",
  bodega_satelite: "Bodega satélite",
};

// --- Feature 39: etiquetas del pago al mensajero (texto separado, i18n-ready) ---
export const PAGO_MENSAJERO_COL = "Pago mensajero";
// --- Feature 56: etiquetas del ingreso de bodega por rechazos (texto separado, i18n-ready) ---
export const INGRESO_BODEGA_RECHAZOS_COL = "Ingreso bodega";
// --- Feature 102 (R9): marca por fila del ORIGEN de un rechazo ---
export const RECHAZO_ORIGEN_COL = "Origen";
export const RECHAZO_SLA_BADGE_LABEL = "Automático";
export const RECHAZO_MANUAL_BADGE_LABEL = "Manual";
// --- Desglose del ingreso de Ordenex por orden (texto separado, i18n-ready) ---
export const MONTO_COBRAR_COL = "A cobrar";
// Conceptos AGRUPADOS (cada uno con su IVA incluido): así se leen en tablas y paneles.
export const FLETE_CON_IVA_LABEL = "Flete + IVA";
export const COMISION_CON_IVA_LABEL = "Comisión + IVA";
export const FLETE_DEV_CON_IVA_LABEL = "Flete devolución + IVA";
export const INGRESO_TOTAL_COL = "Total Ordenex";
// --- Feature 158 (R34/R9/R19): columnas propias del grupo `incidente` (texto i18n-ready) ---
export const CAUSA_INCIDENTE_COL = "Causa";
export const INDEMNIZACION_COL = "Indemnización";
