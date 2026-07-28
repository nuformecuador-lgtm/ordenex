/**
 * Feature 148 (T8) — módulo PURO del manifiesto: convierte las filas que devuelve la
 * Server Action `obtenerManifiesto` en el binario `.xlsx` y decide el nombre del
 * archivo. Sin DOM y sin React: el side effect de la descarga vive en
 * `components/shared/descargar-blob.ts` y el binario se arma en el NAVEGADOR
 * (design.md §0/D1), nunca en el servidor ni en almacenamiento.
 */
import type { ManifiestoFilaDTO, ManifiestoFlujo } from "@/lib/types/manifiesto";
import {
  buildXlsxRows,
  type XlsxCellValue,
  type XlsxColumn,
} from "@/lib/utils/xlsx-template";

/** Nombre de la única hoja del libro (R13). */
export const MANIFIESTO_SHEET = "Manifiesto";

/**
 * R2 — Las EXACTAMENTE 11 columnas del manifiesto, en el orden pedido. Las cabeceras
 * son las claves máquina del requisito (`num_guia`, `num_remision`, …), no etiquetas
 * de presentación: el manifiesto es un documento operativo estable, no una vista.
 * R11 — Cualquier campo que no esté en esta lista NO se emite, aunque viajara en la
 * fila.
 */
export const COLUMNAS_MANIFIESTO: XlsxColumn[] = [
  { key: "numGuia", header: "num_guia" },
  { key: "numRemision", header: "num_remision" },
  { key: "destinatario", header: "destinatario" },
  { key: "telefono", header: "telefono" },
  { key: "direccion", header: "direccion" },
  { key: "zona", header: "zona" },
  { key: "monto", header: "monto" },
  { key: "origen", header: "origen" },
  { key: "destino", header: "destino" },
  { key: "responsable", header: "responsable" },
  { key: "fecha", header: "fecha" },
];

/**
 * Proyecta la fila del dominio a celdas. Se enumeran las 11 propiedades una a una a
 * propósito: si mañana el DTO creciera, el archivo NO filtraría el campo nuevo (R11).
 * `null` viaja tal cual y el generador lo emite como celda vacía (R5 sin guía, R7 sin
 * monto, dirección ausente).
 */
function toRow(fila: ManifiestoFilaDTO): Record<string, XlsxCellValue> {
  return {
    numGuia: fila.numGuia,
    numRemision: fila.numRemision,
    destinatario: fila.destinatario,
    telefono: fila.telefono,
    direccion: fila.direccion,
    zona: fila.zona,
    monto: fila.monto,
    origen: fila.origen,
    destino: fila.destino,
    responsable: fila.responsable,
    fecha: fila.fecha,
  };
}

/**
 * Construye el binario `.xlsx` del manifiesto: una hoja, cabecera con las 11 columnas
 * de R2 y una fila por orden, en el orden recibido (R3, R13).
 *
 * @throws si `filas` está vacío. R17: sin filas NO se ofrece la descarga y NO se
 * genera archivo alguno; el consumidor no debe llegar hasta aquí, pero la utilidad
 * protege su contrato (mismo criterio que `buildXlsxTemplate`).
 */
export async function buildManifiestoXlsx(
  filas: ManifiestoFilaDTO[],
): Promise<ArrayBuffer> {
  if (filas.length === 0) {
    throw new Error(
      "buildManifiestoXlsx: no hay filas de manifiesto que descargar",
    );
  }
  return buildXlsxRows(COLUMNAS_MANIFIESTO, filas.map(toRow), MANIFIESTO_SHEET);
}

/**
 * R14 — `manifiesto-<flujo>-<YYYY-MM-DD>.xlsx`. La `fecha` es la de la OPERACIÓN
 * (calendario de Costa Rica) que ya viene calculada en las filas, no una fecha nueva:
 * así el nombre del archivo y su columna `fecha` nunca discrepan por el cruce de
 * medianoche entre la lectura y la descarga.
 */
export function manifiestoFileName(
  flujo: ManifiestoFlujo,
  fecha: string,
): string {
  return `manifiesto-${flujo}-${fecha}.xlsx`;
}
