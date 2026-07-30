// Feature 142 — Parser puro de la columna `direccion_destinatario` de la plantilla
// de carga masiva de ordenes (R11-R28).
//
// Traduce `Pais / Provincia / Canton (Distrito) / Direccion literal` a la terna
// provincia/canton/distrito + la direccion literal, para que `resolverGeografia`
// (BulkOrdenService.resolveGeo) siga recibiendo exactamente los mismos 3 nombres
// que antes venian en columnas separadas.
//
// Restriccion de diseno (design.md §3): modulo importable desde el navegador.
// Sin Prisma, sin `next/*`, sin Supabase, sin `process.env`, sin I/O.

/** Formato canonico que se cita en todos los mensajes de error accionables (R29). */
export const FORMATO_DIRECCION_DESTINATARIO =
  "País / Provincia / Cantón (Distrito) / Dirección";

/** Partes derivadas del valor, tal cual aparecen en el archivo (solo trim, R17/R27). */
export interface DireccionDestinatarioPartes {
  provincia: string;
  canton: string;
  distrito: string;
  /** R15/R16/R26: conserva '/' y espacios internos; vacia es valida. */
  direccion: string;
}

/** R28: todo caso invalido se expresa como resultado, nunca como excepcion. */
export type ParseDireccionResult =
  | { ok: true; partes: DireccionDestinatarioPartes }
  | { ok: false; mensaje: string };

const SEPARADOR = "/";
const SEPARADORES_REQUERIDOS = 3;

function conFormato(causa: string): { ok: false; mensaje: string } {
  return { ok: false, mensaje: `${causa}. Formato esperado: ${FORMATO_DIRECCION_DESTINATARIO}` };
}

/** Indices de las primeras `cantidad` apariciones de '/', o null si no hay tantas. */
function indicesDeSeparadores(valor: string, cantidad: number): number[] | null {
  const indices: number[] = [];
  let desde = 0;
  while (indices.length < cantidad) {
    const i = valor.indexOf(SEPARADOR, desde);
    if (i < 0) return null;
    indices.push(i);
    desde = i + 1;
  }
  return indices;
}

type CantonDistrito = { ok: true; canton: string; distrito: string } | { ok: false; mensaje: string };

// R18/R19/R20/R21/R22/R24: del 3.er segmento saca el canton (antes del primer '(')
// y el distrito (entre ese '(' y el primer ')' posterior).
function separarCantonDistrito(segmento: string): CantonDistrito {
  const abre = segmento.indexOf("(");
  if (abre < 0) return conFormato("falta el distrito entre parentesis"); // R19
  const cierra = segmento.indexOf(")", abre);
  if (cierra < 0) return conFormato("el parentesis del distrito no esta cerrado"); // R21

  const distrito = segmento.slice(abre + 1, cierra).trim();
  if (distrito === "") return conFormato("el distrito entre parentesis esta vacio"); // R20

  const sobrante = segmento.slice(cierra + 1).trim();
  if (sobrante !== "") return conFormato("hay texto inesperado despues del distrito"); // R22

  const canton = segmento.slice(0, abre).trim();
  if (canton === "") return conFormato("el canton esta vacio"); // R24

  return { ok: true, canton, distrito };
}

/**
 * R11-R28: separa `direccion_destinatario` en provincia, canton, distrito y
 * direccion literal. Puro y determinista; nunca lanza para una entrada `string`.
 */
export function parseDireccionDestinatario(valor: string): ParseDireccionResult {
  // R25: ausente / vacio / solo espacios.
  if (valor.trim() === "") {
    return conFormato("direccion_destinatario es obligatorio");
  }

  // R11/R13: solo los TRES primeros '/' son separadores.
  const indices = indicesDeSeparadores(valor, SEPARADORES_REQUERIDOS);
  if (indices === null) {
    return conFormato("faltan separadores '/': se esperan 3");
  }
  const [i1, i2, i3] = indices;

  // R12: el 1.er segmento es el pais; se descarta sin validarlo ni persistirlo.

  const provincia = valor.slice(i1 + 1, i2).trim();
  if (provincia === "") return conFormato("la provincia esta vacia"); // R23

  const cantonDistrito = separarCantonDistrito(valor.slice(i2 + 1, i3).trim());
  if (!cantonDistrito.ok) return cantonDistrito;

  // R15/R16/R17: `slice` desde el 3.er '/' conserva los '/' posteriores (incluido
  // uno final) y los espacios internos; solo se recortan los extremos.
  // R26: vacia es valida (equivale a la columna `direccion` vacia de hoy).
  const direccion = valor.slice(i3 + 1).trim();

  return {
    ok: true,
    partes: { provincia, canton: cantonDistrito.canton, distrito: cantonDistrito.distrito, direccion },
  };
}
