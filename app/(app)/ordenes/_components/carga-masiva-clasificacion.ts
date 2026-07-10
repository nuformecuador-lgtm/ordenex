// Feature 29 — Helper puro de presentación (frontend). Clasifica el
// `BulkSummary` (feature 15/16) que llega como `result.data: unknown` desde
// `BulkUpload` en tres grupos disjuntos: nuevas / existentes / con error
// (R1, R2, R3). Guards defensivos, sin `any`, sin lanzar (R15).

/** Orden ya existente (fila `resultado === "duplicada"`), solo lectura. */
export interface OrdenExistente {
  numRemision: string;
  estatus: string | null;
}

/** Fila con error de validación (`resultado === "error"`), solo lectura. */
export interface OrdenConError {
  fila: number | null;
  numRemision: string;
  errores: Record<string, string[]>; // `{}` si no vino
}

/** Resultado de clasificar `BulkSummary.filas` (design D2). */
export interface ClasificacionCarga {
  numRemisionesNuevas: string[]; // resultado === "creada"
  existentes: OrdenExistente[]; // resultado === "duplicada"
  errores: OrdenConError[]; // resultado === "error"
}

/** Grupos vacíos: forma canónica para `data`/`filas` inesperados (R2). */
function clasificacionVacia(): ClasificacionCarga {
  return { numRemisionesNuevas: [], existentes: [], errores: [] };
}

/** Narrowing a `Record<string, unknown>` sin `any`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** Normaliza `estatus` a `string | null` (ausente/no-string → `null`). */
function toEstatus(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Toma `errores` solo si es objeto de arrays de strings; si no, `{}` (R3, R19). */
function toErrores(value: unknown): Record<string, string[]> {
  const record = asRecord(value);
  if (record === null) return {};
  const errores: Record<string, string[]> = {};
  for (const [campo, mensajes] of Object.entries(record)) {
    if (Array.isArray(mensajes)) {
      errores[campo] = mensajes.filter(
        (m): m is string => typeof m === "string",
      );
    }
  }
  return errores;
}

/**
 * Clasifica `data.filas` (≈ `BulkSummary.filas`) en tres grupos disjuntos según
 * `resultado`. Sigue el patrón defensivo de `parseResumen`/`extractNumRemisionesCreadas`:
 * `data` no-objeto o `filas` no-array → los tres grupos vacíos (R2).
 */
export function clasificarBulkSummary(data: unknown): ClasificacionCarga {
  const record = asRecord(data);
  if (record === null) return clasificacionVacia();

  const { filas } = record;
  if (!Array.isArray(filas)) return clasificacionVacia();

  const resultado = clasificacionVacia();

  for (const fila of filas) {
    const row = asRecord(fila);
    if (row === null) continue;

    const numRemision =
      typeof row.numRemision === "string" ? row.numRemision : "";

    if (row.resultado === "creada") {
      if (numRemision !== "") resultado.numRemisionesNuevas.push(numRemision);
    } else if (row.resultado === "duplicada") {
      resultado.existentes.push({
        numRemision,
        estatus: toEstatus(row.estatus),
      });
    } else if (row.resultado === "error") {
      resultado.errores.push({
        fila: typeof row.fila === "number" ? row.fila : null,
        numRemision,
        errores: toErrores(row.errores),
      });
    }
  }

  return resultado;
}
