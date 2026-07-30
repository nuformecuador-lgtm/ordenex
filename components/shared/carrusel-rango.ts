// Etiqueta de posición del carrusel: "Orden 5 de 5" cuando se ve una sola, "Órdenes 1-3 de
// 5" cuando se ven varias. Vive aparte del componente a propósito: es la única regla con
// aritmética de la feature y así se ejercita sin montar embla (que en jsdom no mide ancho).

export interface RangoVisible {
  /** Primera posición visible, 1-based. */
  desde: number;
  /** Última posición visible, 1-based e inclusiva. */
  hasta: number;
}

/**
 * Convierte los indices que el carrusel reporta en vista (0-based, posiblemente vacios o
 * fuera de rango) en un rango 1-based utilizable.
 *
 * Cuando no hay informacion de visibilidad —antes de la hidratacion, o en un entorno que no
 * mide anchos— cae a la PRIMERA posicion en vez de inventar un rango: es lo unico que se
 * puede afirmar sin saber cuantas caben.
 */
export function rangoVisible(indices: number[], total: number): RangoVisible | null {
  if (total <= 0) return null;

  const validos = indices.filter(
    (i) => Number.isInteger(i) && i >= 0 && i < total,
  );
  if (validos.length === 0) return { desde: 1, hasta: 1 };

  return {
    desde: Math.min(...validos) + 1,
    hasta: Math.max(...validos) + 1,
  };
}

export interface EtiquetaRangoOpciones {
  /** Nombre del elemento en singular. Por defecto "Orden". */
  singular?: string;
  /** Nombre del elemento en plural. Por defecto "Órdenes". */
  plural?: string;
}

/**
 * Texto de la etiqueta. Una sola posicion visible se lee en singular ("Orden 5 de 5"); dos o
 * mas, como rango en plural ("Órdenes 1-3 de 5"). Sin elementos no hay etiqueta que mostrar.
 */
export function etiquetaRango(
  indices: number[],
  total: number,
  { singular = "Orden", plural = "Órdenes" }: EtiquetaRangoOpciones = {},
): string {
  const rango = rangoVisible(indices, total);
  if (!rango) return "";

  if (rango.desde === rango.hasta) {
    return `${singular} ${rango.desde} de ${total}`;
  }
  return `${plural} ${rango.desde}-${rango.hasta} de ${total}`;
}
