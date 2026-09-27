import type { MetodoPagoValue } from "@prisma/client";

// Ficha 458-A (TA.2, design §3.3) — las lecturas EN LOTE con que se nombra la entidad de origen de
// una pagina de movimientos. Cada metodo recibe los ids de UN tipo de origen y hace UNA consulta
// (`WHERE id IN (...)`); el servicio solo llama a los tipos presentes en la pagina (molde:
// `WalletService.conDocumentos`). Ningun metodo devuelve importes: solo lo que se nombra.

/** Un cierre del dia: su instante de solicitud (ISO) y el mensajero, ya con `etiquetaDeCuenta`. */
export type CierreDeOrigen = { id: string; solicitadoAt: string; mensajero: string };

/**
 * Una gestion de orden o un incidente: la guia de su orden y su remision. La guia NO es un
 * identificador interno (requirements, «Vocabulario»): es un dato del negocio y se pinta.
 */
export type OrdenDeOrigen = { id: string; guia: string | null; remision: string | null };

/** Un pago de la 172 (`liquidacion_pago`): dia del pago (`YYYY-MM-DD`), metodo y beneficiario. */
export type PagoDeOrigen = {
  id: string;
  fechaPago: string;
  metodo: MetodoPagoValue;
  beneficiario: string;
};

/** Una fila del podio del ranking: el dia del podio (`YYYY-MM-DD`). */
export type PodioDeOrigen = { id: string; fecha: string };

/** El pago de un gasto de una tienda (459): la tienda y a quien se le pago. */
export type PagoPorCuentaDeOrigen = { id: string; tienda: string; beneficiario: string };

/** El pago de una tienda a Ordenex (457): la tienda, el dia (`YYYY-MM-DD`) y el metodo. */
export type AbonoDeOrigen = { id: string; tienda: string; fechaPago: string; metodo: MetodoPagoValue };

/** Una fila del libro de la tienda (el debito del cobro, 461): de que tienda es. */
export type MovimientoTiendaDeOrigen = { id: string; tienda: string };

export interface IOrigenLegibleRepository {
  cierres(ids: readonly string[]): Promise<CierreDeOrigen[]>;
  gestiones(ids: readonly string[]): Promise<OrdenDeOrigen[]>;
  incidentes(ids: readonly string[]): Promise<OrdenDeOrigen[]>;
  pagos(ids: readonly string[]): Promise<PagoDeOrigen[]>;
  podios(ids: readonly string[]): Promise<PodioDeOrigen[]>;
  pagosPorCuenta(ids: readonly string[]): Promise<PagoPorCuentaDeOrigen[]>;
  abonos(ids: readonly string[]): Promise<AbonoDeOrigen[]>;
  movimientosTienda(ids: readonly string[]): Promise<MovimientoTiendaDeOrigen[]>;
}
