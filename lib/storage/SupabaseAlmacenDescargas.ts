import { randomUUID } from "node:crypto";
import { createServerClient } from "@/lib/supabase/client";
import { descargaConfig } from "@/lib/config/descarga";
import type { IAlmacenDescargas } from "@/lib/interfaces/external/IAlmacenDescargas";

// Ficha 470 (design §3.3, R9/R10/R14/R17) — almacen de los objetos temporales de las descargas grandes
// sobre Supabase Storage, con el service role (`createServerClient`), nunca desde el cliente.
//
// Mismo patron que `SupabaseFileStorage` / `SupabaseSignedUrlProvider`: cliente Storage PEREZOSO (no se
// construye hasta el primer uso real) e INYECTABLE (los tests pasan un doble: el `.env` local apunta a
// Storage de PRODUCCION). NUNCA genera una URL publica: la superficie del cliente ni siquiera la expone.
//
// A diferencia de `SupabaseFileStorage.remove`, la purga SI propaga el `error` del SDK: una purga que
// falla en silencio deja el bucket creciendo sin ninguna señal (leccion de `purga-pdf-cargas`).

type ErrorSdk = { message: string; status?: number | string; statusCode?: number | string } | null;

/** Un objeto listado (o carpeta: `id` null). Superficie minima de `FileObject` del SDK. */
export interface ObjetoListado {
  name: string;
  id: string | null;
  created_at: string | null;
}

/** Superficie minima del cliente Storage de Supabase que usa este almacen (testeable). */
export interface AlmacenStorageClientLike {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array,
      options?: { contentType?: string; upsert?: boolean },
    ): Promise<{ data: { path: string } | null; error: ErrorSdk }>;
    createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: ErrorSdk }>;
    list(
      path: string,
      options?: { limit?: number; offset?: number; sortBy?: { column: string; order: "asc" | "desc" } },
    ): Promise<{ data: ObjetoListado[] | null; error: ErrorSdk }>;
    remove(paths: string[]): Promise<{ data: unknown; error: ErrorSdk }>;
  };
  createBucket(id: string, options: { public: boolean }): Promise<{ data: unknown; error: ErrorSdk }>;
}

/** Carpeta UNICA de los objetos temporales (R9: la ruta no lleva nada del usuario ni de los filtros). */
const CARPETA = "tmp";
const CONTENT_TYPE = "application/gzip";
/** Objetos por pagina del listado de la purga (tope del SDK: 1000). */
const PAGINA_PURGA = 1000;

/** «Bucket not found» del SDK (mensaje, o 404 en `statusCode`/`status`). */
function esBucketInexistente(error: ErrorSdk): boolean {
  if (!error) return false;
  return /bucket not found|not found/i.test(error.message) || String(error.statusCode) === "404" || String(error.status) === "404";
}

/** «Already exists» al crear el bucket: carrera entre dos descargas, se tolera. */
function esBucketYaExistente(error: ErrorSdk): boolean {
  if (!error) return false;
  return /already exists/i.test(error.message) || String(error.statusCode) === "409" || String(error.status) === "409";
}

export class SupabaseAlmacenDescargas implements IAlmacenDescargas {
  private storageClient: AlmacenStorageClientLike | undefined;

  constructor(
    storage?: AlmacenStorageClientLike,
    private readonly bucket: string = descargaConfig.BUCKET,
    private readonly nuevoId: () => string = randomUUID,
  ) {
    this.storageClient = storage;
  }

  /** Cliente Storage perezoso: crea (y lee env via createServerClient) al 1er uso. */
  private get storage(): AlmacenStorageClientLike {
    if (!this.storageClient) {
      this.storageClient = createServerClient().storage as unknown as AlmacenStorageClientLike;
    }
    return this.storageClient;
  }

  async guardar(bytes: Uint8Array): Promise<{ ruta: string }> {
    const ruta = `${CARPETA}/${this.nuevoId()}.json.gz`;
    const subir = () => this.storage.from(this.bucket).upload(ruta, bytes, { contentType: CONTENT_TYPE, upsert: false });

    let r = await subir();
    if (r.error && esBucketInexistente(r.error)) {
      // R14: el bucket se crea solo, PRIVADO, en el primer uso (produccion, preview y local sin pasos
      // manuales). Un «ya existe» es otra descarga que lo creo a la vez: se ignora.
      const c = await this.storage.createBucket(this.bucket, { public: false });
      if (c.error && !esBucketYaExistente(c.error)) {
        throw new Error(`fallo al crear el bucket de descargas: ${c.error.message}`);
      }
      r = await subir(); // reintento UNICO
    }
    if (r.error || !r.data) {
      throw new Error(`fallo al subir la descarga temporal: ${r.error?.message ?? "sin data"}`);
    }
    return { ruta };
  }

  async firmar(ruta: string, ttlSegundos: number): Promise<string> {
    const { data, error } = await this.storage.from(this.bucket).createSignedUrl(ruta, ttlSegundos);
    if (error || !data) {
      throw new Error(`fallo al firmar la descarga temporal: ${error?.message ?? "sin data"}`);
    }
    return data.signedUrl;
  }

  async purgarAnterioresA(corte: Date, maximo: number): Promise<{ borrados: number; quedaPendiente: boolean }> {
    const pagina = PAGINA_PURGA;
    let borrados = 0;
    // Cada vuelta relee la PRIMERA pagina (orden ascendente por creacion): lo borrado ya no aparece.
    // Acotado por `maximo`: aunque un `remove` no borrase nada, el bucle termina.
    while (borrados < maximo) {
      const { data, error } = await this.storage
        .from(this.bucket)
        .list(CARPETA, { limit: pagina, offset: 0, sortBy: { column: "created_at", order: "asc" } });
      if (error) {
        if (esBucketInexistente(error)) return { borrados, quedaPendiente: false };
        throw new Error(`fallo al listar las descargas temporales: ${error.message}`);
      }
      const objetos = (data ?? []).filter((o) => o.id !== null); // las carpetas vienen con id null
      const viejos = objetos.filter((o) => o.created_at !== null && new Date(o.created_at).getTime() < corte.getTime());
      if (viejos.length === 0) return { borrados, quedaPendiente: false };

      const lote = viejos.slice(0, maximo - borrados);
      const r = await this.storage.from(this.bucket).remove(lote.map((o) => `${CARPETA}/${o.name}`));
      if (r.error) throw new Error(`fallo al borrar descargas temporales: ${r.error.message}`);
      borrados += lote.length;

      if (lote.length < viejos.length) return { borrados, quedaPendiente: true };
      // La pagina tenia algo reciente, o no estaba llena: no queda nada viejo detras.
      if (viejos.length < objetos.length || (data ?? []).length < pagina) return { borrados, quedaPendiente: false };
    }
    // Tope alcanzado con la ultima pagina entera vieja y llena: puede quedar mas.
    return { borrados, quedaPendiente: true };
  }
}
