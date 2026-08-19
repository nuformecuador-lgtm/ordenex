// El DTO del desglose POR STATUS y el resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React.

/** Un status y cuantas ordenes del recorte le corresponden. */
export interface ConteoDeStatus {
  /**
   * El status, tal como lo nombra el dominio.
   *
   * Sale de DOS vocabularios que se solapan (decision humana del 2026-08-18): el `resultado`
   * de la ultima gestion vigente de la orden, o —si la orden nunca se gestiono— el `value` de
   * `order_status`. Los cinco valores de `GestionResultado` (`entregada`, `reprogramada`,
   * `devuelta`, `rechazada`, `incidente`) existen TAMBIEN en `ORDER_STATUS_SEED`, asi que la
   * union no inventa nombres nuevos: todo lo que sale de aqui es un value del catalogo.
   *
   * OJO con la consecuencia, que es real y no un detalle: una orden gestionada como `devuelta`
   * cae en el bucket `devuelta` aunque su `orden.estatus` de hoy sea `devolviendo_a_tienda`.
   * Este desglose responde «que paso con la orden», no «donde esta ahora».
   */
  readonly status: string;
  /** Ordenes en ese bucket. Siempre >= 1: los status sin ninguna NO viajan (ver el DTO). */
  readonly conteo: number;
}

/**
 * El desglose completo, con su sello de frescura.
 *
 * **Los status con CERO ordenes NO aparecen** (decision humana del 2026-08-18). Quien consuma
 * esto tiene que saberlo: la ausencia de un status significa cero, no «no se pudo medir». Se
 * eligio asi para que la respuesta no arrastre quince buckets vacios ni una grafica pinte
 * quince segmentos invisibles.
 *
 * `total` viaja HECHO y no se deja sumar al cliente: cada consumidor que sume por su cuenta es
 * otra oportunidad de que dos cifras de la misma pantalla no cuadren. Y por construccion es la
 * suma exacta de los `conteo`, porque sale de las mismas filas.
 */
export interface ConteoPorStatusDTO {
  /** Un elemento por status CON ordenes, de mayor a menor conteo. */
  readonly porStatus: readonly ConteoDeStatus[];
  /** Suma de todos los `conteo`. El universo entero del recorte. */
  readonly total: number;
  /**
   * Instante ISO-8601 UTC en que estas cifras se leyeron DE LA BASE — no en que se sirvieron.
   * Con la cache caliente dos peticiones separadas por diez minutos devuelven el MISMO
   * `lastSync`, que es justo lo que hay que saber. Ver `ConteoEntregasDTO`.
   */
  readonly lastSync: string;
}

/** Lo que devuelve la Server Action. Discriminado, como el resto del repo: nunca `ok` con una
 *  lista vacia ante un denegado — «prohibido» y «sin ordenes» son dos hechos distintos. */
export type ResultadoConteoPorStatus =
  | { readonly status: "ok"; readonly datos: ConteoPorStatusDTO }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
