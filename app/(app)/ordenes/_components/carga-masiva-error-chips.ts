// Helper puro de presentación (frontend). A partir de las filas con error de la
// validación previa (dry-run), agrupa los errores por TIPO (p. ej. "provincia no
// encontrada", "distrito no encontrado en el cantón") en "chips" con su conteo, y
// permite reordenar el resumen para llevar al principio las filas de un tipo dado.
// Sin estado, sin efectos: fácil de testear.
import type { OrdenConError } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

export interface ErrorChip {
  /** Identificador estable del tipo de error (`campo::mensaje canónico`). */
  key: string;
  /** Texto legible mostrado en el chip. */
  label: string;
  /** Número de filas afectadas por este tipo de error. */
  count: number;
}

/**
 * Canoniza un mensaje para agrupar por TIPO y no por valor: reemplaza los
 * fragmentos entre comillas simples (nombres variables, p. ej. el distrito en
 * "el distrito 'X' no pertenece a ninguna zona") por un marcador estable. Así
 * todas las filas del mismo problema caen en el mismo chip.
 */
function canonizarMensaje(mensaje: string): string {
  return mensaje.replace(/'[^']*'/g, "'…'").trim();
}

/**
 * Conjunto de claves `campo::mensajeCanónico` presentes en una fila (sin
 * repetir). Una fila puede tener varios errores (p. ej. geografía + monto).
 */
export function clavesDeFila(fila: OrdenConError): Set<string> {
  const claves = new Set<string>();
  for (const [campo, mensajes] of Object.entries(fila.errores)) {
    for (const mensaje of mensajes) {
      const canon = canonizarMensaje(mensaje);
      if (canon !== "") claves.add(`${campo}::${canon}`);
    }
  }
  return claves;
}

/** Deriva la etiqueta legible (mensaje canónico con inicial en mayúscula). */
function labelDeClave(clave: string): string {
  const sep = clave.indexOf("::");
  const mensaje = sep >= 0 ? clave.slice(sep + 2) : clave;
  return mensaje.charAt(0).toUpperCase() + mensaje.slice(1);
}

/**
 * Construye un chip por cada TIPO de error, ordenados de mayor a menor conteo
 * (desempate alfabético por etiqueta). Filas sin errores no aportan chips.
 */
export function construirChips(errores: OrdenConError[]): ErrorChip[] {
  const conteo = new Map<string, number>();
  for (const fila of errores) {
    for (const clave of clavesDeFila(fila)) {
      conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
    }
  }
  return [...conteo.entries()]
    .map(([key, count]) => ({ key, label: labelDeClave(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Reordena (estable, sin mutar) las filas con error para llevar al principio las
 * que tienen el chip `chipKey`. `null` → se conserva el orden original.
 */
export function ordenarPorChip(
  errores: OrdenConError[],
  chipKey: string | null,
): OrdenConError[] {
  if (chipKey === null) return errores;
  const conChip: OrdenConError[] = [];
  const sinChip: OrdenConError[] = [];
  for (const fila of errores) {
    if (clavesDeFila(fila).has(chipKey)) conChip.push(fila);
    else sinChip.push(fila);
  }
  return [...conChip, ...sinChip];
}
