import { createServerClient } from "@/lib/supabase/client";
import { postulacionConfig } from "@/lib/config/postulacion";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";

// Feature 22 (R8/R9) — implementacion de ISignedUrlProvider sobre Supabase
// Storage. Firma URLs temporales de objetos del bucket PRIVADO `mensajero-docs`
// con el service role (createServerClient), nunca desde el cliente. El cliente
// se inyecta para testear sin red (patron StorageClientLike de SupabaseFileStorage).
// No hardcodea URL/keys: viven en env via createServerClient.

/** Superficie minima del cliente Storage de Supabase que usamos (testeable). */
export interface SignedUrlClientLike {
  from(bucket: string): {
    createSignedUrl(
      path: string,
      expiresIn: number,
    ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    createSignedUrls(
      paths: string[],
      expiresIn: number,
    ): Promise<{
      data: Array<{ path: string | null; signedUrl: string; error: string | null }> | null;
      error: { message: string } | null;
    }>;
  };
}

export class SupabaseSignedUrlProvider implements ISignedUrlProvider {
  private readonly bucket: string;

  constructor(
    private readonly storage: SignedUrlClientLike = createServerClient()
      .storage as unknown as SignedUrlClientLike,
    bucket: string = postulacionConfig.BUCKET,
  ) {
    this.bucket = bucket;
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) {
      throw new Error(`fallo al firmar URL de documento: ${error?.message ?? "sin data"}`);
    }
    return data.signedUrl;
  }

  async createSignedUrls(
    paths: string[],
    expiresInSeconds: number,
  ): Promise<Record<string, string>> {
    if (paths.length === 0) return {};
    const { data, error } = await this.storage
      .from(this.bucket)
      .createSignedUrls(paths, expiresInSeconds);
    if (error || !data) {
      throw new Error(`fallo al firmar URLs de documentos: ${error?.message ?? "sin data"}`);
    }
    const result: Record<string, string> = {};
    for (const entry of data) {
      if (entry.error || !entry.path) {
        throw new Error(`fallo al firmar URL de documento: ${entry.error ?? "path vacio"}`);
      }
      result[entry.path] = entry.signedUrl;
    }
    return result;
  }
}
