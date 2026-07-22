// Feature 107 (design §2): catalogo ABIERTO y data-driven de variables disponibles para
// insertar en el cuerpo de una plantilla. Patron "fuente de verdad TS" de lib/types/
// roles.ts, pero SIN union type cerrado: `key` es `string`, ampliar es agregar una fila
// (Decision humana 4; R13). Server-safe (sin side effects), importable por service y UI.

export interface PlantillaVariable {
  /** Clave dentro de `{{ }}`, formato [a-z0-9_]+. */
  key: string;
  /** Etiqueta legible para la UI. */
  label: string;
  /** Valor de muestra para la vista previa (R18). */
  ejemplo: string;
}

// R13: catalogo de variables DISPONIBLES para insertar. ABIERTO: añadir una fila NO
// obliga a migrar codigo ni tipos. `usuario`/`cod` son solo la SEMILLA de EJEMPLO (no un
// catalogo fijo); el conjunto se amplia libremente agregando entradas aqui.
export const PLANTILLA_VARIABLES = [
  { key: "usuario", label: "Nombre del cliente", ejemplo: "Juan" },
  { key: "cod", label: "Codigo de la orden", ejemplo: "ABC123" },
] satisfies PlantillaVariable[];

/** Claves del catalogo, para lookup O(1) en el render de la vista previa (R18). */
export const PLANTILLA_VARIABLE_KEYS = new Set(PLANTILLA_VARIABLES.map((v) => v.key));

/** Mapa clave -> valor de ejemplo, usado por la preview (R18). */
export const PLANTILLA_VARIABLE_EJEMPLOS: Record<string, string> = Object.fromEntries(
  PLANTILLA_VARIABLES.map((v) => [v.key, v.ejemplo]),
);
