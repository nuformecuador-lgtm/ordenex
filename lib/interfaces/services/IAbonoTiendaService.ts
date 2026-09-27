import type { AbonoTiendaTxClient } from "@/lib/interfaces/repositories/IAbonoTiendaRepository";
import type { LiquidacionPagoTxClient } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { WalletTiendaTxClient } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { CajaAbonoTiendaTxClient } from "@/lib/interfaces/services/ICajaAbonoTiendaFeedService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ComprobanteRecibido } from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import type {
  AnularAbonoTiendaInput,
  AnularAbonoTiendaResult,
  ObtenerComprobanteAbonoResult,
  RegistrarAbonoTiendaInput,
  RegistrarAbonoTiendaResult,
} from "@/lib/types/abono-tienda";

/**
 * FICHA 457 (design §5) — el cliente de la transaccion del pago de una tienda a Ordenex: el documento
 * y su historial, el libro de la tienda, la caja y el candado de la tienda (el MISMO que toma el pago
 * de Ordenex a esa tienda y el pago de un gasto, R16).
 */
export type AbonoTiendaTx = AbonoTiendaTxClient &
  WalletTiendaTxClient &
  CajaAbonoTiendaTxClient &
  LiquidacionPagoTxClient;

export type AbonoTiendaTxRunner = <T>(fn: (tx: AbonoTiendaTx) => Promise<T>) => Promise<T>;

export type { ComprobanteRecibido };

/** Resultados de DOMINIO: `unauthenticated` lo decide la Server Action, nunca el servicio. */
export type RegistrarAbonoTiendaServiceResult = Exclude<
  RegistrarAbonoTiendaResult,
  { status: "unauthenticated" }
>;
export type AnularAbonoTiendaServiceResult = Exclude<
  AnularAbonoTiendaResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;
export type ObtenerComprobanteAbonoServiceResult = Exclude<
  ObtenerComprobanteAbonoResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;

export interface IAbonoTiendaService {
  registrar(
    input: RegistrarAbonoTiendaInput,
    comprobante: ComprobanteRecibido | null,
    actor: Actor,
  ): Promise<RegistrarAbonoTiendaServiceResult>;
  anular(input: AnularAbonoTiendaInput, actor: Actor): Promise<AnularAbonoTiendaServiceResult>;
  obtenerComprobante(abonoId: string, actor: Actor): Promise<ObtenerComprobanteAbonoServiceResult>;
  // ⚠️ NO hay metodo para editar un pago de una tienda ni para deshacer su anulacion (R40).
}
