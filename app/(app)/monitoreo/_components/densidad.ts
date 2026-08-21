// Feature 258 (F4.2/F4.3) — la DENSIDAD del tablero, en su propio modulo.
//
// Es estado de PRESENTACION PURO (R45): no consulta, no cambia que tarjetas se ven, no cambia
// su orden y no cambia ninguna cifra. Lo unico que decide es cuanto aprieta la rejilla y si la
// etiqueta de cada contador se ve o solo se oye.
//
// Vive aqui y no dentro de `TableroDiaControles` porque lo consumen cuatro archivos (el
// modulo, la rejilla, la tarjeta y los contadores) y un tipo importado desde el componente
// que lo pinta ata la forma del dato a quien lo dibuja.

/** Las dos densidades. Union cerrada: una tercera no compila sin decidir que hace en cada sitio. */
export type DensidadTablero = "comoda" | "compacta";

/**
 * R44 — el valor INICIAL es la comoda. Ademas de ser la decision del spec, es lo que hace que
 * los tests de la 192 —que esperan la etiqueta VISIBLE de cada contador— sigan verdes sin
 * tocarlos.
 */
export const DENSIDAD_INICIAL: DensidadTablero = "comoda";

/** Etiqueta visible de cada opcion del conmutador. */
export const ETIQUETA_DENSIDAD = {
  comoda: "Cómoda",
  compacta: "Compacta",
} as const satisfies Record<DensidadTablero, string>;

/** Orden de las opciones en el conmutador: de menos a mas apretado. */
export const DENSIDADES = ["comoda", "compacta"] as const satisfies readonly DensidadTablero[];
