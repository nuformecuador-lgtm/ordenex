// El DTO de la COHORTE DE CARGA y el resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React. Los consumen el repositorio, el servicio, la
// accion y la pantalla, y por eso no viven en ninguno de los cuatro. Octavo DTO de la vertical
// de entregas, hermano de `lib/types/conteo-cargadas.ts` y `lib/types/conteo-ciclo-vida.ts`.
//
// ─── QUE PREGUNTA CONTESTA, Y CUAL NO ───────────────────────────────────────────────────
//
// «De las N ordenes que se CARGARON el lunes, cuantas se entregaron, cuantas se devolvieron,
// cuantas siguen vivas y en cuantos dias». El ancla es `orden.created_at` — el dia en que el
// lote ENTRO — y la orden se sigue HASTA SU DESENLACE, caiga donde caiga en el tiempo.
//
// ⚠ NO es lo que mide `CicloVidaDTO`, y la diferencia no es de matiz: alli la ventana cae sobre
// la transicion TERMINAL («de lo que CERRO esta semana, cuanto tardo») y una orden creada en
// enero y cerrada en agosto cuenta en AGOSTO. Aqui esa misma orden cuenta en ENERO, que es
// cuando entro el lote. Tampoco es el universo de los KPI del dia (el inventario VIVO al corte),
// que incluye ordenes cargadas semanas antes.
//
// ⚠ Y NO se recorta por mensajero: una orden no la carga un mensajero. Misma decision —y misma
// consecuencia— que `ConteoCargadasPorDiaDTO`: con un mensajero seleccionado en la barra, esta
// lectura NO se recorta y otras si, asi que la pantalla tiene que decirlo.

import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";

/**
 * Los cubos posibles de una cohorte: los estados TERMINALES del dominio mas `viva`.
 *
 * DERIVADO de `ESTADOS_TERMINALES` y jamas escrito a mano: si el dominio da de alta un cuarto
 * estado terminal, este tipo se ensancha solo y sin tocar este archivo (R8). Una segunda lista
 * escrita aqui envejeceria en silencio — el peor modo de fallo de esta ficha, porque no rompe
 * nada visible.
 *
 * `viva` NO es un estado del catalogo: es la AUSENCIA de transicion terminal. Una orden en
 * `rechazada`, `devuelta`, `devolucion_por_confirmar` o `sin_gestionar` cae aqui, y eso no es un
 * descuido: `devuelta` significa «devolucion anclada», no «lote cerrado» — el paquete sigue en
 * circulacion y su historia continua (medido en este repo el 2026-09-10: una orden devuelta
 * volvio a bodega, se libero sola a las 24 h, salio otra vez y se devolvio cinco dias despues).
 */
export type CohorteDesenlace = (typeof ESTADOS_TERMINALES)[number] | "viva";

/** Un desenlace de una cohorte, con su denominador y su numerador crudo. */
export interface CohorteCubo {
  readonly desenlace: CohorteDesenlace;
  /**
   * Ordenes de la cohorte que acabaron en este cubo. El DENOMINADOR.
   *
   * Siempre >= 1: los cubos sin ninguna orden NO viajan (ver `CohorteDeDia.cubos`).
   */
  readonly n: number;
  /**
   * Suma de segundos entre `orden.created_at` y la transicion que cierra cada orden de este
   * cubo. El NUMERADOR CRUDO.
   *
   * `null` en el cubo `viva`: no hay reloj que parar. **`null` y no `0`**, porque cero segundos
   * es una afirmacion —«cerro al instante»— y lo que pasa es que no hay cierre. Misma distincion
   * que hace `CicloVidaDTO` entre un cero medido y un dato ausente.
   */
  readonly segundosAcum: number | null;
  /**
   * `segundosAcum / n`, o `null` cuando no hay numerador (o el denominador es 0).
   *
   * Viaja JUNTO al numerador y nunca en su lugar: dos recortes se vuelven a agregar sumando
   * numeradores y denominadores, jamas promediando promedios.
   */
  readonly promedioSegundos: number | null;
}

/** Las ordenes cargadas un dia calendario de Costa Rica, repartidas por desenlace. */
export interface CohorteDeDia {
  /**
   * Fecha calendario de Costa Rica, `YYYY-MM-DD`.
   *
   * CADENA y nunca `Date`: una columna `date` vuelve del driver como `Date` de JavaScript y a
   * partir de ahi cada consumidor decide en que huso la lee — que es exactamente como se
   * reintroduce el off-by-one de seis horas del que avisa `lib/analytics/ranges.ts`.
   */
  readonly fecha: string;
  /**
   * Ordenes cargadas ese dia. Es EXACTAMENTE la suma de los `n` de `cubos` (R11): los cubos son
   * exhaustivos y excluyentes por construccion, asi que ninguna orden queda fuera ni se cuenta
   * dos veces.
   */
  readonly cargadas: number;
  /** Un elemento por cubo CON al menos una orden. Un cubo ausente significa cero. */
  readonly cubos: readonly CohorteCubo[];
}

/**
 * La tabla completa de cohortes, con su sello de frescura.
 *
 * ⚠ UNA COHORTE RECIENTE NO ESTA MADURA, y el DTO no lo corrige (seria inventar): su promedio de
 * dias esta sesgado hacia abajo porque solo entran las que ya cerraron. Lo que hace es
 * ENSENARLO — el cubo `viva` es la medida exacta de esa inmadurez, y el `n` del promedio viaja
 * siempre.
 */
export interface CohorteCargaDTO {
  /**
   * Una fila por dia CON ordenes cargadas, de la MAS RECIENTE a la mas antigua (R6).
   *
   * DESCENDENTE, y es contrato: es lo que se viene a mirar. **Diverge a proposito de
   * `ConteoCargadasPorDiaDTO`** (ascendente): aquella pinta un eje temporal, donde el tiempo va
   * hacia la derecha; esta es una tabla que se lee de arriba abajo. El orden se decide en UN
   * solo sitio —el `ORDER BY` del repositorio— y la pantalla NO reordena: una serie con dos
   * criterios de orden acaba pintandose distinto segun quien la toque al final.
   *
   * Los dias SIN ninguna orden cargada no aparecen: un hueco significa cero.
   */
  readonly porDia: readonly CohorteDeDia[];
  /** Universo del recorte: la suma de `cargadas`. DERIVADO de estas mismas filas (R30). */
  readonly total: number;
  /** El mismo reparto por desenlace, agregado sobre todos los dias. Tambien derivado. */
  readonly totalPorDesenlace: readonly CohorteCubo[];
  /**
   * Instante ISO-8601 UTC en que estas cifras se leyeron DE LA BASE — no en que se sirvieron.
   * Con la cache caliente, dos peticiones separadas por diez minutos llevan el MISMO sello.
   */
  readonly lastSync: string;
}

/**
 * Lo que devuelve la Server Action. Discriminado, como el resto del repo.
 *
 * ⚠ `sin_rango` NO es `validation_error`, y la distincion es la razon de que exista el estado:
 * el filtro es VALIDO —las otras siete lecturas de la seccion lo aceptan tal cual— y lo que pasa
 * es que el usuario aun no ha elegido periodo. Esta lectura EXIGE rango (sin techo, la tabla
 * crece sin limite y deja de ser herramienta), asi que la pantalla lo traduce a una invitacion.
 * Llamarlo error de validacion acusaria al usuario de una equivocacion que no cometio.
 */
export type ResultadoCohorteCarga =
  | { readonly status: "ok"; readonly datos: CohorteCargaDTO }
  | { readonly status: "sin_rango" }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
