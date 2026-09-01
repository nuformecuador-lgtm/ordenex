// FICHA 345 — el puerto de lectura del analisis de productos. Contrato NEUTRAL: sin Prisma y
// sin Next.

import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";

/**
 * Una fila tal y como la agrupa la BASE: `(tienda, texto CRUDO de producto, desenlace)` con
 * cuantas ordenes le corresponden.
 *
 * ⚠ EL REPOSITORIO NO PARSEA. El texto viaja TAL CUAL esta en la columna, y quien lo interpreta
 * es el servicio con `parsearProducto`. Los dos motivos, y ninguno es estetico:
 *
 *  (a) **el numero de filas queda acotado por el CATALOGO, no por las ventas** (R57): N ordenes
 *      con el mismo texto son UNA fila. Ese numero crece con los productos distintos que las
 *      tiendas escriben, no con cuanto venden;
 *  (b) el parser es el corazon de la ficha y sus dos trampas —el punto interno y las barras
 *      verticales— se prueban con cadenas reales y SIN base de datos. En SQL harian falta
 *      Postgres para probarlas y, ademas, una SEGUNDA implementacion de la misma regla, porque
 *      la deduplicacion por orden (R26) hace falta igualmente en Node.
 */
export interface FilaProductoCruda {
  readonly tiendaId: string;
  /** `usuario.nombre` de la tienda. La fila se identifica por NOMBRE en la pantalla (R38). */
  readonly tiendaNombre: string;
  /** el texto TAL CUAL esta en la base; el repositorio NO parsea */
  readonly producto: string;
  /**
   * El DESENLACE de esas ordenes, con la MISMA regla que el desglose por estado (R27): el
   * `resultado` de la ultima gestion vigente y, si nunca se gestiono, el `value` de su
   * `order_status`.
   */
  readonly status: string;
  /** Ordenes en ese grupo. Entero >= 1: el `GROUP BY` no emite grupos vacios. */
  readonly n: number;
}

export interface IConteoProductosRepository {
  /**
   * Cuenta ordenes agrupadas por `(tienda, texto de producto, desenlace)` sobre las tablas
   * VIVAS, ya recortadas por el alcance que viaja DENTRO de `consulta`.
   *
   * Recibe un `ConsultaProductos` y no un `ConsultaConteoEntregas` a proposito: el alcance de
   * esta lectura DIVERGE (un `adminSatelite` esta PROHIBIDO aqui y tiene `{tipo:"zona"}` alli),
   * asi que compartir el tipo dejaria compilar el paso de una consulta por la otra.
   */
  contarProductos(consulta: ConsultaProductos): Promise<readonly FilaProductoCruda[]>;
}
