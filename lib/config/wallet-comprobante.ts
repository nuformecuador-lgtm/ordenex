// Ficha 459 (design §8, R54/R55) — configuracion del COMPROBANTE de los movimientos de la caja
// que lo admiten (pago por cuenta de una tienda; saldo inicial o aporte de capital; y la 457, que
// lo reutiliza para el pago recibido de una tienda). Patron de `lib/config/gestion.ts`: sin
// hardcode de cotas de negocio ni del nombre del bucket (docs/architecture.md).
//
// OPERACIONES: ninguna migracion crea buckets. `wallet-comprobantes` se crea PRIVADO a mano en
// local, preview y produccion ANTES de desplegar el bloque B. Sin bucket, registrar SIN
// comprobante funciona y CON comprobante responde `comprobante_no_guardado` (falla ruidoso, R56).

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** R54 — tipos aceptados: imagen JPEG, PNG o WebP, o documento PDF. */
export const WALLET_COMPROBANTE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type WalletComprobanteMime = (typeof WALLET_COMPROBANTE_MIME)[number];

/** Extension del objeto por tipo MIME (R55: el nombre es aleatorio, la extension no). */
export const WALLET_COMPROBANTE_EXTENSION: Record<WalletComprobanteMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export interface WalletComprobanteConfig {
  /** Bucket PRIVADO de Supabase Storage (sin URL publica, R55). */
  BUCKET: string;
  /**
   * Tope por archivo en bytes (R54). Default 4 MB: el limite de las Server Actions es
   * `bodySizeLimit: "5mb"` (`next.config.ts`) CON el multipart y los demas campos, y no se toca.
   */
  MAX_BYTES: number;
  /** Vida de la URL firmada del comprobante, en segundos (R57). Default 5 min. */
  SIGNED_URL_TTL_SECONDS: number;
}

export function loadWalletComprobanteConfig(): WalletComprobanteConfig {
  return {
    BUCKET: process.env.WALLET_COMPROBANTE_BUCKET?.trim() || "wallet-comprobantes",
    MAX_BYTES: readPositiveInt("WALLET_COMPROBANTE_MAX_BYTES", 4 * 1024 * 1024),
    SIGNED_URL_TTL_SECONDS: readPositiveInt("WALLET_COMPROBANTE_SIGNED_URL_TTL_SECONDS", 5 * 60),
  };
}

export const walletComprobanteConfig: WalletComprobanteConfig = loadWalletComprobanteConfig();
