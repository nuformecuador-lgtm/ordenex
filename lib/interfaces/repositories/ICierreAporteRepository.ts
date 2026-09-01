import type { GestionDelCierre, OrdenCongelada } from "@/lib/utils/aporte-por-orden";
import type { CriterioDeAporte } from "@/lib/utils/aporte-por-orden";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

/**
 * Ficha 344 (design §3.4) — contrato del repositorio que responde «que ordenes de este cierre
 * aportan a este concepto». Solo queries Prisma; sin logica de negocio y sin permisos.
 *
 * La raiz de la consulta es `cierre_detail` porque el grano pedido es la ORDEN (R20) y porque su
 * `@@unique([cierreId, ordenId])` da a la vez el grano y el indice de la ruta caliente. NO se
 * anade ningun indice: es la ruta que esa tabla ya declara caliente.
 *
 * Money-safe: aqui no se calcula dinero. Se proyectan las ENTRADAS congeladas (Decimal -> STRING
 * escala 2) y quien deriva es `aporteDeOrden`, con la formula que ya existia.
 */

/** El acotamiento por tienda, cuando lo hay. `undefined` = la caja principal, sin acotar. */
export interface AlcanceDeCierre {
  cierreId: string;
  /**
   * `adminTienda` ES la tienda: su `usuarioId` es el `tienda_id` congelado. Va SIEMPRE en el
   * `WHERE` (R40), nunca filtrando en memoria, y lo escribe el servicio a partir del ACTOR —
   * jamas de la entrada del cliente (R42).
   */
  tiendaId?: string;
}

export interface FiltroOrdenesQueAportan extends AlcanceDeCierre {
  /**
   * El criterio del concepto, tal como lo declara `CRITERIO_DE_APORTE`. El repositorio lo
   * TRADUCE a `WHERE` y no lo interpreta: si aqui se escribiera una condicion propia, existiria
   * una segunda definicion del criterio, que es lo que R18 prohibe.
   */
  criterio: CriterioDeAporte;
  rango: RangoPagina;
}

/**
 * Una ORDEN del cierre, con todo lo que hace falta para pintarla y para RE-DERIVAR su aporte.
 *
 * Todo sale del SNAPSHOT (R22): ni la orden, ni la zona, ni la tarifa VIGENTES. `gestiones` son
 * las de ESA orden en ESE cierre, y vienen TODAS —no solo las que casan con el criterio—, porque
 * el importe del movimiento se produjo acumulando todas: recortarlas aqui descuadraria la suma.
 */
export interface OrdenAporteRow {
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  tiendaNombre: string;
  orden: OrdenCongelada;
  gestiones: GestionDelCierre[];
}

/** La cabecera del panel: de que cierre sale el importe (R9) y quien lo movio (R15). */
export interface CabeceraDeCierre {
  /** ISO de `cierre_dia.solicitado_at`, la fecha por la que este repo identifica un cierre. */
  fecha: string;
  /** Nombre completo del mensajero. El servicio decide si viaja o no (en la tienda, NO). */
  mensajeroNombre: string;
}

export interface ICierreAporteRepository {
  /**
   * R16/R21/R24/R28/R30 — UNA pagina de las ordenes que aportan, y el TOTAL del conjunto.
   *
   * Los dos salen del MISMO `where`, en la misma llamada: si el conteo se resolviera con otro
   * `where`, el detalle y su total hablarian de conjuntos distintos y nadie lo veria.
   */
  listarOrdenesQueAportan(f: FiltroOrdenesQueAportan): Promise<PaginaRepositorio<OrdenAporteRow>>;
  /**
   * R12 — cuantas ordenes tiene el cierre DENTRO del alcance del actor. Es el «de 23» de la
   * frase «14 de 23», y lleva el MISMO acotamiento por tienda: sin el, `/mi-wallet` contaria
   * ordenes ajenas.
   */
  contarOrdenesDelCierre(f: AlcanceDeCierre): Promise<number>;
  /** R9/R15 — la fecha del cierre y el nombre del mensajero. `null` si el cierre no existe. */
  obtenerCabeceraDeCierre(cierreId: string): Promise<CabeceraDeCierre | null>;
}
