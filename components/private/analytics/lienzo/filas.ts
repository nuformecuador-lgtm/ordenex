// Adaptador de forma: de `SerieDato[]` (contrato del paquete) a las filas que
// espera recharts (un objeto por categoria, una clave por serie).
//
// Vive en `lienzo/` porque solo el lienzo necesita esta forma, pero NO importa
// recharts: es una funcion pura y se puede probar sin montar nada.

import type { SerieDato } from "../tipos";

export type FilaLienzo = Readonly<Record<string, string | number | null>>;

/** Clave de la categoria en la fila. No colisiona con un `id` de serie legible. */
export const CLAVE_CATEGORIA = "__categoria";

/**
 * Union de categorias en orden de primera aparicion. Un `null` se conserva como
 * `null` —hueco— y NUNCA se sustituye por `0` (R11); una categoria que una serie
 * no tiene tampoco se rellena con cero: queda ausente.
 */
export function filasDeSeries(series: readonly SerieDato[]): FilaLienzo[] {
  const categorias: string[] = [];
  for (const serie of series) {
    for (const punto of serie.puntos) {
      if (!categorias.includes(punto.categoria)) categorias.push(punto.categoria);
    }
  }

  return categorias.map((categoria) => {
    const fila: Record<string, string | number | null> = { [CLAVE_CATEGORIA]: categoria };
    for (const serie of series) {
      const punto = serie.puntos.find((p) => p.categoria === categoria);
      fila[serie.id] = punto ? punto.valor : null;
    }
    return fila;
  });
}
