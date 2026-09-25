import type { PagoPorCuentaTxClient } from "@/lib/interfaces/repositories/IPagoPorCuentaTiendaRepository";
import type { LiquidacionPagoTxClient } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { WalletTiendaTxClient } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { CajaPagoPorCuentaTxClient } from "@/lib/interfaces/services/ICajaPagoPorCuentaFeedService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularPagoPorCuentaTiendaInput,
  AnularPagoPorCuentaTiendaResult,
  ObtenerComprobanteResult,
  RegistrarPagoPorCuentaTiendaInput,
  RegistrarPagoPorCuentaTiendaResult,
} from "@/lib/types/pago-por-cuenta-tienda";

/**
 * FICHA 459 (design §6.1) — el cliente de la transaccion del pago por cuenta: el documento y su
 * historial, el libro de la tienda, la caja y el candado de la tienda (el MISMO que toma el pago
 * a tienda, R42).
 */
export type PagoPorCuentaTx = PagoPorCuentaTxClient &
  WalletTiendaTxClient &
  CajaPagoPorCuentaTxClient &
  LiquidacionPagoTxClient;

export type PagoPorCuentaTxRunner = <T>(fn: (tx: PagoPorCuentaTx) => Promise<T>) => Promise<T>;

/** El comprobante ya leido por el borde: tipo y bytes (el tamano se revalida aqui). */
export interface ComprobanteRecibido {
  contentType: string;
  bytes: Uint8Array;
}

/** Resultados de DOMINIO: `unauthenticated` lo decide la Server Action, nunca el servicio. */
export type RegistrarPagoPorCuentaServiceResult = Exclude<
  RegistrarPagoPorCuentaTiendaResult,
  { status: "unauthenticated" }
>;
export type AnularPagoPorCuentaServiceResult = Exclude<
  AnularPagoPorCuentaTiendaResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;
export type ObtenerComprobanteServiceResult = Exclude<
  ObtenerComprobanteResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;

export interface IPagoPorCuentaTiendaService {
  registrar(
    input: RegistrarPagoPorCuentaTiendaInput,
    comprobante: ComprobanteRecibido | null,
    actor: Actor,
  ): Promise<RegistrarPagoPorCuentaServiceResult>;
  anular(
    input: AnularPagoPorCuentaTiendaInput,
    actor: Actor,
  ): Promise<AnularPagoPorCuentaServiceResult>;
  obtenerComprobante(pagoId: string, actor: Actor): Promise<ObtenerComprobanteServiceResult>;
  // ⚠️ NO hay metodo para editar un pago por cuenta ni para deshacer su anulacion (R52).
}
