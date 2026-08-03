/**
 * Feature 172 (T D.2, design §10.4) — columnas de EXPORT de la lista de COMPROBANTES de un
 * beneficiario (los pagos registrados de una tienda o de un cierre).
 *
 * Módulo PURO: sin React ni DOM. El nombre termina en `-descarga-columnas.ts` por CONVENCIÓN,
 * que es como la guardia de datos sensibles de la 170 lo descubre sola, sin lista que
 * mantener. Por lo mismo el módulo exporta EXACTAMENTE dos cosas: la guardia ejecuta con una
 * sonda toda función exportada, y un tercer export que no fuera una proyección la rompería.
 *
 * MONEY-SAFE (R14): el monto se emite como el STRING que llega del servidor, TAL CUAL. Sin
 * `Number`/`parseFloat` (un `DECIMAL(12,2)` largo no cabe exacto en un `number`) y sin el
 * símbolo de colón, que es presentación y convertiría la celda en texto que la hoja no suma.
 *
 * LO QUE NO SALE (R56): el `id` del pago —único uuid del DTO, que la pantalla necesita para
 * pedir su anulación pero nadie tiene por qué leer— y, por construcción, ningún identificador
 * de persona: el DTO ya trae NOMBRES (`registradoPorNombre`, `anuladoPorNombre`) y no ids.
 *
 * UN PAGO ANULADO SE DESCARGA ENTERO (R74): con todos sus datos originales, más su estado y
 * las tres columnas de la anulación. Un archivo que se saltara los anulados —o que los
 * dejara indistinguibles de los vigentes— sería justo lo que la anulación existe para evitar.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { PagoRegistradoDTO } from "@/lib/types/liquidacion";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import {
  METODO_LIQUIDACION_LABEL,
  PAGOS_REGISTRADOS_COLUMNAS,
  PAGOS_REGISTRADOS_COLUMNAS_ANULACION,
  PAGO_ESTADO_LABEL,
} from "./liquidacion-labels";

/**
 * Columnas emitidas, en el orden de la pantalla y con las tres de la anulación al final. Los
 * encabezados salen del MISMO objeto del que la tabla saca los suyos: el archivo no puede
 * acabar con una cabecera distinta de la que se ve.
 */
export const COLUMNAS_DESCARGA_PAGOS_REGISTRADOS: DescargaColumna[] = [
  { clave: "fechaPago", encabezado: PAGOS_REGISTRADOS_COLUMNAS.fechaPago },
  { clave: "monto", encabezado: PAGOS_REGISTRADOS_COLUMNAS.monto },
  { clave: "metodo", encabezado: PAGOS_REGISTRADOS_COLUMNAS.metodo },
  { clave: "referencia", encabezado: PAGOS_REGISTRADOS_COLUMNAS.referencia },
  { clave: "nota", encabezado: PAGOS_REGISTRADOS_COLUMNAS.nota },
  { clave: "registradoPor", encabezado: PAGOS_REGISTRADOS_COLUMNAS.registradoPor },
  { clave: "registradoEl", encabezado: PAGOS_REGISTRADOS_COLUMNAS.registradoEl },
  { clave: "estado", encabezado: PAGOS_REGISTRADOS_COLUMNAS.estado },
  { clave: "anuladoPor", encabezado: PAGOS_REGISTRADOS_COLUMNAS_ANULACION.anuladoPor },
  { clave: "anuladoEl", encabezado: PAGOS_REGISTRADOS_COLUMNAS_ANULACION.anuladoEl },
  {
    clave: "motivoAnulacion",
    encabezado: PAGOS_REGISTRADOS_COLUMNAS_ANULACION.motivoAnulacion,
  },
];

/**
 * Proyecta un comprobante a una fila de export con valores CRUDOS. El método sale como su
 * ETIQUETA legible (la misma de pantalla); el monto, como STRING intacto.
 *
 * Las celdas ausentes van como `null` (celda vacía), no como `"—"`: el guion es presentación
 * y en una hoja de cálculo se lee como un dato.
 */
export function filaDescargaPagoRegistrado(pago: PagoRegistradoDTO): DescargaFila {
  const anulacion = pago.anulacion;
  return {
    fechaPago: fechaDiaISO(pago.fechaPago),
    monto: pago.monto, // STRING tal cual (money-safe)
    metodo: METODO_LIQUIDACION_LABEL[pago.metodo] ?? pago.metodo,
    referencia: pago.referencia,
    nota: pago.nota,
    registradoPor: pago.registradoPorNombre,
    registradoEl: fechaDiaISO(pago.registradoAt),
    estado: anulacion ? PAGO_ESTADO_LABEL.anulado : PAGO_ESTADO_LABEL.vigente,
    anuladoPor: anulacion ? anulacion.anuladoPorNombre : null,
    anuladoEl: anulacion ? fechaDiaISO(anulacion.anuladoAt) : null,
    motivoAnulacion: anulacion ? anulacion.motivo : null,
  };
}
