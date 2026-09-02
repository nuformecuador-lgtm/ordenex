// FICHA 345 — el DTO del analisis de productos y el resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React.
//
// ⚠ EL LIMITE DE LA 345, y COMO LO LEVANTA LA 347. La 345 escribio aqui: «aqui no hay ni una
// cifra de dinero… si algun dia se quiere ingreso por producto, es una ficha propia con su
// recorte dicho en pantalla, no un campo mas de este DTO». Esa ficha propia es la **347**, y
// llego con su recorte dicho: el importe COMPLETO de la orden cuenta en CADA producto que
// contiene, y cada fila dice cuantas de sus ordenes iban acompanadas (`ordenesAcompanadas`).
//
// ⚠ LA CONSECUENCIA QUE EL CONTRATO TIENE QUE HACER EXPLICITA: **las cifras de dinero de una
// fila NO SE PUEDEN SUMAR HACIA ABAJO**. Una orden con tres productos aporta su importe ENTERO
// a las tres filas. Sumar la columna cuenta esa plata tres veces. No es un detalle de
// presentacion: es la propiedad que define el modelo de atribucion que el humano eligio, sobre
// la medicion de que NO EXISTE el precio unitario en ninguna parte del sistema
// (`orden.producto` solo trae `cantidad * nombre`) y de que el 12 % de las ordenes lleva varios
// productos. Repartir proporcionalmente inventaria precios; limitarse a las ordenes de un solo
// producto vaciaria productos reales (medido: `BASE C` mostraria ₡15.900 de ₡393.433 y
// `BASE DE COLAGENO | …` no mostraria nada).
//
// Money-safe (R22): TODO importe cruza esta frontera como STRING escala 2. Ninguno es `number`.
// El navegador NO convierte, NO suma, NO resta y NO recalcula.

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
  /**
   * FICHA 347 (R13) — cuantas de las `ordenes` de esta fila llevaban MAS DE UN producto.
   *
   * ENTERO, no dinero, y ADITIVO (a diferencia de las cifras de `dinero`). Es la advertencia
   * que hace legible la columna de recaudado: dice exactamente en cuantas de sus ordenes el
   * importe se esta atribuyendo tambien a otro producto.
   *
   * Sale del lado del VOLUMEN y no del del dinero: tras deduplicar los items de una fila cruda,
   * si quedan dos o mas claves distintas, esas `n` ordenes son acompanadas.
   */
  readonly ordenesAcompanadas: number;
  /**
   * FICHA 347 — las cifras de dinero de esta fila, o `null`.
   *
   * `null` significa UNA de tres cosas, y el estado global (`ConteoProductosDTO.dinero`) dice
   * cual: (a) la concesion esta denegada para este actor (R5: no se emite NINGUNA cifra, ni en
   * cero); (b) el recorte supero el tope y no se sirve ninguna (R76); (c) esta fila no tiene ni
   * una orden que aporte. NUNCA es un `0.00` disfrazado: «no hubo» y «salio cero» son hechos
   * distintos y la pantalla los pinta distinto (R30).
   */
  readonly dinero: DineroProductoDTO | null;
}

/**
 * FICHA 347 — lo LIQUIDADO de una fila: el dinero de ordenes cuyo cierre YA FUE APROBADO y
 * tienen sus entradas congeladas (R26).
 *
 * ⚠ `ordenex` y `tienda` son `string | null`, y el `null` es un requisito (R27/R30/R31): si la
 * fila no tiene NINGUNA orden liquidada, el reparto NO EXISTE y se emite ausente, jamas `0.00`.
 * No se proyecta, no se estima y no se extrapola.
 *
 * ⚠ INVARIANTE EXACTA, SIN MARGEN DE REDONDEO (R20): cuando `ordenex` no es `null`,
 * `ordenex + tienda === recaudado`. Es cierta POR CONSTRUCCION —`tienda` se calcula como esa
 * resta con `pagoTiendaOrdenex`— y no por coincidencia aritmetica.
 */
export interface DineroLiquidadoDTO {
  /** Lo recaudado que ya esta liquidado. STRING escala 2. */
  readonly recaudado: string;
  /** Flete + IVA + comision COD + IVA. `null` = no hay ninguna orden liquidada. */
  readonly ordenex: string | null;
  /** Lo recaudado liquidado MENOS lo que Ordenex le factura. `null`, mismo motivo. */
  readonly tienda: string | null;
  /** Cuantas ORDENES distintas lo componen. Una orden en dos cierres cuenta UNA vez (R18). */
  readonly ordenes: number;
}

