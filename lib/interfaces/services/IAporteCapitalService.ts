import type { AporteCapitalTxClient } from "@/lib/interfaces/repositories/IAporteCapitalRepository";
import type { CajaAporteCapitalTxClient } from "@/lib/interfaces/services/ICajaAporteCapitalFeedService";
import type { ComprobanteRecibido } from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularAporteCapitalInput,
  AnularAporteCapitalResult,
  RegistrarAporteCapitalInput,
  RegistrarAporteCapitalResult,
} from "@/lib/types/aporte-capital";
import type { ObtenerComprobanteResult } from "@/lib/types/pago-por-cuenta-tienda";

/** FICHA 459 (design §6.2) — la transaccion del saldo inicial o aporte: documento + caja. */
export type AporteCapitalTx = AporteCapitalTxClient & CajaAporteCapitalTxClient;
export type AporteCapitalTxRunner = <T>(fn: (tx: AporteCapitalTx) => Promise<T>) => Promise<T>;

export type RegistrarAporteCapitalServiceResult = Exclude<
  RegistrarAporteCapitalResult,
  { status: "unauthenticated" }
>;
export type AnularAporteCapitalServiceResult = Exclude<
  AnularAporteCapitalResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;
export type ObtenerComprobanteAporteServiceResult = Exclude<
  ObtenerComprobanteResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;

export interface IAporteCapitalService {
  registrar(
    input: RegistrarAporteCapitalInput,
    comprobante: ComprobanteRecibido | null,
    actor: Actor,
  ): Promise<RegistrarAporteCapitalServiceResult>;
  anular(input: AnularAporteCapitalInput, actor: Actor): Promise<AnularAporteCapitalServiceResult>;
  obtenerComprobante(
    aporteId: string,
    actor: Actor,
  ): Promise<ObtenerComprobanteAporteServiceResult>;
  // ⚠️ R27: ningun metodo devuelve, propone ni calcula un importe «sugerido» de saldo inicial.
}
