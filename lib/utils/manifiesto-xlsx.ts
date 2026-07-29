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
 * Columnas del manifiesto, en su orden. Las cabeceras son las claves máquina del requisito
 * (`num_guia`, `num_remision`, …), no etiquetas de presentación: el manifiesto es un documento
 * operativo estable, no una vista.
 *
 * REGLA VIGENTE (feature 160/R28, design 160 §6.3 — DEROGA y REEMPLAZA los R2/R11 de la 148,
 * decisión del humano del 2026-07-29): **el manifiesto refleja los datos de la orden**, y este
 * conjunto es ABIERTO — **crece** cuando la orden gana un dato nuevo. Ni este módulo ni sus
 * pruebas pueden afirmar "exactamente N columnas"; las pruebas verifican que ciertas columnas
 * ESTÁN, con su clave y su orden relativo, nunca que no haya otras.
 *
 * Lo que se derogó es el número cerrado, NO el filtro: cualquier campo que no esté en esta
 * lista sigue sin emitirse, y los identificadores internos, las banderas de borrado y los datos
 * que no son de la orden siguen prohibidos.
 */
export const COLUMNAS_MANIFIESTO: XlsxColumn[] = [
  { key: "numGuia", header: "num_guia" },
  { key: "numRemision", header: "num_remision" },
  { key: "destinatario", header: "destinatario" },
  { key: "telefono", header: "telefono" },
  { key: "direccion", header: "direccion" },
  { key: "zona", header: "zona" },
  { key: "monto", header: "monto" },
  // Feature 160 (R28a): dato propio de la orden -> columna propia del manifiesto. Va tras
  // `monto` y ANTES del bloque de logística del movimiento (origen/destino/responsable/fecha),
  // que describe la OPERACIÓN y no la orden.
  { key: "intentos", header: "intentos" },
  { key: "origen", header: "origen" },
  { key: "destino", header: "destino" },
  { key: "responsable", header: "responsable" },
  { key: "fecha", header: "fecha" },
];

/**
 * Proyecta la fila del dominio a celdas. Se enumeran las propiedades una a una a propósito: si
 * mañana el DTO creciera, el archivo NO filtraría el campo nuevo en silencio — habría que
 * declararlo aquí y en `COLUMNAS_MANIFIESTO`, que es exactamente lo que pide la regla de 160.
 * `null` viaja tal cual y el generador lo emite como celda vacía (R5 sin guía, R7 sin monto,
 * dirección ausente); `intentos` NUNCA es null: sin intentos emite `0` (160/R28a).
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
    intentos: fila.intentos, // feature 160/R28a
    origen: fila.origen,
    destino: fila.destino,
    responsable: fila.responsable,
    fecha: fila.fecha,
  };
}

/**
 * Construye el binario `.xlsx` del manifiesto: una hoja, cabecera con las columnas de
 * `COLUMNAS_MANIFIESTO` y una fila por orden, en el orden recibido (R3, R13).
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
