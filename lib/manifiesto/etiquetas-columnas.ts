/**
 * Feature 194 — etiquetas legibles de las columnas del manifiesto (design §5, requirements D-A).
 *
 * El ARCHIVO sigue emitiendo la clave maquina (`num_guia`, R9): el manifiesto es un documento
 * operativo estable, no una vista. La PANTALLA si es una vista, y ahi "num_remision" es jerga.
 * El selector muestra las dos cosas -- `Numero de remision (num_remision)` -- para que el
 * usuario pueda casar casilla y columna sin adivinar.
 *
 * El mapa NO cierra la lista de columnas (R23): se tipa como `Record<string, string>` y NO como
 * un `Record` de claves cerradas. Una cabecera publicada manana sin etiqueta declarada cae al
 * fallback y aparece igualmente en el selector (R5), en vez de romper el typecheck o de
 * desaparecer en silencio.
 */

/** Cabecera del archivo -> etiqueta legible en pantalla (requirements D-A, 2026-08-10). */
const ETIQUETAS: Record<string, string> = {
  num_guia: "Número de guía",
  num_remision: "Número de remisión",
  destinatario: "Destinatario",
  telefono: "Teléfono",
  direccion: "Dirección",
  zona: "Zona",
  producto: "Producto",
  monto: "Monto a cobrar",
  intentos: "Intentos de entrega",
  origen: "Origen",
  destino: "Destino",
  responsable: "Responsable",
  fecha: "Fecha",
};

/**
 * Etiqueta legible de una cabecera. Fallback = la propia cabecera (R5): una columna sin entrada
 * declarada se muestra con su clave maquina, nunca se omite ni falla.
 */
export function etiquetaColumna(header: string): string {
  return ETIQUETAS[header] ?? header;
}
