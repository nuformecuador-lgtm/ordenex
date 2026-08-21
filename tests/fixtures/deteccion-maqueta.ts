import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { quitarComentarios } from "./sin-comentarios";

// LOS DETECTORES DE MAQUETA DEL ARNÉS. UNA IMPLEMENTACIÓN, DOS GUARDIAS.
//
// Feature 253 (T8.1, D7 FIRMADA) — estas siete funciones nacieron dentro de
// `tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts` (feature 240) y se mueven aquí
// **sin cambiar una línea de su cuerpo ni de sus comentarios**: esa prosa documenta agujeros
// MEDIDOS, no explica lo obvio.
//
// **Por qué se extraen en vez de copiarse, con la evidencia delante.** El 2026-08-20, revisando la
// guardia de la 240, se encontró la QUINTA forma de replantar la maqueta —**dejar el `import` en
// pie y borrar la invocación**— y se corrigió `invocaElSimbolo` para cazarla. Una copia hecha antes
// de esa fecha seguiría siendo vulnerable, **en verde**, y nadie lo sabría. Duplicar detectores es
// duplicar la superficie donde un agujero puede sobrevivir a su propio arreglo.
//
// La objeción legítima —un fallo aquí rompe las dos guardias a la vez— se cubre con el **bloque 0
// de autocomprobación EN CADA GUARDIA**: ninguna de las dos cree a estas funciones sin ejercitarlas
// antes contra fuente sintético, en las dos direcciones. Una guardia estática rota no falla:
// **calla**, y su verde se lee igual que el bueno.

/** La raíz del repo, desde `tests/fixtures/`. */
const RAIZ = path.resolve(__dirname, "../..");

/** Extensiones que puede tener un módulo de `lib/actions/**`. */
const EXTENSIONES = [".ts", ".tsx"] as const;

/**
 * Motivos que no son motivos. Misma lista, palabra por palabra, que `@sin-superficie`.
 *
 * Un detalle que se corrige respecto del original: allí la rama `-+` iba seguida de `\b`, y una raya
 * SOLA (`-`) no tiene frontera de palabra detrás, así que caía por la regla de longitud en vez de
 * por la de relleno. El agujero no existía —igual se denunciaba— pero el motivo que se le decía al
 * lector era el equivocado.
 */
const MOTIVO_VACIO = /^(?:(?:todo|tbd|fixme|xxx|pendiente|por decidir|n\/a)\b|-+$)/i;
const MOTIVO_MINIMO = 20;

/**
 * Una arista de import: qué símbolos trae un archivo, de qué módulo y si es de TIPO.
 *
 * ⚠️ `import type { … }` se marca aparte y **no cuenta como cableado**, y es la distinción que hace
 * útil a todo este archivo: `RechazarNovedadModal` importa `RechazarNovedadActionResult` con `import
 * type` del MISMO módulo del que importa la acción. Si los dos contaran igual, una pantalla que sólo
 * importara el TIPO del resultado —sin llamar a nada— pasaría por cableada. Un tipo se borra en
 * compilación: no dispara ninguna operación.
 */
export interface AristaImport {
  readonly modulo: string;
  readonly simbolos: readonly string[];
  readonly esTipo: boolean;
}

/** `import { a, b as c } from "…"`, en una línea o en varias. */
export const IMPORT_NOMBRADO =
  /import\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*["']([^"'\n]+)["']/g;

export function aristasDeImport(codigo: string): AristaImport[] {
  const aristas: AristaImport[] = [];
  for (const m of codigo.matchAll(IMPORT_NOMBRADO)) {
    const simbolos = m[2]
      .split(",")
      .map((crudo) => crudo.trim())
      // `import { x as y }` cablea `x`: el nombre local da igual, lo que se dispara es el export.
      // Y un `type X` suelto dentro de unas llaves mixtas tampoco cablea nada.
      .filter((crudo) => crudo.length > 0 && !/^type\s/.test(crudo))
      .map((crudo) => crudo.split(/\s+as\s+/)[0].trim())
      .filter((s) => s.length > 0);
    aristas.push({
      modulo: m[3],
      simbolos,
      esTipo: Boolean(m[1]),
    });
  }
  return aristas;
}

/**
 * ¿`codigo` importa `simbolo` DE `modulo` como valor (no como tipo)?
 *
 * El módulo se compara contra el especificador con alias (`@/lib/actions/x`) y contra el propio
 * `lib/actions/x`, con la extensión opcional. No se admite un `import * as`: importar el espacio de
 * nombres entero no dice que se use ESA acción, y aceptarlo dejaría un agujero por el que pasaría
 * cualquier módulo con sólo nombrarlo.
 */
