// FICHA 345 — el DTO del analisis de productos y el resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React.
//
// ⚠ EL LIMITE INNEGOCIABLE DE LA FICHA, escrito en el propio contrato: **aqui no hay ni una
// cifra de dinero**. El cobro vive en la ORDEN, y en el 12 % de ordenes multiproducto repartir el
// flete entre sus productos seria inventar una cifra. Esta analitica es de VOLUMEN y
// EFECTIVIDAD. Si algun dia se quiere «ingreso por producto», es una ficha propia con su recorte
// dicho en pantalla, no un campo mas de este DTO.

import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

/**
 * Un producto DE UNA TIENDA. Dos textos iguales de tiendas distintas son DOS filas (R37/R39):
 * que dos tiendas escriban lo mismo no prueba que sea el mismo articulo.
 */
export interface FilaProductoDTO {
  /** Clave de fila. NO viaja al archivo de descarga: alli no entra ningun uuid (R49). */
  readonly tiendaId: string;
  /** `usuario.nombre` de la tienda: la fila se identifica por NOMBRE (R38). */
  readonly tienda: string;
  /** Forma VISIBLE del producto, elegida de manera DETERMINISTA entre las variantes (R18). */
  readonly producto: string;
  /** Suma de las cantidades de sus items. ENTERO (R34), nunca un decimal ni un importe. */
  readonly unidades: number;
  /**
   * Ordenes del recorte que contienen este producto. ENTERO (R34).
   *
   * ⚠ UNA ORDEN CON VARIOS PRODUCTOS CUENTA EN CADA UNO (R36), asi que la suma de esta columna
   * puede superar `ordenes` del DTO sin que eso sea un error. La pantalla lo dice con un rotulo:
   * quien lea el numero sin el aviso concluira que las cifras no cuadran.
   */
  readonly ordenes: number;
  /**
   * Los desenlaces de ESAS ordenes, con la misma forma que el desglose por status.
   *
   * Se tipa con `ConteoDeStatus` A PROPOSITO: es exactamente lo que come `calcularEfectividad`,
   * la unica definicion de efectividad del tablero. Asi la pantalla NO PUEDE calcular la
   * efectividad por producto de otra manera aunque quiera, y el denominador por producto es por
   * construccion el mismo que el de la fila de KPIs — todas las ordenes del recorte que
   * contienen ese producto, incluidas las que siguen en proceso (R28, R29).
   */
  readonly porStatus: readonly ConteoDeStatus[];
}

export interface ConteoProductosDTO {
  /**
   * Las filas, en orden DETERMINISTA (R33): unidades desc, ordenes desc, producto asc, tienda
   * asc. Nunca hay filas con cero ordenes (R31).
   */
  readonly filas: readonly FilaProductoDTO[];
  /** Universo del recorte: cuantas ordenes entraron en el calculo (R35). */
  readonly ordenes: number;
  /**
   * Cuantas de esas ordenes tenian un texto de producto que NO produjo ningun item (R35).
   *
   * Es un hecho distinto de «no tiene productos» y por eso viaja aparte: si esta cifra empieza a
   * crecer, lo que hay que arreglar es el parser, no la pantalla.
   */
  readonly ordenesSinProducto: number;
  /**
   * Instante ISO-8601 UTC en que estas cifras se leyeron DE LA BASE — no en que se sirvieron.
   * Con la cache caliente dos peticiones separadas por diez minutos devuelven el MISMO
   * `lastSync`, que es justo lo que hay que saber.
   */
  readonly lastSync: string;
}

/**
 * Lo que devuelve la Server Action. Discriminado, como el resto del repo.
 *
 * `forbidden` NUNCA lleva el motivo: el porque se queda en el log de auditoria (R9). Y nunca se
 * responde `ok` con una lista vacia ante un denegado — «prohibido» y «sin ordenes» son dos hechos
 * distintos, y la pantalla tiene un texto para cada uno.
 */
export type ResultadoConteoProductos =
  | { readonly status: "ok"; readonly datos: ConteoProductosDTO }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
