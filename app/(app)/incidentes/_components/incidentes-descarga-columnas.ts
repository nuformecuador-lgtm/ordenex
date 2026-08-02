/**
 * Feature 170 (T E.6, design §3/§7) — columnas de EXPORT de las DOS tablas de la cola de
 * incidentes: pendientes de decisión e histórico de resueltos.
 *
 * Dos declaraciones y no una porque las tablas no enseñan lo mismo: la cola muestra la zona,
 * quién reportó y cuándo; el histórico, el estado, la indemnización, quién resolvió y el
 * motivo del rechazo. R24 manda exportar lo que cada tabla enseña, ni más ni menos.
 *
 * **Lo que NO sale: `evidenciaUrls`.** Son URL FIRMADAS: un `xlsx` reenviado por correo con
 * ellas dentro es acceso a las fotos sin sesión (R22). La tabla tampoco las muestra —se ven
 * en el detalle—, así que aquí no hay ni columna de evidencia.
 *
 * Tampoco salen `incidenteId` ni `ordenId` (uuid internos, R23): el identificador de negocio
 * de la fila es `numRemision`.
 *
 * Módulo PURO: sin React ni DOM. MONEY-SAFE: la indemnización viaja como el STRING del
 * servidor, TAL CUAL, sin `parseFloat`/`Number` y sin el símbolo de colón de `money`.
 */
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import { ESTADO_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-labels";

/** Columnas de la COLA de pendientes de decisión, en el orden de la pantalla. */
export const COLUMNAS_DESCARGA_INCIDENTES_PENDIENTES: DescargaColumna[] = [
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "zona", encabezado: "Zona" },
  { clave: "causa", encabezado: "Causa" },
  { clave: "reportadoPor", encabezado: "Reportado por" },
  { clave: "fecha", encabezado: "Fecha" },
];

/**
 * Proyecta un incidente de la cola. La causa sale SIEMPRE traducida (R8): el slug del enum
 * (`danado`) no se pinta nunca. `numGuia` puede ser `null` ⇒ celda VACÍA, no el "—" de
 * presentación (R7).
 */
export function filaDescargaIncidentePendiente(
  incidente: IncidenteAdminDTO,
): DescargaFila {
  return {
    numRemision: incidente.numRemision,
    numGuia: incidente.numGuia,
    destinatario: incidente.destinatario,
    zona: incidente.zonaNombre,
    causa: CAUSA_INCIDENTE_LABEL[incidente.causa] ?? incidente.causa,
    reportadoPor: incidente.reportadoPorNombre,
    fecha: fechaDiaISO(incidente.createdAt),
  };
}

/** Columnas del HISTÓRICO de incidentes resueltos, en el orden de la pantalla. */
export const COLUMNAS_DESCARGA_INCIDENTES_HISTORICO: DescargaColumna[] = [
  { clave: "estado", encabezado: "Estado" },
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "causa", encabezado: "Causa" },
  { clave: "indemnizacion", encabezado: "Indemnización" },
  { clave: "resueltoPor", encabezado: "Resuelto por" },
  { clave: "fechaResuelta", encabezado: "Fecha resuelta" },
  { clave: "motivo", encabezado: "Motivo" },
];

/**
 * Proyecta un incidente resuelto. Estado y causa como ETIQUETA LEGIBLE (R8).
 *
 * `indemnizacion === null` NO es cero: es «no se indemnizó» (un rechazado) o «todavía no se
 * capturó». La celda queda VACÍA, que es la lectura correcta; un 0 afirmaría un monto que
 * nadie decidió.
 */
export function filaDescargaIncidenteHistorico(
  incidente: IncidenteAdminDTO,
): DescargaFila {
  return {
    estado: ESTADO_LABEL[incidente.estado] ?? incidente.estado,
    numRemision: incidente.numRemision,
    destinatario: incidente.destinatario,
    causa: CAUSA_INCIDENTE_LABEL[incidente.causa] ?? incidente.causa,
    indemnizacion: incidente.indemnizacion, // STRING tal cual (money-safe)
    resueltoPor: incidente.resueltoPorNombre,
    fechaResuelta:
      incidente.resueltoAt === null ? null : fechaDiaISO(incidente.resueltoAt),
    motivo: incidente.motivoRechazo,
  };
}
