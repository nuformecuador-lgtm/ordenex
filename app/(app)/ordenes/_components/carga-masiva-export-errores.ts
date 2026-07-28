// Feature 143 — Composición de las filas del export XLSX de "órdenes con error"
// de la carga masiva. Módulo PURO: sin React, sin DOM, sin `any`, y NO importa
// `exceljs` (el binario lo construye `buildXlsxRows`, con import dinámico — R19).
//
// Estilo defensivo (igual que `clasificarBulkSummary`): ante datos inesperados
// NUNCA lanza; degrada la fila y sigue.
import type { OrdenConError } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import { formatErrores } from "@/app/(app)/ordenes/_components/carga-masiva-errores-formato";
import { ORDENES_BULK_FIELDS } from "@/app/(app)/ordenes/_components/carga-masiva-fields";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import type { XlsxTemplateField } from "@/lib/utils/xlsx-template";

/** Cabecera de la ÚNICA columna extra, con el motivo del error (decisión D-A). */
export const COLUMNA_MOTIVO_ERROR = "motivo_error";

/**
 * Columnas del archivo exportado (R1): las 8 de la plantilla vigente, en el
 * orden de `ORDENES_BULK_FIELDS`, y `motivo_error` como ÚLTIMA columna.
 *
 * Las 8 primeras se copian SIN `example` y SIN `label`: la cabecera debe ser la
 * clave máquina exacta (R2) para que el archivo descargado se pueda volver a
 * subir (R14). Añadir aquí una etiqueta o un sufijo es exactamente el bug de la
 * feature 58.
 */
export const ERRORES_EXPORT_FIELDS: XlsxTemplateField[] = [
  ...ORDENES_BULK_FIELDS.map((field) => ({ key: field.key })),
  { key: COLUMNA_MOTIVO_ERROR },
];

/** Claves de las 8 columnas de la plantilla, en orden (R1, R4). */
const CLAVES_PLANTILLA = ORDENES_BULK_FIELDS.map((field) => field.key);

/** Separador entre el número de fila y el detalle del motivo (decisión G-2). */
const SEPARADOR_PREFIJO = " — ";

/**
 * Texto de la celda `motivo_error` (R6, R7, R8, R22):
 * `Fila <N> — <detalle>`, donde `<detalle>` es EXACTAMENTE el texto de la
 * columna "Motivo" de la tabla de órdenes con error (`formatErrores`), o el
 * motivo genérico si la fila no aporta mensajes.
 *
 * El prefijo se antepone al detalle YA compuesto, así que aparece UNA SOLA VEZ
 * aunque el detalle agrupe varios campos y varios mensajes (R6). Sin número de
 * fila conocido no se inventa ninguno: la celda lleva solo el detalle (R22).
 */
export function motivoErrorDeFila(error: OrdenConError): string {
  const detalle = formatErrores(error.errores ?? {});
  return error.fila != null ? `Fila ${error.fila}${SEPARADOR_PREFIJO}${detalle}` : detalle;
}

/**
 * Compone las filas del export cruzando la clasificación con las filas crudas
 * del archivo original (R3-R8, R22).
 *
 * El cruce `OrdenConError.fila` ↔ `FilaParseada.linea` es válido porque
 * `procesarEnChunks` REMAPEA la fila relativa al lote a la línea original del
 * archivo (`carga-masiva-chunks.ts`, "resultados.push({ ...rr, fila: lote[i].linea })").
 * Si ese remapeo desapareciera, el export saldría con valores de OTRAS filas:
 * lo blinda `tests/components/CargaMasivaExportErrores.test.ts`.
 */
export function construirFilasErrorExport(
  errores: OrdenConError[],
  filas: FilaParseada[],
): Array<Record<string, string>> {
  // Índice por línea original. Ante `linea` repetida gana la PRIMERA (mismo
  // criterio que `dedupPorRemision`).
  const porLinea = new Map<number, Record<string, string>>();
  for (const fila of filas) {
    if (typeof fila?.linea !== "number" || porLinea.has(fila.linea)) continue;
    porLinea.set(fila.linea, fila.row ?? {});
  }

  const salida: Array<Record<string, string>> = [];
  // Se conserva el orden de la clasificación (R3): una fila de datos por error.
  for (const error of errores) {
    const cruda = error.fila != null ? porLinea.get(error.fila) : undefined;
    const registro: Record<string, string> = {};

    if (cruda !== undefined) {
      // R4: valores CRUDOS del archivo original; vacío si la clave no está.
      for (const clave of CLAVES_PLANTILLA) {
        registro[clave] = cruda[clave] ?? "";
      }
    } else {
      // R5: sin correspondencia (fila `null` o línea inexistente) la fila se
      // emite igual, vacía salvo el num_remision conocido. Nunca se interrumpe
      // la generación del resto del archivo.
      for (const clave of CLAVES_PLANTILLA) {
        registro[clave] = "";
      }
      registro.num_remision = error.numRemision ?? "";
    }

    registro[COLUMNA_MOTIVO_ERROR] = motivoErrorDeFila(error);
    salida.push(registro);
  }

  return salida;
}

/** Cero-rellena a 2 dígitos (componentes locales de la fecha). */
function dos(valor: number): string {
  return String(valor).padStart(2, "0");
}

/**
 * Nombre del archivo descargado (R10): `ordenes-con-error-AAAAMMDD-HHmm.xlsx`,
 * con fecha y hora LOCALES. Recibe la fecha por parámetro para ser determinista
 * en test.
 */
export function nombreArchivoErrores(fecha: Date): string {
  const yyyy = fecha.getFullYear();
  const mm = dos(fecha.getMonth() + 1);
  const dd = dos(fecha.getDate());
  const hh = dos(fecha.getHours());
  const mi = dos(fecha.getMinutes());
  return `ordenes-con-error-${yyyy}${mm}${dd}-${hh}${mi}.xlsx`;
}