export function importaElSimbolo(
  codigo: string,
  modulo: string,
  simbolo: string,
): boolean {
  const admitidos = new Set([
    modulo,
    `@/${modulo}`,
    `${modulo}.ts`,
    `@/${modulo}.ts`,
  ]);
  return aristasDeImport(codigo).some(
    (a) => !a.esTipo && admitidos.has(a.modulo) && a.simbolos.includes(simbolo),
  );
}

/**
 * ¿`codigo` LLAMA a `simbolo`? No «lo nombra»: lo INVOCA.
 *
 * ⏳ 2026-08-20 — ESTA FUNCIÓN NACE DE UN AGUJERO MEDIDO, y conviene que quede escrito cuál.
 * El frente 2 preguntaba sólo `importaElSimbolo`, aunque su mensaje dijera «llama». Con eso, la
 * QUINTA forma de replantar la maqueta —**dejar el `import` en pie y borrar la invocación**—
 * pasaba las dos guardias en verde. Y la variante ingenua (el import huérfano) también, porque
 * `"lint": "eslint"` no lleva `--max-warnings=0` y `no-unused-vars` sale como *warning*. Quien
 * mataba esa maqueta era un test de componente: exactamente la red que D3 declaró insuficiente,
 * porque un test de componente afirma que el botón llama a lo que el test le pasa como doble.
 *
 * QUÉ MIDE, en orden, y por qué cada paso:
 *   1. se quitan los COMENTARIOS: la prosa del catálogo nombra las seis acciones, y sin esto
 *      cualquier módulo pasaría por llamarlas sólo con mencionarlas;
 *   2. se quitan los `import` ENTEROS: si no, `import { rechazarNovedad }` contaría como llamada
 *      en cuanto el símbolo fuera seguido de un paréntesis en otra parte de la línea. Es la
 *      precaución que convierte esto en un detector de invocación y no en otro de importación;
 *   3. se busca `simbolo` seguido de `(`. Una Server Action se dispara llamándola.
 *
 * ⚠️ POR QUÉ EXIGIR LA INVOCACIÓN NO ES FRÁGIL AQUÍ, medido y no supuesto. La objeción legítima es
 * el símbolo que se pasa por referencia (`onConfirm={rechazarNovedad}`) o el re-export, que esta
 * forma no vería. Se censaron las SEIS acciones de la tabla en el árbol el 2026-08-20 y las seis se
 * invocan directamente —`await rechazarNovedad({…})`, `await gestionarDesdeAyuda(…)`,
 * `listarNotasOrden({…})`…—: ninguna viaja como referencia y ninguna se re-exporta. Si algún día
 * una lo hiciera, este frente se pondría rojo y el arreglo sería enseñarle esa forma, NO relajarlo
 * a «la importa»: eso es precisamente el agujero que esta función cierra.
 */
export function invocaElSimbolo(codigo: string, simbolo: string): boolean {
  const sinComentarios = quitarComentarios(codigo);
  const sinImports = sinComentarios.replace(IMPORT_NOMBRADO, " ");
  return new RegExp(`\\b${simbolo}\\s*\\(`).test(sinImports);
}

/** El fuente de un módulo de `lib/actions/**`, o `null` si no existe ningún archivo con ese nombre. */
export function fuenteDelModulo(modulo: string): string | null {
  for (const ext of EXTENSIONES) {
    const completo = path.join(RAIZ, `${modulo}${ext}`);
    if (existsSync(completo)) return readFileSync(completo, "utf8");
  }
  return null;
}

/** ¿El fuente declara `export async function <simbolo>`? (sin comentarios: la prosa los nombra). */
export function exportaLaAccion(fuente: string, simbolo: string): boolean {
  const codigo = quitarComentarios(fuente);
  return new RegExp(`export\\s+async\\s+function\\s+${simbolo}\\b`).test(codigo);
}

/** ¿El fuente es un módulo de servidor? Sin `"use server"` no hay Server Action que disparar. */
export function esModuloDeServidor(fuente: string): boolean {
  return /^\s*["']use server["']/m.test(fuente);
}

/**
 * R39 — qué le pasa a un `sinOperacion` para no valer. Cadena vacía = está bien.
 *
 * Se devuelve el MOTIVO del rechazo y no un booleano: una guardia que sólo dice «no» obliga a leer
 * su fuente para saber qué arreglar.
 */
export function faltaDelMotivo(motivo: string): string {
  const limpio = motivo.trim();
  if (limpio.length === 0) return "está vacío";
  if (MOTIVO_VACIO.test(limpio)) return `es de relleno (\`${limpio}\`)`;
  if (limpio.length < MOTIVO_MINIMO)
    return `tiene ${limpio.length} caracteres y el mínimo son ${MOTIVO_MINIMO}`;
  return "";
}
