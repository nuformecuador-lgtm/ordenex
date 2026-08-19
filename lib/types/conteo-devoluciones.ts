// El DTO del DESGLOSE DE DEVOLUCIONES POR CAUSA y el resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React.

/**
 * Las tres causas tipificadas de `gestion_causa_devolucion` (`db/schema.prisma`), mas el cubo
 * de las devoluciones que no la traen.
 *
 * ⚠ EL CUBO `sin_causa` NO ES UN VALOR DEL ENUM Y NO PUEDE SERLO: `gestion_orden.causa_devolucion`
 * es NULLABLE, y su `null` tiene un significado de dominio —una devolucion ANTERIOR a la feature
 * 73, que no se backfilleo (R16)—. Dejarlas fuera del desglose daria un total menor que el
 * numero de devoluciones, y meterlas en una de las tres causas seria inventar por que se
 * devolvio un paquete. Se cuentan aparte y se dicen.
 */
export const CAUSA_SIN_TIPIFICAR = "sin_causa";

/**
 * De la causa al MOTIVO en castellano.
 *
 * ⚠ POR QUE LA TRADUCCION VIVE EN EL SERVIDOR, al reves que las etiquetas de `order_status`
 * —que el cliente deriva del propio `value`—: los valores de este enum estan en INGLES
 * (`not_found`, `wrong_number`, `wrong_address`), y eso no es un descuido sino una decision
 * consciente y documentada del esquema. De un value en ingles no se deriva un rotulo en
 * castellano con una regla de formato: hace falta una TRADUCCION, y una traduccion es un dato,
 * no un algoritmo. Ponerla en el cliente obligaria a cada consumidor —esta pantalla, un CSV,
 * un correo— a repetirla y a que se separasen.
 *
 * Los textos NO se inventan: son literalmente los comentarios con los que el esquema declara
 * cada valor (`db/schema.prisma`), que es donde el negocio dijo que significaba cada uno.
 *
 * `Record` COMPLETO y no parcial: si manana el enum crece con una cuarta causa, esto deja de
 * compilar hasta que alguien decida como se llama en castellano — en vez de servirla sin
 * traducir o, peor, omitirla del desglose.
 */
export const MOTIVO_DE_CAUSA: Readonly<Record<string, string>> = {
  not_found: "Cliente no localizado",
  wrong_number: "Número de celular errado",
  wrong_address: "Dirección errada",
  [CAUSA_SIN_TIPIFICAR]: "Sin causa registrada",
};

/** Una causa de devolucion, ya traducida, con cuantas gestiones le corresponden. */
export interface ConteoDeCausa {
  /** El valor crudo (`not_found`, ..., o `sin_causa`). Viaja para poder agrupar y depurar. */
  readonly causa: string;
  /**
   * El motivo YA TRADUCIDO. El cliente lo pinta y no decide nada: es el punto de este DTO.
   *
   * Se manda SIEMPRE, tambien para una causa que el mapa no conozca —no deberia pasar, pero un
   * enum ampliado en la base y no en el codigo lo produciria—: en ese caso viaja el valor
   * crudo. Un segmento con `not_found` en la leyenda es feo; uno vacio o ausente es una
   * devolucion que desaparece de la cuenta.
   */
  readonly motivo: string;
  /** Gestiones vigentes con resultado `devuelta` y esa causa. Siempre >= 1 (ver el DTO). */
  readonly conteo: number;
}

/**
 * El desglose completo, con su sello de frescura.
 *
 * ⚠ AQUI SE CUENTAN GESTIONES, NO ORDENES, y es la unica lectura de la vertical que lo hace.
 * No es un capricho: es la convencion del repo para devoluciones (`lib/analytics/metrics.ts`,
 * D10/R35 — «entregas/devoluciones/rechazos/reprogramaciones/incidentes cuentan GESTIONES
 * vigentes, no ordenes»). Consecuencia que hay que tener presente: una orden devuelta dos veces
 * aporta DOS, asi que este total no tiene por que coincidir con las «devueltas» del anillo, que
 * cuenta ordenes por su ultimo desenlace.
 *
 * **Las causas con CERO gestiones no aparecen.** La ausencia significa cero, no «no se pudo
 * medir». Mismo criterio que el desglose por status.
 */
export interface ConteoDevolucionesDTO {
  /** Un elemento por causa CON gestiones, de mayor a menor conteo. */
  readonly porCausa: readonly ConteoDeCausa[];
  /** Suma de todos los `conteo`: las devoluciones del recorte. */
  readonly total: number;
  /**
   * Instante ISO-8601 UTC en que estas cifras se leyeron DE LA BASE — no en que se sirvieron.
   * Con la cache caliente dos peticiones separadas por diez minutos devuelven el MISMO
   * `lastSync`. Ver `ConteoEntregasDTO`.
   */
  readonly lastSync: string;
}

/** Lo que devuelve la Server Action. Discriminado, como el resto del repo: nunca `ok` con una
 *  lista vacia ante un denegado — «prohibido» y «no hubo devoluciones» son dos hechos distintos. */
export type ResultadoConteoDevoluciones =
  | { readonly status: "ok"; readonly datos: ConteoDevolucionesDTO }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
