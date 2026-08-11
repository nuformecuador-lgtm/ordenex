// POS card · compuertas de SECCIÓN, extraídas de `PosOrderCard` para que las tres vistas
// (completa, mosaico, detalle) apaguen lo mismo con el mismo default, igual que ya hacen
// con la selección (`pos-seleccion`). Tres copias del `?? true` divergen en cuanto una
// vista añada una sección; una sola no puede.
//
// Feature 196: existen para que la MISMA card sirva a superficies con menos datos que el
// reparto —la recolección en tienda—, en vez de tener dos cards que se parecen y divergen.

/**
 * Qué secciones se pintan. Todas van a `true` por defecto, así que NINGUNA superficie
 * existente cambia y la prop es puramente aditiva.
 *
 * Se apagan por SECCIÓN y no por campo a propósito: cada una es un bloque con su marco, y
 * una sección presente pero vacía se lee como un error de carga, no como "aquí no aplica".
 *
 * ⚠️ Apagar una sección NO es cosmético: es lo que permite pasar una orden que no tiene
 * esos datos. Si se enciende una sección sobre un DTO que no los trae, la card los leerá.
 */
export interface PosSecciones {
  /** Bloque de navegación (dirección + coordenadas). */
  navegacion?: boolean;
  /** Fila de cobro (monto a cobrar). */
  cobro?: boolean;
  /** Desplegable "Ver detalle completo". */
  detalle?: boolean;
  /** Dato de intentos de entrega bajo el producto. */
  intentos?: boolean;
}

/** Las cuatro compuertas ya resueltas: sin `undefined`, para consumir directo en el JSX. */
export type PosSeccionesVisibles = Required<PosSecciones>;

/**
 * Resuelve las compuertas aplicando el default (`true`). El default vive AQUÍ y no en la
 * desestructuración de cada vista para que un objeto parcial no obligue a ningún llamador
 * a enumerar las cuatro.
 */
export function seccionesVisibles(
  secciones?: PosSecciones,
): PosSeccionesVisibles {
  return {
    navegacion: secciones?.navegacion ?? true,
    cobro: secciones?.cobro ?? true,
    detalle: secciones?.detalle ?? true,
    intentos: secciones?.intentos ?? true,
  };
}
