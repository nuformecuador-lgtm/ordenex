import type { OrdenIdentificada } from "@/lib/types/busqueda-por-guia";

/**
 * FICHA 469 (design §2.1–§2.3) — las lecturas de la busqueda por guia que NO son el criterio de aporte:
 * que ordenes identifica un termino, en que cierres estan y que movimientos de una sola orden tienen.
 * SOLO queries. El criterio «esta orden aporta» vive en `ICierreAporteRepository.cierresDondeAporta`
 * (la MISMA traduccion `buildWhere` del detalle de una fila, R34), no aqui.
 *
 * `tiendaId`, cuando viene, va SIEMPRE en el `WHERE` y al final (R5/R29): lo escribe el servicio a partir
 * de la cuenta validada o del actor, nunca de la entrada.
 */
export interface IOrdenIdentificadaRepository {
  /**
   * R2–R7 — las ordenes cuya guia es EXACTAMENTE `guia` (si viene) o cuya remision es el termino sin
   * distinguir mayusculas. Igualdad completa, nunca subcadena (R3). Las borradas cuentan: un cierre pudo
   * congelarlas y su dinero sigue en el libro.
   *
   * `guia` llega ya validada por el servicio (cifras sin cero inicial que caben en `int4`); si no viene,
   * la rama de la guia no se escribe.
   */
  identificar(f: { termino: string; guia?: number; tiendaId?: string }): Promise<OrdenIdentificada[]>;
  /**
   * Los pares (cierre, orden) en los que aparecen esas ordenes (`cierre_detail`, indice por `orden_id`).
   * Son CANDIDATOS: si la orden aporta a algo de ese cierre lo decide `cierresDondeAporta`.
   */
  cierresDeOrdenes(f: { ordenIds: readonly string[]; tiendaId?: string }): Promise<Array<{ cierreId: string; ordenId: string }>>;
  /**
   * R14 — las gestiones de esas ordenes que tienen un cobro por rechazo (`rechazo_tienda_cobro.gestion_id`):
   * el `origen_id` de los cobros por rechazo y de sus anulaciones en la caja y en el libro de la tienda.
   */
  gestionesConCobroPorRechazo(f: { ordenIds: readonly string[]; tiendaId?: string }): Promise<string[]>;
  /** R14 — los incidentes de esas ordenes: el `origen_id` de la indemnizacion por incidente y su anulacion. */
  incidentesDeOrdenes(ordenIds: readonly string[]): Promise<string[]>;
}
