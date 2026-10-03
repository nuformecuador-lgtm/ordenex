/**
 * FICHA 469 (design §2.4) — buscar una GUIA o una REMISION en el libro de la wallet.
 *
 * Modulo de TIPOS: sin Prisma, sin repositorios, sin servicios. Lo importan el servicio que resuelve la
 * busqueda, los repositorios que la aplican en su `WHERE` y —solo `ModoBusquedaLibro`— la pantalla.
 *
 * La decision «guia o texto» y el conjunto de movimientos se calculan en el SERVIDOR (R33): el navegador
 * manda el termino (`q`) y recibe de vuelta `modoBusqueda`, nada mas. Los ids de las ordenes identificadas
 * y la lista de pares NO cruzan la frontera.
 */

/**
 * El modo en que el servidor resolvio el termino del libro (R2/R6/R21/R23).
 *
 *  - `guia`  — el termino identifico al menos una orden del alcance: salen SOLO los movimientos a los
 *              que esas ordenes aportan dinero (y los de una sola orden de esas ordenes, R14).
 *  - `texto` — no identifico ninguna: la busqueda de texto de la 463, exactamente como antes (R6).
 */
export type ModoBusquedaLibro = "texto" | "guia";

/**
 * Un par «este movimiento sale en la busqueda por guia», con la forma del origen de una fila del libro.
 *
 *  - `cierre_dia` — un movimiento REPARTIBLE de ese cierre y de esa categoria al que alguna orden
 *    identificada aporta (R8/R11). La categoria va SIEMPRE: un mismo cierre emite varias categorias y la
 *    orden puede aportar a unas y no a otras (R9).
 *  - `gestion_orden` / `orden_incidente` — los movimientos de UNA sola orden que no nacen de un cierre
 *    (pregunta abierta 1, aprobada: cobro por rechazo e indemnizacion por incidente, con sus anulaciones).
 *    Sin categoria: cuenta cualquier categoria con ese origen.
 *
 * Es una LISTA CERRADA calculada por el servicio, el mismo patron que el filtro del chip (`ParDeChip`):
 * el repositorio la traduce a un `OR` de igualdades y no decide nada.
 */
export type ParDeGuia =
  | { origenTipo: "cierre_dia"; origenId: string; categoria: string }
  | { origenTipo: "gestion_orden" | "orden_incidente"; origenId: string };

/**
 * El resultado de resolver un termino en una superficie. `pares` puede ir vacio en modo `guia`: la orden
 * existe en el alcance pero no aporta a nada de ese libro, y el libro sale vacio con su texto (R22).
 */
export type BusquedaResuelta =
  | { modo: "texto"; termino: string }
  | { modo: "guia"; termino: string; ordenIds: string[]; pares: ParDeGuia[] };

/**
 * Las superficies con busqueda por guia (Vocabulario). La bodega satelite NO esta (R36, pregunta abierta
 * 2 aprobada): su buscador sigue siendo solo de texto y el servicio ni siquiera se la deja nombrar.
 *
 * `tiendaId` acota el alcance en el estado de cuenta de una tienda y en `/mi-wallet` (R5/R29). Sale de la
 * CUENTA ya validada (oficina) o del ACTOR (`/mi-wallet`), nunca de un campo libre.
 */
export type SuperficieConGuia = { tipo: "caja" } | { tipo: "tienda"; tiendaId: string } | { tipo: "mensajero" };

/** Una orden identificada por el termino (paso 1, R2–R7). */
export interface OrdenIdentificada {
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
}
