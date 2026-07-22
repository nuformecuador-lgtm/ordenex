// Feature 107 (design §2): helpers PUROS (sin side effects) para los campos variables
// `{{clave}}` del cuerpo de una plantilla. No hay lista blanca cerrada: cualquier clave
// bien formada se ACEPTA (Decision humana 4); solo se valida la FORMA (R16).

import { PLANTILLA_VARIABLE_EJEMPLOS } from "@/lib/types/plantilla-variables";

// R14: un placeholder es `{{` + espacios opcionales + `clave` + espacios opcionales +
// `}}`, con `clave` = [a-z0-9_]+ (se admiten espacios internos que se normalizan).
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

// R16: cualquier llave doble `{{ ... }}` cuyo contenido NO sea una unica clave bien
// formada (p. ej. `{{}}`, `{{ }}`, `{{a b}}`, `{{á}}`) es MALFORMADA. Captura el
// contenido bruto para reportarlo.
const LLAVE_DOBLE_RE = /\{\{([^}]*)\}\}/g;
const CLAVE_VALIDA_RE = /^[a-z0-9_]+$/;

/**
 * R15: claves bien formadas del cuerpo, normalizadas (trim + lowercase), DEDUPLICADAS y
 * en orden de aparicion. Esto es lo que se persiste en la columna `variables`.
 */
export function extraerVariables(cuerpo: string): string[] {
  const vistas = new Set<string>();
  const orden: string[] = [];
  for (const match of cuerpo.matchAll(PLACEHOLDER_RE)) {
    const clave = match[1].trim().toLowerCase();
    if (!vistas.has(clave)) {
      vistas.add(clave);
      orden.push(clave);
    }
  }
  return orden;
}

export type ValidarCuerpoResult =
  | { ok: true; variables: string[] }
  | { ok: false; malformadas: string[] };

/**
 * R16: valida SOLO la forma de los placeholders. Detecta llaves dobles malformadas
 * (contenido que, tras `trim`, no cumple [a-z0-9_]+). NO valida pertenencia a un
 * catalogo (Decision humana 4). En caso `ok`, `variables` es el array a persistir (R15).
 */
export function validarCuerpo(cuerpo: string): ValidarCuerpoResult {
  const malformadas: string[] = [];
  for (const match of cuerpo.matchAll(LLAVE_DOBLE_RE)) {
    const contenido = match[1].trim().toLowerCase();
    if (!CLAVE_VALIDA_RE.test(contenido)) {
      malformadas.push(match[0]);
    }
  }
  if (malformadas.length > 0) return { ok: false, malformadas };
  return { ok: true, variables: extraerVariables(cuerpo) };
}

/**
 * R18/R19: sustituye TODAS las ocurrencias de cada placeholder por su valor en `valores`.
 * Una clave bien formada AUSENTE en `valores` cae a un marcador derivado (clave en
 * MAYUSCULAS), nunca rompe la salida. NO altera el texto que no sea un placeholder.
 */
export function renderPlantilla(cuerpo: string, valores: Record<string, string>): string {
  return cuerpo.replace(PLACEHOLDER_RE, (_full, rawClave: string) => {
    const clave = rawClave.trim().toLowerCase();
    const valor = valores[clave];
    return valor !== undefined ? valor : clave.toUpperCase();
  });
}

/**
 * R18: construye la vista previa usando los ejemplos del catalogo. Una clave bien formada
 * FUERA del catalogo se sustituye por el marcador en MAYUSCULAS (via renderPlantilla).
 */
export function previewConEjemplos(cuerpo: string): string {
  return renderPlantilla(cuerpo, PLANTILLA_VARIABLE_EJEMPLOS);
}
