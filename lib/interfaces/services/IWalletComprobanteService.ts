import type {
  ComprobanteGuardado,
  DestinoLateral,
  WalletComprobanteTxClient,
} from "@/lib/interfaces/repositories/IWalletComprobanteRepository";
import type { ComprobanteRecibido } from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DestinoMovimiento } from "@/lib/types/wallet-anulacion";
import type { AdjuntarComprobanteResult, VerComprobanteResult } from "@/lib/types/wallet-comprobante-lateral";
import type { DocumentoConComprobante } from "@/lib/utils/comprobante";

export type { ComprobanteRecibido };

/** Las carpetas del comprobante LATERAL (las de los documentos de la 459/457 las usan sus servicios). */
export type CarpetaLateral = Extract<DocumentoConComprobante, "wallet_movimiento" | "wallet_tienda_movimiento" | "liquidacion_pago">;

/** El resultado de subir el archivo ANTES de la transaccion de un registro (R75/R76). */
export type SubidaComprobante =
  | { status: "ok"; guardado: ComprobanteGuardado }
  /** R75 — tipo o tamano: el motivo, para pintarlo bajo el campo. Nada se subio. */
  | { status: "invalido"; problema: string }
  /** R76 — el almacenamiento fallo: nada se subio y el movimiento NO se registra. */
  | { status: "no_guardado" };

/** Resultados de DOMINIO: `unauthenticated` y `validation_error` de forma los decide la Server Action. */
export type AdjuntarComprobanteServiceResult = Exclude<AdjuntarComprobanteResult, { status: "unauthenticated" }>;
export type VerComprobanteServiceResult = Exclude<VerComprobanteResult, { status: "unauthenticated" | "validation_error" }>;

/**
 * FICHA 458-B (design §4.1, D6/D12, R74–R80) — el comprobante de los caminos SIN documento propio.
 *
 * Dos usos:
 *  - AL REGISTRAR (sueldo, gasto, correccion, cobro, pago a tienda/mensajero; TB.11): el camino llama
 *    `subir` ANTES de su transaccion, `registrarEnTx` DENTRO de ella y `retirar` si no quedo registrado.
 *  - DESPUES (D6/R79): `adjuntar`, una sola vez, solo acceso total; `ver` con enlace temporal (R77/R78).
 */
export interface IWalletComprobanteService {
  subir(carpeta: CarpetaLateral, comprobante: ComprobanteRecibido): Promise<SubidaComprobante>;
  /** Inserta la fila en la transaccion del registro. `ya_tiene` = el UNIQUE del destino (R79). */
  registrarEnTx(
    tx: WalletComprobanteTxClient,
    destino: DestinoLateral,
    guardado: ComprobanteGuardado,
    subidoPor: string,
  ): Promise<"creado" | "ya_tiene">;
  /** R76 — retira el objeto subido cuando el registro no llego a escribirse. No lanza. */
  retirar(guardado: ComprobanteGuardado): Promise<void>;
  adjuntar(destino: DestinoMovimiento, comprobante: ComprobanteRecibido, actor: Actor): Promise<AdjuntarComprobanteServiceResult>;
  ver(destino: DestinoMovimiento, actor: Actor): Promise<VerComprobanteServiceResult>;
}

export type WalletComprobanteTxRunner = <T>(fn: (tx: WalletComprobanteTxClient) => Promise<T>) => Promise<T>;