/** FICHA 347 (R28) — lo entregado y cobrado que TODAVIA no esta en un cierre aprobado. */
export interface DineroPendienteDTO {
  /** El recaudo, que SI es un hecho: existe desde que se registro la gestion. STRING escala 2. */
  readonly recaudado: string;
  /**
   * Cuantas ORDENES lo componen. DISJUNTO de `liquidado.ordenes`: una orden esta en uno o en
   * otro, nunca en los dos, y `liquidado.ordenes + pendiente.ordenes` es exactamente el numero
   * de ordenes del detalle de esta fila.
   *
   * ⚠ ASIMETRIA DECLARADA, porque existe y es mejor decirla que descubrirla: los IMPORTES se
   * particionan por GESTION (que es lo que hace exacta la invariante de R21) y los CARDINALES
   * por ORDEN, con la regla «una orden es liquidada si tiene AL MENOS UNA gestion liquidada».
   * Consecuencia: una orden con dos gestiones —una en un cierre aprobado y otra no— cuenta en
   * `liquidado.ordenes` y, a la vez, su segunda gestion aporta a `pendiente.recaudado`. Es el
   * caso raro de la orden que aparece en dos cierres (R18); la alternativa —contar la orden en
   * los dos cardinales— romperia el cuadre del detalle, que es la comprobacion que de verdad
   * atrapa un `WHERE` flojo.
   */
  readonly ordenes: number;
}

/**
 * FICHA 347 — las cifras de dinero de UNA fila `(producto, tienda)`.
 *
 * ⚠ NO SUMABLE HACIA ABAJO. Ver la cabecera de este archivo.
 *
 * ⚠ INVARIANTE EXACTA (R21): `liquidado.recaudado + pendiente.recaudado === recaudado`. Cierta
 * por construccion: las gestiones de entrega se particionan en dos y cada una cae en una sola.
 */
export interface DineroProductoDTO {
  /**
   * Lo que las gestiones de ENTREGA cobraron en las ordenes del recorte que contienen este
   * producto (R11), con el importe COMPLETO de cada orden atribuido a cada uno de sus productos
   * (R12).
   */
  readonly recaudado: string;
  readonly liquidado: DineroLiquidadoDTO;
  readonly pendiente: DineroPendienteDTO;
  /**
   * R19 — el cobro de RETORNO de las ordenes rechazadas liquidadas (flete de devolucion + IVA),
   * como cifra APARTE y FUERA del reparto de lo recaudado. `null` si no hay nada liquidado.
   *
   * ⚠ POR QUE FUERA: un rechazo NO recauda cobro contra entrega, asi que no hay plata recogida
   * que repartir; y `pagoTiendaOrdenex` NO descuenta ese flete, por decision ya escrita. Meterlo
   * dentro romperia R20 —`ordenex + tienda` daria `recaudado + retorno`— y, peor, afirmaria que
   * de la plata que el mensajero trajo salio un cobro que nadie recaudo.
   */
  readonly retorno: string | null;
}

/**
 * FICHA 347 — en que estado llega el dinero de esta lectura. DISCRIMINADO, no un booleano:
 * «no te toca», «no cabe» y «aqui esta» son tres respuestas distintas y la pantalla tiene un
 * texto para cada una.
 */
export type EstadoDineroProductos =
  /** El actor lo tiene concedido y las filas traen sus cifras (las que tengan aporte). */
  | { readonly estado: "concedido" }
  /** R5/R6 — prohibido para este rol. NINGUNA fila trae cifras: ni recortadas, ni en cero. */
  | { readonly estado: "denegado" }
  /**
   * R76 — el recorte supera el tope de ordenes de esta lectura. NO se sirve ninguna cifra:
   * una suma sobre un conjunto truncado no se ve incompleta. Las columnas de VOLUMEN siguen
   * mostrandose con normalidad: el tope es de la lectura de dinero, no de la de productos.
   */
  | { readonly estado: "limite_excedido"; readonly limite: number };

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
   * FICHA 347 — el estado del dinero de ESTA lectura, uno solo para toda la tabla.
   *
   * ⚠ VIAJA EN EL MISMO PAYLOAD Y SE RESUELVE EN EL MISMO INSTANTE que el volumen (R78): las
   * columnas de dinero y las de conteo de una misma fila salen de la MISMA lectura, de la MISMA
   * entrada de cache y del MISMO `lastSync`. Con dos lecturas resueltas en instantes distintos
   * —basta una gestion registrada entre ellas— una fila podria decir «6 entregadas» y traer el
   * recaudo de 5.
   */
  readonly dinero: EstadoDineroProductos;
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
