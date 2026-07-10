// Feature 22 — contrato de firma de URLs temporales del bucket privado (R8/R9).
// Se separa de IFileStorage (que es de escritura: upload/remove) para no mezclar
// responsabilidades; la implementacion usa
// supabase.storage.from(bucket).createSignedUrl(s).

export interface ISignedUrlProvider {
  /** URL firmada de un objeto privado, valida por `expiresInSeconds` (R9). */
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
  /**
   * URLs firmadas de varios objetos en una sola llamada (evita N round-trips por
   * usuario). Devuelve un mapa path -> url firmada.
   */
  createSignedUrls(
    paths: string[],
    expiresInSeconds: number,
  ): Promise<Record<string, string>>;
}
