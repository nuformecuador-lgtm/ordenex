// El DTO del CONTADOR DE HOY —cargadas del dia en curso, gestionadas vs sin gestionar— y el
// resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React.

/**
 * Las dos cifras del dia en curso y su sello de frescura.
 *
 * QUE PREGUNTA CONTESTA, en una linea: de las ordenes que ENTRARON hoy, ¿cuantas ha tocado ya
 * alguien y cuantas siguen sin tocar? Es un contador de trabajo pendiente del dia, no un
 * historico, y por eso es la unica lectura de la vertical que no acepta ventana: su ventana es
 * SIEMPRE el dia calendario de Costa Rica en curso.
 *
 * ⚠ LAS TRES COSAS QUE ESTA LECTURA IGNORA DEL FILTRO, y que la pantalla tiene que decir porque
 * la barra es una sola:
 *   - **la ventana** (`rango`/`desde`/`hasta`): siempre hoy. Un contador «de hoy» que obedeciera
 *     al selector de fechas dejaria de ser el contador de hoy sin cambiar de rotulo;
 *   - **el mensajero**: una orden no la carga un mensajero (mismo criterio que la serie de
 *     cargadas por dia);
 *   - nada mas. El ALCANCE y las cinco facetas de recorte (zona, provincia, canton, distrito,
 *     tienda) SI se aplican, y el alcance no es negociable: es la frontera multi-tenant.
 *
 * **`total` = `conGestion` + `sinGestion` SIEMPRE, por construccion**: las dos cifras salen de
 * repartir las MISMAS filas en una sola consulta, asi que no pueden discrepar. Dos consultas
 * independientes podrian resolverse con cortes distintos —una gestion registrada entre ambas
 * basta— y dar un total que no cuadra consigo mismo.
 *
 * Cifras `0` reales, nunca `null`: un dia sin cargas son dos ceros, y eso es un hecho, no una
 * ausencia de dato. El «no se pudo saber» viaja por el discriminante de `ResultadoConteoHoyGestion`.
 */
export interface ConteoHoyGestionDTO {
  /** Cargadas hoy que NO tienen ninguna gestion vigente. El pendiente del dia. */
  readonly sinGestion: number;
  /**
   * Cargadas hoy con AL MENOS UNA gestion vigente, del tipo que sea.
   *
   * INDEPENDIENTE DEL RESULTADO a proposito: entregada, devuelta, rechazada, reprogramada e
   * incidente cuentan todas igual. La pregunta es «¿la ha tocado alguien?», no «¿como acabo?» —
   * para el desenlace estan el anillo y el desglose por status, que salen de la misma consulta
   * base y no pueden discrepar de este.
   *
   * VIGENTE significa `anulada_at IS NULL`, la misma regla que el resto de la vertical: una
   * gestion anulada no cuenta como tocada, porque anularla es precisamente deshacerla.
   */
  readonly conGestion: number;
  /** `sinGestion + conGestion`. Las cargadas de hoy, sin mas. */
  readonly total: number;
  /**
   * El dia que se conto, `YYYY-MM-DD` calendario de Costa Rica.
   *
   * VIAJA EN EL DTO y no se deja deducir al cliente: el dia lo resuelve el SERVIDOR en hora de
   * Costa Rica, y un navegador en otro huso —o abierto desde ayer— dibujaria otro. Es ademas lo
   * unico que permite a la pantalla notar que su contador es de ayer.
   */
  readonly fecha: string;
  /**
   * Instante ISO-8601 UTC en que estas cifras se leyeron DE LA BASE — no en que se sirvieron.
   * Con la cache caliente dos peticiones separadas por diez minutos devuelven el MISMO
   * `lastSync`. Ver `ConteoEntregasDTO`.
   */
  readonly lastSync: string;
}

/** Lo que devuelve la Server Action. Discriminado, como el resto del repo: nunca `ok` con dos
 *  ceros ante un denegado — «prohibido» y «hoy no ha entrado nada» son dos hechos distintos. */
export type ResultadoConteoHoyGestion =
  | { readonly status: "ok"; readonly datos: ConteoHoyGestionDTO }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
