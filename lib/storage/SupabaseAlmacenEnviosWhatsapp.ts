import { createServerClient } from "@/lib/supabase/client";
import { bucketEnviosWhatsapp } from "@/lib/config/whatsapp-envios";
import type { IAlmacenEnviosWhatsapp } from "@/lib/interfaces/external/IAlmacenEnviosWhatsapp";

// Ficha 474 (design §5.3, R43/R44) — PDFs de las ejecuciones de envios por WhatsApp sobre Supabase
// Storage, con el service role. Clon del patron de `SupabaseAlmacenDescargas` (470): cliente
// PEREZOSO e INYECTABLE (los tests pasan un doble: el `.env` local apunta a Storage de produccion),
// bucket PRIVADO creado en el primer uso, `upsert: false`, URL FIRMADA y nunca publica.
//
// NO se reutiliza el bucket de la 470 (alternativa C del design): retiene 60 min y purga por
// listado de `tmp/`; aqui se retiene 30 dias y la purga es POR BASE (`pdf_caduca_at`).

type ErrorSdk = { message: string; status?: number | string; statusCode?: number | string } | null;

/** Superficie minima del cliente Storage de Supabase que usa este almacen (testeable). */
export interface EnviosStorageClientLike {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array,
      options?: { contentType?: string; upsert?: boolean },
    ): Promise<{ data: { path: string } | null; error: ErrorSdk }>;
    download(path: string): Promise<{ data: Blob | null; error: ErrorSdk }>;
    createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: ErrorSdk }>;
    remove(paths: string[]): Promise<{ data: unknown; error: ErrorSdk }>;
  };
  createBucket(id: string, options: { public: boolean }): Promise<{ data: unknown; error: ErrorSdk }>;
}

const CONTENT_TYPE = "application/pdf";

function esBucketInexistente(error: ErrorSdk): boolean {
  if (!error) return false;
  return /bucket not found|not found/i.test(error.message) || String(error.statusCode) === "404" || String(error.status) === "404";
}

function esBucketYaExistente(error: ErrorSdk): boolean {
  if (!error) return false;
  return /already exists/i.test(error.message) || String(error.statusCode) === "409" || String(error.status) === "409";
}

/** Ruta UNICA por ejecucion (R43). Los ids son UUID: no llevan nada del usuario. */
export function rutaPdfEjecucion(envioId: string, ejecucionId: string): string {
  return `${envioId}/${ejecucionId}.pdf`;
}

export class SupabaseAlmacenEnviosWhatsapp implements IAlmacenEnviosWhatsapp {
  private storageClient: EnviosStorageClientLike | undefined;

  constructor(
    storage?: EnviosStorageClientLike,
    private readonly bucket: string = bucketEnviosWhatsapp(),
  ) {
    this.storageClient = storage;
  }

  private get storage(): EnviosStorageClientLike {
    if (!this.storageClient) {
      this.storageClient = createServerClient().storage as unknown as EnviosStorageClientLike;
    }
    return this.storageClient;
  }

  async guardar(envioId: string, ejecucionId: string, bytes: Uint8Array): Promise<{ ruta: string }> {
    const ruta = rutaPdfEjecucion(envioId, ejecucionId);
    const subir = () =>
      this.storage.from(this.bucket).upload(ruta, bytes, { contentType: CONTENT_TYPE, upsert: false });

    let r = await subir();
    if (r.error && esBucketInexistente(r.error)) {
      // El bucket se crea solo, PRIVADO, en el primer uso. Un «ya existe» es otra ejecucion que lo
      // creo a la vez: se ignora.
      const c = await this.storage.createBucket(this.bucket, { public: false });
      if (c.error && !esBucketYaExistente(c.error)) {
        throw new Error(`fallo al crear el bucket de envios de whatsapp: ${c.error.message}`);
      }
      r = await subir(); // reintento UNICO
    }
    if (r.error || !r.data) {
      throw new Error(`fallo al guardar el PDF de la ejecucion: ${r.error?.message ?? "sin data"}`);
    }
    return { ruta };
  }

  async leer(ruta: string): Promise<Uint8Array> {
    const { data, error } = await this.storage.from(this.bucket).download(ruta);
    if (error || !data) {
      throw new Error(`fallo al leer el PDF de la ejecucion: ${error?.message ?? "sin data"}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async firmar(ruta: string, ttlSegundos: number): Promise<string> {
    const { data, error } = await this.storage.from(this.bucket).createSignedUrl(ruta, ttlSegundos);
    if (error || !data) {
      throw new Error(`fallo al firmar el PDF de la ejecucion: ${error?.message ?? "sin data"}`);
    }
    return data.signedUrl;
  }

  async borrar(rutas: string[]): Promise<void> {
    if (rutas.length === 0) return;
    const r = await this.storage.from(this.bucket).remove(rutas);
    if (r.error) throw new Error(`fallo al borrar PDFs de ejecuciones: ${r.error.message}`);
  }
}
