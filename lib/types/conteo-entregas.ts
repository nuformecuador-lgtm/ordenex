// El DTO del conteo de entregas y el resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React. Los consumen el servicio, la accion y el
// componente, y por eso no viven en ninguno de los tres.

import type { OrderStatusValue } from "@/lib/types/order-status";

/**
 * Los CINCO desenlaces que el anillo nombra, en el orden en que se pintan.
 *
 * Son exactamente los cinco valores de `GestionResultado` (`db/schema.prisma`), y eso NO es
 * casualidad: son los desenlaces que registra un mensajero al gestionar una orden. Se tipan
 * contra `OrderStatusValue` —los cinco existen tambien en `ORDER_STATUS_SEED`— para que un
 * renombre del catalogo deje de COMPILAR en vez de vaciar un segmento en silencio; ya paso
 * tres veces (features 135, 153 y 154).
 *
 * ⚠ POR QUE ESTOS BUCKETS NO PUEDEN SALIR DE `orden.estatus`, que es como nacio este endpoint:
 * una orden devuelta NO tiene `orden.estatus = "devuelta"`, tiene `devolviendo_a_tienda` o
 * `devuelta_a_tienda`. Si el bucket se leyera del estatus de la orden, «devueltas» daria
 * practicamente CERO y todo caeria en «otros». Por eso, desde el 2026-08-18, este conteo usa
 * la MISMA regla que el desglose por status: el `resultado` de la ultima gestion vigente y,
 * si la orden nunca se gestiono, su estatus propio.
 *
 * Efecto colateral bueno y buscado: los dos graficos de la pantalla ya no pueden discrepar
 * sobre cuantas entregadas hubo, porque salen de la misma consulta.
 */
export const DESENLACES: readonly OrderStatusValue[] = [
  "entregada",
  "devuelta",
  "rechazada",
  "reprogramada",
  "incidente",
];

/** El bucket de lo que no es ninguno de los cinco desenlaces. */
export const BUCKET_OTROS = "otros";

/**
 * Las cifras del anillo y su sello de frescura.
 *
 * **`total` = la suma de los seis buckets SIEMPRE, por construccion.** No es una invariante
 * que alguien tenga que recordar: los seis salen de repartir las MISMAS filas, asi que no
 * pueden discrepar entre si. Seis consultas independientes podrian resolverse con cortes
 * distintos —una escritura concurrente entre dos basta— y dar un total que no cuadra consigo
 * mismo.
 *
 * Cifras `0` reales, nunca `null`: el universo es la tabla `orden` viva y siempre hay una
 * respuesta. Un rango sin ordenes son seis ceros, y eso es un hecho, no una ausencia de dato.
 * El «no se pudo saber» viaja por el discriminante de `ResultadoConteoEntregas`.
 */
export interface ConteoEntregasDTO {
  /** Ordenes por desenlace. Clave = un valor de `DESENLACES`, o `BUCKET_OTROS`. */
  readonly porDesenlace: Readonly<Record<string, number>>;
  /** El universo entero del recorte. */
  readonly total: number;
  /**
   * Instante ISO-8601 UTC en que estas cifras se leyeron DE LA BASE — no en que se
   * sirvieron. Con la cache caliente, dos peticiones separadas por diez minutos devuelven
   * el MISMO `lastSync`.
   *
   * ⚠ HOY NO SE PINTA: el rotulo «Actualizado 18:30» se retiro de la pantalla el 2026-08-18.
   * El dato se conserva a proposito —es lo unico que sabe la edad real de la cifra, que puede
   * ser de hasta 15 minutos— para que volver a mostrarlo sea una linea y no rehacer nada.
   */
  readonly lastSync: string;
}

/**
 * Lo que devuelve la Server Action. Discriminado (patron del repo): NUNCA se responde `ok`
 * con ceros ante un denegado, porque «prohibido» y «no hubo entregas» son dos hechos
 * distintos y la pantalla los pinta distinto.
 */
export type ResultadoConteoEntregas =
  | { readonly status: "ok"; readonly datos: ConteoEntregasDTO }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
