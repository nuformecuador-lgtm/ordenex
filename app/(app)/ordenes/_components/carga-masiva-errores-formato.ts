// Feature 143 — Formato del MOTIVO de una fila con error, en un módulo PURO
// (sin React, sin DOM). Vivía dentro de `OrdenesConErrorTabla.tsx` (feature 29),
// un componente `"use client"`; se extrae aquí porque ahora tiene dos
// consumidores: la tabla de la vista previa y el compositor de filas del export
// a XLSX (`carga-masiva-export-errores.ts`), que debe ser testeable sin React.
//
// Un ÚNICO punto de verdad: si cambia el texto, cambia a la vez en la tabla y en
// el archivo descargado, sin desincronización posible (design.md §3).

/** Motivo genérico cuando la fila no trae detalle de errores (R7). */
export const MOTIVO_GENERICO = "Error de validación";

/**
 * Aplana el mapa `campo → mensajes[]` a un texto legible y DETERMINISTA (R8):
 * los campos se separan con `"; "` y los mensajes de un mismo campo con `", "`,
 * p. ej. `"num_remision: obligatorio; telefono: formato inválido"`. Si el mapa
 * está vacío (o sus entradas no aportan mensaje), devuelve `MOTIVO_GENERICO`.
 */
export function formatErrores(errores: Record<string, string[]>): string {
  const partes: string[] = [];
  for (const [campo, mensajes] of Object.entries(errores)) {
    if (mensajes.length > 0) {
      partes.push(`${campo}: ${mensajes.join(", ")}`);
    }
  }
  return partes.length > 0 ? partes.join("; ") : MOTIVO_GENERICO;
}
