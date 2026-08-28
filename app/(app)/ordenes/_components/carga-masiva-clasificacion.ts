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

/**
 * FEATURE 304 — una fila CREADA cuyo monto entró redondeado (aviso `montoAjustado` de la 299).
 *
 * NO es un cuarto grupo: estas filas son un SUBCONJUNTO de las creadas y siguen contadas en
 * `numRemisionesNuevas`. La orden se creó; lo único que pasó es que el monto que se guardó no
 * es byte a byte el del archivo, y eso hay que decirlo o la tienda ve un número que no mandó.
 */
export interface OrdenMontoAjustado {
  fila: number | null;
  numRemision: string;
  /** Lo que traía el archivo de la tienda (`11898.81`). */
  original: number;
  /** Lo que se guardó, y lo único que el mensajero podrá cobrar (`11899`). */
  aplicado: number;
}

/** Resultado de clasificar `BulkSummary.filas` (design D2). */
export interface ClasificacionCarga {
  numRemisionesNuevas: string[]; // resultado === "creada"
  existentes: OrdenExistente[]; // resultado === "duplicada"
  errores: OrdenConError[]; // resultado === "error"
  /**
   * Feature 304: las creadas que entraron con el monto redondeado. Vacío en una carga normal
   * —ninguna fila con céntimos—, que es el caso de casi todas: sin ajustes, el resumen se
   * pinta exactamente igual que antes de esta ficha.
   */
  ajustadas: OrdenMontoAjustado[];
}

/** Grupos vacíos: forma canónica para `data`/`filas` inesperados (R2). */
function clasificacionVacia(): ClasificacionCarga {
  return { numRemisionesNuevas: [], existentes: [], errores: [], ajustadas: [] };
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

/** Normaliza `fila` a `number | null` (ausente/no-number → `null`). */
function toFila(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Feature 304: toma el aviso de redondeo de la fila (`montoAjustado` de la 299) solo si trae
 * los DOS montos como números finitos, y solo si son DISTINTOS.
 *
 * Lo de «distintos» no es paranoia: con los dos montos iguales la tabla diría «de ₡11.899 a
 * ₡11.899», que es exactamente la pantalla que se contradice sola de las fichas 299/300. Un
 * aviso que no informa de ningún cambio no se pinta.
 */
function toMontoAjustado(value: unknown): { original: number; aplicado: number } | null {
  const record = asRecord(value);
  if (record === null) return null;
  const { original, aplicado } = record;
  if (typeof original !== "number" || !Number.isFinite(original)) return null;
  if (typeof aplicado !== "number" || !Number.isFinite(aplicado)) return null;
  if (original === aplicado) return null;
  return { original, aplicado };
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
 *
 * Feature 304: además saca a la luz `ajustadas`, que NO es un cuarto grupo sino una vista de
 * las creadas que traían céntimos. Los tres grupos y sus conteos no cambian.
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
      if (numRemision === "") continue; // una creada sin remisión no se puede nombrar
      resultado.numRemisionesNuevas.push(numRemision);
      // Feature 304: el aviso de redondeo viaja EN la fila creada (299) y hasta aquí llegaba
      // para morir — de la fila creada solo se conservaba la remisión. Se transporta con la
      // misma cautela que el resto: si no viene, o no trae los dos montos, no hay nada que
      // contar y la clasificación queda como siempre.
      const ajuste = toMontoAjustado(row.montoAjustado);
      if (ajuste !== null) {
        resultado.ajustadas.push({ fila: toFila(row.fila), numRemision, ...ajuste });
      }
    } else if (row.resultado === "duplicada") {
      resultado.existentes.push({
        numRemision,
        estatus: toEstatus(row.estatus),
      });
    } else if (row.resultado === "error") {
      resultado.errores.push({
        fila: toFila(row.fila),
        numRemision,
        errores: toErrores(row.errores),
      });
    }
  }

  return resultado;
}
