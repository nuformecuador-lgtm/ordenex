// Feature 196 (design §3) — EL criterio de orden y de podio del ranking diario, extraido
// tal cual de `RankingService.obtenerRanking` (:105-131) para que el ranking EN VIVO y el
// snapshot congelado no puedan divergir: reusar el criterio era el encargo, no
// reimplementarlo.
//
// Modulo PURO: sin Prisma, sin `next/*`, sin `new Date()` ni `Date.now()`. Solo aritmetica
// sobre dos enteros y comparacion de cadenas.
//
// Unica diferencia con el codigo del que sale: el desempate FINAL por `mensajeroId`
// ascendente (R4). Es puramente ADITIVO —solo actua donde el orden anterior quedaba SIN
// especificar (mismo pct, mismas entregadas y mismo nombre)—, y sin el, dos mensajeros
// homonimos con metricas identicas quedan en un orden que depende del `sort` del motor: dos
// corridas del mismo dia podrian congelar podios distintos.

/** Lo minimo que el criterio necesita de un mensajero para ordenarlo y darle podio. */
export interface AgregadoOrdenable {
  readonly mensajeroId: string;
  readonly nombre: string;
  /** Numerador: entregas vigentes del dia. */
  readonly entregadas: number;
  /** Denominador: ordenes asignadas ese dia. `0` => porcentaje INDEFINIDO (no cero). */
  readonly asignadas: number;
}

/** Una fila ya ordenada, con su puesto en la lista completa y su posicion de podio. */
export interface FilaConPodio<T extends AgregadoOrdenable> {
  readonly agregado: T;
  /** 1..N — posicion en la lista COMPLETA; siempre existe (R6). */
  readonly puesto: number;
  /** 1|2|3 si ocupa podio; `null` si no es elegible o el podio ya esta lleno (R9). */
  readonly posicion: number | null;
}

/** Solo hay tres posiciones de premio (R14/R15 de la feature 76). */
const POSICIONES_PODIO = 3;

/**
 * Porcentaje del dia como NUMERO redondeado a 1 decimal, o `null` si el denominador es 0.
 * Se redondea ANTES de comparar, que es lo que hacia el service: dos mensajeros cuyo ratio
 * crudo difiere en la cuarta cifra pero comparte el primer decimal EMPATAN y pasan al
 * siguiente criterio. Cambiar esto reordenaria el ranking en vivo.
 */
function pctNumerico(entregadas: number, asignadas: number): number | null {
  if (asignadas <= 0) return null;
  return Math.round((entregadas / asignadas) * 1000) / 10;
}

/**
 * R10 — el porcentaje del dia como STRING con 1 decimal, o `null` cuando no hay
 * denominador (`asignadas === 0`): `null` NO es `"0.0"`, es «indefinido».
 *
 * Este es el UNICO sitio del repo que aplica este redondeo y esta serializacion. El vivo lo
 * usa para la fila que manda al cliente y el historico para derivarlo de los dos enteros
 * congelados (por eso el snapshot NO persiste el porcentaje).
 */
export function formatearPct(entregadas: number, asignadas: number): string | null {
  const pct = pctNumerico(entregadas, asignadas);
  return pct === null ? null : pct.toFixed(1);
}

/**
 * R3/R4 — orden del ranking, TOTAL y determinista:
 *
 *   1. los de porcentaje DEFINIDO antes que los de porcentaje indefinido (`asignadas = 0`);
 *   2. porcentaje descendente;
 *   3. entregadas descendente;
 *   4. nombre ascendente (`localeCompare`);
 *   5. `mensajeroId` ascendente — el desempate nuevo (R4), que cierra el ultimo hueco.
 *
 * Los pasos 2 y 3 solo se aplican entre dos filas con porcentaje definido; entre dos
 * indefinidas se cae directo al nombre, igual que antes.
 *
 * Devuelve una copia ORDENADA: no muta la entrada.
 */
export function ordenarAgregados<T extends AgregadoOrdenable>(agregados: readonly T[]): T[] {
  return [...agregados].sort((a, b) => {
    const pctA = pctNumerico(a.entregadas, a.asignadas);
    const pctB = pctNumerico(b.entregadas, b.asignadas);
    const aDef = pctA !== null;
    const bDef = pctB !== null;
    if (aDef !== bDef) return aDef ? -1 : 1; // definidos antes que indefinidos
    if (pctA !== null && pctB !== null) {
      if (pctB !== pctA) return pctB - pctA; // pct desc
      if (b.entregadas !== a.entregadas) return b.entregadas - a.entregadas; // entregadas desc
    }
    const porNombre = a.nombre.localeCompare(b.nombre); // nombre asc
    if (porNombre !== 0) return porNombre;
    // R4: ultimo desempate. Solo decide donde el orden anterior estaba SIN especificar.
    return a.mensajeroId < b.mensajeroId ? -1 : a.mensajeroId > b.mensajeroId ? 1 : 0;
  });
}

/**
 * Feature 297 — QUIEN NO ENTREGO NADA ESE DIA NO OCUPA PODIO.
 *
 * El 26/08 el podio quedo Andres 1.o (0 de 21), Carlos 2.o (0 de 25) y Johel 3.o (0 de 37):
 * nadie entrego, todos empataron a 0.0 % y el orden lo decidio el CUARTO criterio, el nombre
 * alfabetico. El primer puesto lleva premio en dinero, asi que ese podio pagaba por el orden
 * del abecedario. Una entrega es el minimo que hace del podio un merito.
 *
 * Es un tercer requisito de ELEGIBILIDAD, no un cuarto criterio de orden: el ORDEN no se toca
 * —esos tres siguen listados, con su puesto y su 0.0 %—, solo dejan de ocupar posicion.
 */
const MIN_ENTREGADAS_PODIO = 1;

/**
 * R9 — la posicion `i` del podio la ocupa el `i`-esimo mensajero ELEGIBLE de la lista ya
 * ordenada. Elegible = porcentaje definido, `asignadas >= minAsignadas` Y al menos una entrega
 * (feature 297). Quien no cumple se LISTA con su puesto pero se queda sin posicion; si se
 * agotan los elegibles antes de las tres posiciones, las restantes no se inventan.
 *
 * Las posiciones NO se dejan vacantes: se reparten entre los elegibles en el orden en que
 * vienen, que es lo que este mismo bucle ya hacia con el umbral de `asignadas`. Si el primero
 * de la lista no es elegible, el siguiente que si lo sea es el 1.o —no hay podio sin primero
 * habiendo alguien con derecho a el—, y si no queda ninguno el podio se queda vacio entero.
 *
 * `ordenados` debe venir de `ordenarAgregados`: aqui NO se reordena nada.
 */
export function asignarPodio<T extends AgregadoOrdenable>(
  ordenados: readonly T[],
  minAsignadas: number,
): FilaConPodio<T>[] {
  let siguientePosicion = 1;
  return ordenados.map((agregado, indice) => {
    const elegible =
      pctNumerico(agregado.entregadas, agregado.asignadas) !== null &&
      agregado.asignadas >= minAsignadas &&
      agregado.entregadas >= MIN_ENTREGADAS_PODIO;
    let posicion: number | null = null;
    if (elegible && siguientePosicion <= POSICIONES_PODIO) {
      posicion = siguientePosicion;
      siguientePosicion += 1;
    }
    return { agregado, puesto: indice + 1, posicion };
  });
}
