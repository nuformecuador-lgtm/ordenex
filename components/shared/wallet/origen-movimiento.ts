// Ficha 458-A (TA.2 pantalla, design §3.3, R5–R8, R3) — el ORIGEN de una fila de la wallet, tal
// como se PINTA y se DESCARGA. Modulo PURO (sin React): lo comparten las tablas de los tres libros y
// sus descargas, para que la celda y la columna del archivo no puedan decir cosas distintas.
//
// Desde la 458-A el servidor adjunta a cada fila `origen: { texto, enlace }` ya compuesto
// (`OrigenLegibleService`): «Cierre del día · 2026-09-12 · Juan Pérez Mora», «Gestión de orden ·
// cobro por rechazo · guía 4321». Aqui solo se le añade la descripcion libre de la fila, como se
// hacia antes con el rotulo a secas. El identificador interno viaja SOLO en `enlace.href` (D1).

import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { OrigenLegibleDTO } from "@/lib/types/wallet-origen";

/** El separador de la casa entre el origen y la descripcion. */
const SEPARADOR = " · ";

/**
 * Lo minimo de una fila de cualquiera de los tres libros para pintar su origen. `origen` es
 * opcional en el TIPO porque las columnas se declaran sobre el DTO del libro; las 9 actions que
 * listan filas lo adjuntan siempre en la rama `ok`.
 */
export type FilaConOrigenLegible = {
  origenTipo: WalletOrigenTipo;
  descripcion: string | null;
  origen?: OrigenLegibleDTO;
};

/**
 * El texto del origen de UNA fila: el que compuso el servidor (entidad incluida) y, si la hay, la
 * descripcion. Si una fila llegara sin `origen` (un doble de test, una lectura anterior a la
 * 458-A), cae al rotulo del diccionario TOTAL de su superficie: un nombre legible, nunca el valor
 * tecnico ni un identificador (R4/R5).
 */
export function textoDeOrigen(
  fila: FilaConOrigenLegible,
  rotulos: Readonly<Record<WalletOrigenTipo, string>>,
): string {
  const base = fila.origen?.texto ?? rotulos[fila.origenTipo];
  return fila.descripcion ? `${base}${SEPARADOR}${fila.descripcion}` : base;
}

/**
 * Texto VISIBLE del enlace al origen. Corto a proposito (va dentro de una celda junto al texto del
 * origen); el nombre accesible completo es `enlace.etiqueta` («Ver el cierre del 2026-09-12 de Juan
 * Pérez Mora»), que EMPIEZA por esta misma palabra: «Label in Name» se cumple.
 */
export const ORIGEN_ENLACE_VISIBLE = "Ver";
