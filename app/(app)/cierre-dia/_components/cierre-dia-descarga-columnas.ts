/**
 * Feature 170 (T E.4, design §3/§7) — columnas de EXPORT del «Cierre del día» del MENSAJERO:
 * las cinco secciones por resultado (entregadas, reprogramadas, devueltas, rechazadas,
 * incidentes) y el histórico de cierres solicitados.
 *
 * Son declaraciones DISTINTAS de las del detalle del admin (`cierre-gestiones-…`) aunque el
 * DTO sea el mismo, y a propósito: esta pantalla enseña MENOS. El mensajero no ve el ingreso
 * de Ordenex (flete, comisión, IVA, total) —eso es dinero de la empresa, no suyo— ni el
 * monto de la indemnización de un incidente (se le paga a la tienda, design §7.2 de la 158).
 * Exportar aquí lo que el admin ve sería publicar por el archivo lo que la pantalla oculta,
 * que es exactamente lo que R24 prohíbe.
 *
 * Lo que tampoco sale: la EVIDENCIA. `evidenciaUrl` es una URL FIRMADA y no viaja al archivo
 * (R22); en su lugar va «Tiene evidencia: Sí/No». Ni `gestionId`/`ordenId`/`cierreId`, que
 * son uuid internos (R23).
 *
 * Módulo PURO: sin React ni DOM. MONEY-SAFE: los montos viajan como el STRING del servidor,
 * TAL CUAL, sin `parseFloat`/`Number` y sin el símbolo de colón de `money`.
 */
import type {
  CierreDetalleGestion,
  CierrePasadoDTO,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import {
  CAUSA_INCIDENTE_COL,
  DESTINO_TIPO_LABEL,
  ESTADO_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
import { desgloseDescarga } from "@/app/(app)/cierres-admin/_components/desglose-pago";

/**
 * Encabezado del pago al mensajero EN SU PANTALLA. Aquí se llama "Ganancia" (y no "Pago
 * mensajero", como en las pantallas de admin): es su palabra para el mismo dato, y el
 * archivo usa la de la pantalla que lo produce (R8).
 */
export const GANANCIA_COL = "Ganancia";
/** Marca de evidencia: dice SI la hay, nunca dónde está (R22). */
export const TIENE_EVIDENCIA_COL = "Tiene evidencia";
export const TIENE_EVIDENCIA_SI = "Sí";
export const TIENE_EVIDENCIA_NO = "No";

/** Columnas comunes a las cinco secciones, en el orden de `COLUMNAS_COMUNES` del módulo. */
const COMUNES: DescargaColumna[] = [
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "direccion", encabezado: "Dirección" },
  { clave: "ubicacion", encabezado: "Ubicación" },
  { clave: "producto", encabezado: "Producto" },
  { clave: "tienda", encabezado: "Tienda" },
];

/** Jerarquía geográfica en una línea, misma composición que la columna "Ubicación". */
function ubicacion(gestion: CierreDetalleGestion): string | null {
  const partes = [
    gestion.zonaNombre,
    gestion.provinciaNombre,
    gestion.cantonNombre,
    gestion.distritoNombre,
  ].filter((parte): parte is string => Boolean(parte));
  return partes.length === 0 ? null : partes.join(" · ");
}

/** Celdas comunes. Valores CRUDOS: `null` es celda vacía, no el "—" de presentación (R7). */
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

/** «Sí»/«No» en vez de la URL firmada (R22). */
function tieneEvidencia(gestion: CierreDetalleGestion): string {
  return gestion.evidenciaUrl ? TIENE_EVIDENCIA_SI : TIENE_EVIDENCIA_NO;
}

// ---------------------------------------------------------------------------
// Secciones por resultado
// ---------------------------------------------------------------------------

export const COLUMNAS_DESCARGA_DIA_ENTREGADAS: DescargaColumna[] = [
  ...COMUNES,
  { clave: "monto", encabezado: "Monto" },
  { clave: "metodo", encabezado: "Método" },
  { clave: "ganancia", encabezado: GANANCIA_COL },
];

/**
 * El método de pago sale como ETIQUETA LEGIBLE (R8), nunca el value del enum. Feature 213
 * (R26-R31): la celda «Método» lleva el DESGLOSE completo —una sola celda, una sola fila, sin
 * columna nueva— y los montos van MONEY-SAFE, el STRING del servidor tal cual.
 */
export function filaDescargaDiaEntregada(gestion: CierreDetalleGestion): DescargaFila {
  return {
    ...celdasComunes(gestion),
    monto: gestion.montoRecibido,
    metodo: desgloseDescarga(gestion.pagos),
    ganancia: gestion.pagoMensajero,
  };
}

export const COLUMNAS_DESCARGA_DIA_REPROGRAMADAS: DescargaColumna[] = [
  ...COMUNES,
  { clave: "nuevaFecha", encabezado: "Nueva fecha" },
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "ganancia", encabezado: GANANCIA_COL },
];

