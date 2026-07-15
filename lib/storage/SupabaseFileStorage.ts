import { createServerClient } from "@/lib/supabase/client";
import { postulacionConfig } from "@/lib/config/postulacion";
import type { IFileStorage, UploadInput } from "@/lib/interfaces/external/IFileStorage";

// Feature 21 — implementacion de IFileStorage sobre Supabase Storage (A2). Sube
// al bucket PRIVADO `mensajero-docs` con el service role (nunca desde el cliente
// con anon key). NUNCA genera URL publica (R18): solo guarda paths; la lectura
// futura (feature 22) usara URL firmada.
//
// El cliente Storage se inyecta (o se construye con createServerClient) para
// poder testear sin red. No hardcodea URL/keys: viven en env via createServerClient.

/** Superficie minima del cliente Storage de Supabase que usamos (testeable). */
export interface StorageClientLike {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array | ArrayBuffer | Blob,
      options?: { contentType?: string; upsert?: boolean },
    ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
    remove(paths: string[]): Promise<{ error: { message: string } | null }>;
  };
}

export class SupabaseFileStorage implements IFileStorage {
  private readonly bucket: string;
  private storageClient: StorageClientLike | undefined;

  constructor(storage?: StorageClientLike, bucket: string = postulacionConfig.BUCKET) {
    // El cliente inyectado (tests) se guarda; si no se pasa, se crea PEREZOSAMENTE
    // en el primer uso real (upload/remove). Asi, construir este repo para un flujo
    // de SOLO LECTURA (p. ej. listar "mis asignaciones") NO exige la config de
    // Supabase ni llama a createServerClient() al instanciar.
    this.storageClient = storage;
    this.bucket = bucket;
  }

  /** Cliente Storage perezoso: crea (y lee env via createServerClient) al 1er uso. */
  private get storage(): StorageClientLike {
    if (!this.storageClient) {
      this.storageClient = createServerClient().storage as unknown as StorageClientLike;
    }
    return this.storageClient;
  }

  async upload(input: UploadInput): Promise<string> {
    const { data, error } = await this.storage.from(this.bucket).upload(input.path, input.bytes, {
      contentType: input.contentType,
      upsert: false,
    });
    if (error || !data) {
      throw new Error(`fallo al subir documento a storage: ${error?.message ?? "sin data"}`);
    }
    return data.path;
  }

  async remove(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    // Best-effort (R24): no propaga el error para no enmascarar la causa raiz
    // del rollback que dispara la limpieza.
    await this.storage.from(this.bucket).remove(paths);
  }
}
