import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { BUCKETS, type TBucket } from "@/lib/storage/buckets";

// Util de lectura para los buckets PRIVADOS: genera un enlace de descarga
// TEMPORAL (URL firmada) contra el bucket indicado. Solo servidor: firma con el
// service role via createServerClient (dentro de SupabaseSignedUrlProvider),
// nunca desde el cliente. No devuelve URLs publicas (R18/R8).

/** Valor de respaldo del TTL si el env no trae uno valido (5 min). */
const FALLBACK_SIGNED_URL_TTL_SECONDS = 300;

/**
 * TTL por defecto del enlace temporal, en segundos. Se resuelve por env
 * (`DEFAULT_SIGNED_URL_TTL_SECONDS`); si la variable falta, esta vacia o no es
 * un entero positivo, cae a 300 s (sin hardcode de contexto, patron lib/config).
 */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = ((): number => {
  const raw = process.env.DEFAULT_SIGNED_URL_TTL_SECONDS;
  if (raw === undefined || raw.trim() === "") return FALLBACK_SIGNED_URL_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_SIGNED_URL_TTL_SECONDS;
})();

/**
 * Enlace temporal de descarga de un objeto de Storage.
 *
 * @param bucket bucket privado destino (ver `BUCKETS`)
 * @param file path del objeto DENTRO del bucket (no URL)
 * @param expiresInSeconds TTL del enlace; por defecto `DEFAULT_SIGNED_URL_TTL_SECONDS`
 * @throws si el objeto no existe o la firma falla
 */
export async function getFile(
  bucket: TBucket,
  file: string,
  expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  return new SupabaseSignedUrlProvider(undefined, bucket).createSignedUrl(file, expiresInSeconds);
}

/**
 * Variante en lote: firma varios paths del MISMO bucket en una sola llamada.
 * Devuelve un mapa `path -> URL firmada`.
 */
export async function getFiles(
  bucket: TBucket,
  files: string[],
  expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<Record<string, string>> {
  return new SupabaseSignedUrlProvider(undefined, bucket).createSignedUrls(files, expiresInSeconds);
}

export { BUCKETS };
export type { TBucket };
