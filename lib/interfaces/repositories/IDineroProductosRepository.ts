// FICHA 347 — el puerto de lectura del DINERO por producto. Contrato NEUTRAL: sin Prisma y sin
// Next. Money-safe: todo importe cruza este contrato como STRING escala 2, nunca `number` y
// nunca `Prisma.Decimal`.

import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { GestionDeDinero } from "@/lib/utils/dinero-por-producto";

/**
 * UNA fila cruda del dinero. GRANO: `(orden, gestion)`.
 *
 * ⚠ POR QUE EL GRANO ES LA GESTION Y NO LA ORDEN. Una orden puede aparecer en MAS DE UN CIERRE
 * —el `@@index([ordenId])` de `cierre_detail` existe justamente para eso— y cada par
 * `(cierre, orden)` congelo SUS PROPIAS entradas de la formula. Con grano orden habria que
 * elegir un snapshot y tirar el otro; con grano gestion, R18 sale sin caso especial: cada
 * gestion trae el suyo y `repartoDeOrden` las suma.
 *
 * ⚠ A DIFERENCIA DE LA LECTURA DE VOLUMEN, ESTA NO ESTA ACOTADA POR EL CATALOGO. Aquella
 * devuelve una fila por `(tienda, texto, desenlace)` y crece con los productos distintos; esta
 * devuelve una fila por gestion aportante y crece con las VENTAS. Es el coste declarado de
 * derivar orden por orden, y por eso lleva tope con estado explicito (R76).
 */
export interface FilaDineroCruda extends GestionDeDinero {
  readonly ordenId: string;
  readonly tiendaId: string;
  /** `usuario.nombre` de la tienda. La fila se identifica por NOMBRE, igual que en el volumen. */
  readonly tiendaNombre: string;
  /** El texto TAL CUAL esta en `orden.producto`; el repositorio NO parsea (mismo criterio 345). */
  readonly producto: string;
  /** El numero VISIBLE: `num_guia` si la orden llego a tenerla, si no `num_remision`. */
  readonly guia: string;
  /**
   * `orden.num_guia` CRUDO, o `null`. NO viaja al cliente: existe solo para ORDENAR el detalle
   * por guia igual que lo hace el panel de la 344 (`ORDEN_TOTAL`), o sea NUMERICAMENTE. Con la
   * cadena de `guia` el orden seria lexicografico y la pagina 1 empezaria en «1, 10, 11, 2».
   */
  readonly numGuia: number | null;
  readonly destinatario: string;
  /** Id de la gestion. Solo sirve para desempatar y para probar el grano; no viaja al cliente. */
  readonly gestionId: string;
}

/** Lo que devuelve la lectura: las filas, o el aviso de que el recorte supera el tope (R76). */
export type LecturaDineroProductos =
  | { readonly estado: "ok"; readonly filas: readonly FilaDineroCruda[] }
  /**
   * R76 / alternativa A10 — O VAN TODAS LAS ORDENES, O NO VA NINGUNA. Nunca se sirve una suma
   * sobre un conjunto truncado: una cifra de dinero incompleta NO SE VE INCOMPLETA, y es el peor
   * de los resultados posibles. Mismo criterio que `DetalleMovimientoService.comoArchivo`.
   */
  | { readonly estado: "limite_excedido"; readonly limite: number };

export interface IDineroProductosRepository {
  /**
   * Las gestiones que aportan dinero sobre las ordenes del recorte, ya recortadas por el
   * alcance que viaja DENTRO de `consulta`.
   *
   * Recibe la MISMA `ConsultaProductos` que la lectura de volumen (alternativa A9): no hay una
   * segunda consulta preparada, asi que no hay una segunda puerta de alcance que pudiera
   * divergir de la primera.
   */
  leerDineroPorOrden(consulta: ConsultaProductos): Promise<LecturaDineroProductos>;
}