export function filaDescargaDiaReprogramada(gestion: CierreDetalleGestion): DescargaFila {
  return {
    ...celdasComunes(gestion),
    nuevaFecha: gestion.fechaReprogramacion,
    motivo: gestion.motivo,
    ganancia: gestion.pagoMensajero,
  };
}

export const COLUMNAS_DESCARGA_DIA_DEVUELTAS: DescargaColumna[] = [
  ...COMUNES,
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "ganancia", encabezado: GANANCIA_COL },
];

export function filaDescargaDiaDevuelta(gestion: CierreDetalleGestion): DescargaFila {
  return {
    ...celdasComunes(gestion),
    motivo: gestion.motivo,
    ganancia: gestion.pagoMensajero,
  };
}

export const COLUMNAS_DESCARGA_DIA_RECHAZADAS: DescargaColumna[] = [
  ...COMUNES,
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "tieneEvidencia", encabezado: TIENE_EVIDENCIA_COL },
  { clave: "ganancia", encabezado: GANANCIA_COL },
];

export function filaDescargaDiaRechazada(gestion: CierreDetalleGestion): DescargaFila {
  return {
    ...celdasComunes(gestion),
    motivo: gestion.motivo,
    tieneEvidencia: tieneEvidencia(gestion),
    ganancia: gestion.pagoMensajero,
  };
}

/**
 * El grupo `incidente` NO lleva ninguna columna de dinero en esta pantalla (158/R17/R18): un
 * incidente no se paga al mensajero y la indemnización no es suya. El archivo respeta eso.
 */
export const COLUMNAS_DESCARGA_DIA_INCIDENTES: DescargaColumna[] = [
  ...COMUNES,
  { clave: "causa", encabezado: CAUSA_INCIDENTE_COL },
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "tieneEvidencia", encabezado: TIENE_EVIDENCIA_COL },
];

export function filaDescargaDiaIncidente(gestion: CierreDetalleGestion): DescargaFila {
  return {
    ...celdasComunes(gestion),
    causa: gestion.causaIncidente
      ? CAUSA_INCIDENTE_LABEL[gestion.causaIncidente] ?? gestion.causaIncidente
      : null,
    motivo: gestion.motivo,
    tieneEvidencia: tieneEvidencia(gestion),
  };
}

// ---------------------------------------------------------------------------
// Histórico de cierres solicitados
// ---------------------------------------------------------------------------

export const COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS: DescargaColumna[] = [
  { clave: "estado", encabezado: "Estado" },
  { clave: "destino", encabezado: "Destino" },
  { clave: "efectivo", encabezado: "Efectivo" },
  { clave: "simpe", encabezado: "SINPE" },
  { clave: "transferencia", encabezado: "Transferencia" },
  { clave: "general", encabezado: "Total" },
  { clave: "ganancia", encabezado: GANANCIA_COL },
  { clave: "fecha", encabezado: "Fecha" },
];

/**
 * Proyecta un cierre pasado del mensajero. Estado y destino salen como ETIQUETA LEGIBLE (R8);
 * la fecha, como el DÍA calendario, igual que la tabla. Esta tabla NO muestra la zona del
 * destino (solo el tipo), y el archivo tampoco (R24).
 */
export function filaDescargaDiaCierrePasado(cierre: CierrePasadoDTO): DescargaFila {
  return {
    estado: ESTADO_LABEL[cierre.estado] ?? cierre.estado,
    destino: DESTINO_TIPO_LABEL[cierre.destinoTipo] ?? cierre.destinoTipo,
    efectivo: cierre.totales.efectivo, // STRING tal cual (money-safe)
    simpe: cierre.totales.simpe,
    transferencia: cierre.totales.transferencia,
    general: cierre.totales.general,
    ganancia: cierre.totalPagoMensajero,
    fecha: fechaDiaISO(cierre.solicitadoAt),
  };
}
