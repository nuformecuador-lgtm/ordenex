import type { PrismaClient } from "@prisma/client";

/**
 * FICHA 458-B (D12, R74–R80) — el contrato de `wallet_comprobante`: el archivo de los caminos SIN
 * documento propio. SOLO queries. Un destino por fila: un movimiento de caja, un movimiento de tienda o
 * un pago de la 172, y el UNIQUE de cada destino es R79 (un segundo comprobante choca).
 */
export type WalletComprobanteTxClient = Pick<PrismaClient, "walletComprobante">;

/** A QUE cuelga el comprobante lateral: una fila de la caja, una de la tienda o un pago (172). */
export type DestinoLateral = { caja: string } | { tienda: string } | { pago: string };

/** Los documentos de la 459/457 que guardan su comprobante en SU fila (`comprobante_path`). */
export type DocumentoConComprobantePropio = "pago_por_cuenta_tienda" | "aporte_capital" | "abono_tienda";

export interface ComprobanteGuardado {
  storagePath: string;
  contentType: string;
}

/** El objeto de un comprobante (o su ausencia). La ruta NUNCA sale del servicio (R80). */
export interface ObjetoComprobante {
  storagePath: string;
  contentType: string;
}

/** De quien es un destino y cuando fue: el alcance de la tienda (R77/R78) y el rotulo (R80). */
export interface DuenoDeDestino {
  /** La tienda duena de la fila o del documento; `null` = de la caja o de un mensajero. */
  tiendaId: string | null;
  /** La categoria de la fila (caja/tienda) o el tipo del documento (pago de la 172: `liquidacion_pago`). */
  categoria: string;
  /** El instante de la fila, o el dia (`@db.Date`) del documento. */
  fecha: Date;
}

export interface IWalletComprobanteRepository {
  /**
   * R74/R79 — inserta el comprobante lateral en `tx`. `createMany({ skipDuplicates })`: `ya_tiene` =
   * el UNIQUE del destino ya tenia fila (no se interpreta un P2002).
   */
  crear(
    tx: WalletComprobanteTxClient,
    destino: DestinoLateral,
    comprobante: ComprobanteGuardado & { subidoPor: string },
  ): Promise<"creado" | "ya_tiene">;
  /** El comprobante lateral de un destino, o `null` si no tiene. */
  lateralDe(destino: DestinoLateral): Promise<ObjetoComprobante | null>;
  /** De quien es y cuando fue un destino lateral; `null` = no existe. */
  duenoDeLateral(destino: DestinoLateral): Promise<DuenoDeDestino | null>;
  /** El documento de la 459/457 con su comprobante (`null` en las dos columnas si no tiene); `null` = no existe. */
  documento(
    tipo: DocumentoConComprobantePropio,
    id: string,
  ): Promise<(DuenoDeDestino & { comprobante: ObjetoComprobante | null }) | null>;
  /** La tienda de una fila del libro de las tiendas (el alcance de la tienda, R77); `null` = no existe. */
  tiendaDeFila(movimientoId: string): Promise<string | null>;
}
