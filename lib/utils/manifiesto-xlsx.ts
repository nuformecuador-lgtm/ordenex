/**
 * Feature 148 (T8) — módulo PURO del manifiesto: convierte las filas que devuelve la
 * Server Action `obtenerManifiesto` en el binario `.xlsx` y decide el nombre del
 * archivo. Sin DOM y sin React: el side effect de la descarga vive en
 * `components/shared/descargar-blob.ts` y el binario se arma en el NAVEGADOR
 * (design.md §0/D1), nunca en el servidor ni en almacenamiento.
 */
import { COLUMNAS_MANIFIESTO } from "@/lib/manifiesto/columnas-publicadas";
import type { ManifiestoFilaDTO, ManifiestoFlujo } from "@/lib/types/manifiesto";
import {
  buildXlsxRows,
  type XlsxCellValue,
  type XlsxColumn,
} from "@/lib/utils/xlsx-template";

/** Nombre de la única hoja del libro (R13). */
export const MANIFIESTO_SHEET = "Manifiesto";

/**
 * El catálogo de columnas publicadas vive en `lib/manifiesto/columnas-publicadas.ts` (feature
 * 194): es un DATO que también consume la UI del selector de columnas, que no debe depender del
 * generador de binarios. Se RE-EXPORTA aquí para no romper a ningún consumidor existente que ya
 * lo importaba desde este módulo.
 */
export { COLUMNAS_MANIFIESTO };

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
 * Selecciona las columnas a emitir a partir de las claves pedidas (feature 194 §7).
 *
 * El filtro va SOBRE `COLUMNAS_MANIFIESTO`, jamás sobre la entrada: por construcción el orden
 * relativo publicado se conserva sea cual sea el orden en que llegan las claves (194/R8), y una
 * clave que no corresponda a ninguna columna publicada se ignora sin ruido.
 *
 * Si el filtro no deja ninguna columna, se devuelve el conjunto COMPLETO (194/R13): el fallo
 * sería un archivo que el usuario no obtiene por una preferencia corrupta. El `throw` de
 * `buildXlsxRows` con 0 columnas sigue vivo como red de seguridad de sus otros llamadores.
 */
function columnasAEmitir(clavesVisibles?: readonly string[]): XlsxColumn[] {
  if (clavesVisibles === undefined) return COLUMNAS_MANIFIESTO;
  const elegidas = COLUMNAS_MANIFIESTO.filter((columna) =>
    clavesVisibles.includes(columna.key),
  );
  return elegidas.length === 0 ? COLUMNAS_MANIFIESTO : elegidas;
}

/**
 * Construye el binario `.xlsx` del manifiesto: una hoja, cabecera con las columnas de
 * `COLUMNAS_MANIFIESTO` y una fila por orden, en el orden recibido (R3, R13).
 *
 * @param filas filas del manifiesto ya devueltas por el servidor, en su orden.
 * @param clavesVisibles feature 194 — subconjunto OPCIONAL de `key`s de `COLUMNAS_MANIFIESTO`
 * que el usuario quiere ver en el archivo. Si se OMITE, se emiten todas las columnas
 * publicadas, exactamente como hasta ahora (194/R24). Si se pasa, se emiten las columnas
 * publicadas cuyas claves figuren en la lista, siempre en el orden de `COLUMNAS_MANIFIESTO`
 * (194/R7, R8, R9). Si ninguna clave casa, se DEGRADA a "todas las publicadas" en lugar de
 * fallar (194/R13). El filtrado ocurre en las columnas, no en los datos: `toRow` sigue
 * proyectando la fila entera y `buildXlsxRows` ignora las claves no declaradas.
 *
 * @throws si `filas` está vacío. R17: sin filas NO se ofrece la descarga y NO se
 * genera archivo alguno; el consumidor no debe llegar hasta aquí, pero la utilidad
 * protege su contrato (mismo criterio que `buildXlsxTemplate`).
 */
export async function buildManifiestoXlsx(
  filas: ManifiestoFilaDTO[],
  clavesVisibles?: readonly string[],
): Promise<ArrayBuffer> {
  if (filas.length === 0) {
    throw new Error(
      "buildManifiestoXlsx: no hay filas de manifiesto que descargar",
    );
  }
  return buildXlsxRows(
    columnasAEmitir(clavesVisibles),
    filas.map(toRow),
    MANIFIESTO_SHEET,
  );
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
