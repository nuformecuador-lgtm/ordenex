// Feature 88 — Carga de órdenes por API (canal integrador). A diferencia de la carga
// masiva por sesión (`carga-masiva/chunk`), este endpoint se autentica por API KEY en el
// header `Authorization: Bearer ordx_...` (no por cookie de sesión), fija el estado inicial
// en `en_ruta_bodega_central`, asigna `num_guia` en el acto y devuelve cada orden con su
// guía. Reutiliza `BulkOrdenService` por dentro (misma validación/dedup/geo).
//
// SEGURIDAD (R6): la key viaja en cada request. NUNCA se loguea (ni la key ni su hash), ni
// entra al cuerpo de una respuesta de error (`appErrorToResponse` no incluye headers).
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  withErrorHandler,
  isAppErrorShape,
  appErrorToResponse,
  UnauthenticatedError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  MSG,
} from "@/lib/errors";
import type { IBulkOrdenService } from "@/lib/interfaces/services/IBulkOrdenService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ApiKeyAuthResult,
  IApiKeyAuthService,
} from "@/lib/interfaces/services/IApiKeyAuthService";
import type {
  DownloadType,
  IEtiquetasDescargaService,
} from "@/lib/interfaces/services/IEtiquetasDescargaService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { ApiKeyAuthService } from "@/lib/services/ApiKeyAuthService";
import { EtiquetaGuiaService } from "@/lib/services/EtiquetaGuiaService";
import {
  EtiquetasLotePdfService,
  EtiquetasLoteExcedeTopeError,
} from "@/lib/services/EtiquetasLotePdfService";
import { EtiquetasDescargaService } from "@/lib/services/EtiquetasDescargaService";
import { CargaNombreDuplicadoError } from "@/lib/interfaces/repositories/IOrdenRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";
import { etiquetasConfig } from "@/lib/config/etiquetas";

// El runtime de Node es OBLIGATORIO: Prisma, el hash de la API key y el render del
// PDF (jspdf/qrcode/bwip-js, R7) no corren en edge.
export const runtime = "nodejs";

// Presupuesto de tiempo de la ruta, coherente con el tope de etiquetas por PDF
// (`etiquetasConfig.MAX_ETIQUETAS_POR_PDF`, default 300 ~= 5.6 s de render): 60 s
// cubren la insercion del lote (hasta MAX_CHUNK_ROWS filas) MAS el PDF con margen.
// Explicito para no depender del default de plataforma (10 s), que si podia cortar
// la respuesta DESPUES de commitear las ordenes (BLOQ-1).
export const maxDuration = 60;

export interface CargaApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  bulkService?: IBulkOrdenService;
  // Feature 141: orquestador de la descarga de etiquetas segun `download_type` (genera los
  // PDFs y persiste las URLs). Sustituye a la inyeccion directa del servicio de PDF de la 136.
  descargaService?: IEtiquetasDescargaService;
}

// Feature 136 (T3.1) — bloque `etiquetasPdf` de la respuesta. El fallo se hace
// VISIBLE con `{ error }` (no se oculta con `null`, R12); `null` significa que no
// habia nada que generar (sin ordenes creadas o sin etiqueta imprimible, R13/R14).
type EtiquetasPdf =
  | { url: string; expiraEnSegundos: number } // exito (R10)
  | { error: string } // fallo best-effort (R12), HTTP 200, carga NO revertida
  | null; // nada que generar (R13/R14)

/** Mensaje generico al cliente ante un fallo de generacion/almacenamiento (R12). */
const MSG_ETIQUETAS_FALLO = "no se pudo generar el PDF de etiquetas del lote";

/**
 * Mensaje del lote que excede el tope (R12, BLOQ-1): explica el motivo y que hacer,
 * sin PII ni secretos. Se afirma explicitamente que las ordenes SI se crearon,
 * porque es justo lo que el integrador perdia cuando la function moria por OOM.
 */
function msgLoteExcedeTope(tope: number): string {
  return (
    `el lote supera el tope de ${tope} etiquetas por PDF: las ordenes se crearon ` +
    `y conservan su num_guia, pero el PDF consolidado no se genero (divide el lote ` +
    `o imprime las etiquetas por guia)`
  );
}

/**
 * Describe un error para el log SIN arrastrar datos de la orden. El mensaje crudo
 * puede venir del render del PDF (jspdf/qrcode/bwip-js reciben destinatario,
 * direccion, telefono...) y acabar en los logs, contra lo prometido en design §8.
 * Solo se conserva el mensaje de los errores que construye ESTA feature (numeros).
 */
function describirErrorSeguro(err: unknown): string {
  if (err instanceof EtiquetasLoteExcedeTopeError) return err.message;
  if (err instanceof Error) return err.name;
  return typeof err;
}

function buildAutenticar(): (rawKey: string | null) => Promise<ApiKeyAuthResult> {
  const prisma = getPrismaClient();
  const auth: IApiKeyAuthService = new ApiKeyAuthService(new ApiKeyRepository(prisma));
  return (rawKey) => auth.autenticar(rawKey);
}

function buildBulkService(): IBulkOrdenService {
  const prisma = getPrismaClient();
  // Feature 98/T8: se inyecta tambien el resolver de tarifa vigente por tienda, para que
  // `cargarViaApi` devuelva el `costoEnvio` (flete + IVA) por orden creada.
  return new BulkOrdenService(
    new OrdenRepository(prisma),
    new TarifaVigentePorTiendaRepository(prisma),
  );
}

// Feature 136 + 141 — arma el orquestador de la DESCARGA de etiquetas con sus dependencias
// reales: generador de PDFs de la 136 (servicio de etiquetas de la 32 + Storage + firma de
// URLs sobre el bucket privado de config) y el repositorio de ordenes, que es quien persiste
// las URLs (`carga.download_url` / `orden.download_url`). El cliente Supabase es perezoso.
function buildDescargaService(): IEtiquetasDescargaService {
  const prisma = getPrismaClient();
  const bucket = etiquetasConfig.ETIQUETAS_BUCKET;
  const pdfService = new EtiquetasLotePdfService(
    new EtiquetaGuiaService(new OrdenRepository(prisma)),
    new SupabaseFileStorage(undefined, bucket),
    new SupabaseSignedUrlProvider(undefined, bucket),
    etiquetasConfig.SIGNED_URL_TTL_SECONDS,
    etiquetasConfig.MAX_ETIQUETAS_POR_PDF,
  );
  return new EtiquetasDescargaService(pdfService, new OrdenRepository(prisma));
}

// R1/§3: extrae el secreto del header `Authorization: Bearer <key>`. `null` si el header
// está ausente o no usa el esquema `Bearer` (-> el autenticador lo trata como sin key, R2).
function extraerBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() === "" ? null : token;
}

// Body: filas crudas (clave = header, valor = texto), mismo shape que consume
// `BulkOrdenService`. Tope defensivo por lote reusado de la carga masiva.
const cargaApiBodySchema = z.object({
  ordenes: z
    .array(z.record(z.string(), z.string()))
    .min(1, "el lote no puede estar vacío")
    .max(cargaMasivaConfig.MAX_CHUNK_ROWS, "el lote excede el máximo permitido"),
  // Feature 141 (R20/R21/R22): nombre OPCIONAL del lote. Repetirlo dentro del mismo usuario
  // (el de la key) -> 409 (R24).
  name: z.string().trim().min(1).max(120).optional(),
  // Feature 141 (R42/R43/R44): modo de descarga de las etiquetas del lote. Ausente =
  // `consolidate` (compatibilidad con la feature 136); un valor fuera del enum es
  // VALIDATION_ERROR (422) ANTES de crear ninguna orden y sin tocar Storage. NO se persiste
  // en ninguna tabla (R45): es un parámetro de la petición, no un atributo del lote.
  download_type: z.enum(["consolidate", "individual"]).optional().default("consolidate"),
});

/**
 * Feature 141 (R24): un `name` repetido del mismo usuario es un error de dominio del
 * repositorio; el borde lo traduce a 409 nombrando el duplicado. La transacción ya revirtió,
 * así que la petición no dejó ni lote ni órdenes.
 */
async function ejecutarCargaApi(
  service: IBulkOrdenService,
  body: { ordenes: unknown[]; name?: string; download_type: DownloadType },
  actor: Actor,
) {
  try {
    return await service.cargarViaApi(body.ordenes as RawRow[], actor, { name: body.name });
  } catch (err) {
    if (err instanceof CargaNombreDuplicadoError) throw new ConflictError(err.message);
    throw err;
  }
}

/**
 * Lógica del endpoint, extraída para inyección de dependencias en tests (autenticar +
 * service fake), sin DB ni cookies reales — mismo patrón que `handleCargaMasivaChunk`.
 */
export async function handleCargaApi(req: Request, deps: CargaApiDeps = {}): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1/2. R1-R5: autenticación por API key ANTES de tocar el cuerpo (defensa en profundidad).
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // R2/R4 -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // R5 -> 403

    // 3. R7: cuerpo válido (JSON + schema).
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { ordenes: ["cuerpo JSON inválido"] },
      });
    }
    const parsed = cargaApiBodySchema.safeParse(json);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors });
    }

    // 4. R7-R11: carga vía API (reusa BulkOrdenService). El actor es el usuario dedicado.
    // Feature 141 (R20/R21): `name` opcional del lote; un nombre repetido del mismo usuario
    // aborta la carga con 409 (R24) — la transacción del repositorio ya revirtió.
    const service = deps.bulkService ?? buildBulkService();
    const cargaResult = await ejecutarCargaApi(service, parsed.data, auth.actor);
    if (cargaResult.status === "forbidden") throw new ForbiddenError(); // R15 (defensa en profundidad)

    // Feature 136 (R1/R10/R12-R17): tras la carga OK (ya commiteada), genera el PDF
    // consolidado de etiquetas del lote y devuelve su URL firmada. Best-effort: la
    // carga NUNCA se revierte por un fallo aqui; el fallo se hace VISIBLE en la
    // respuesta con `{ error }` (R12). Sin ordenes creadas -> `null`, sin tocar
    // Storage (R13). Solo se alcanza con auth OK y carga OK (R16).
    //
    // INVARIANTE (BLOQ-1 del review): la carga por API NUNCA puede romperse por la
    // generacion del PDF. El try/catch de abajo solo cubre EXCEPCIONES JS; un OOM o
    // un timeout de plataforma no lo son, matan el proceso y devuelven 500/504 con
    // los `num_guia` ya commiteados PERDIDOS para el integrador (que al reintentar
    // los ve como `duplicada`). Por eso la proteccion real es el TOPE de abajo, que
    // decide ANTES de empezar: el trabajo que no se arranca no puede desbordar.
    // `summary.ordenes.length` es cota superior de las etiquetas del lote (las
    // imprimibles son un subconjunto), asi que basta con mirarlo aqui, sin tocar la
    // DB ni Storage.
    const summary = cargaResult.summary;
    const downloadType = parsed.data.download_type; // R43: `consolidate` por defecto
    const topeEtiquetas = etiquetasConfig.MAX_ETIQUETAS_POR_PDF;
    let etiquetasPdf: EtiquetasPdf = null;
    // Feature 141 (R48/R54): URL del PDF individual por orden; vacío en modo `consolidate`.
    let urlPorOrden = new Map<string, string>();
    if (summary.ordenes.length > topeEtiquetas) {
      // Degradacion explicita (R12/R52): 200 con el summary intacto y el motivo visible, en
      // AMBOS modos y sin tocar Storage.
      etiquetasPdf = { error: msgLoteExcedeTope(topeEtiquetas) };
    } else if (summary.ordenes.length > 0) {
      try {
        // Feature 141 (R47/R48): el servicio de descarga genera según el modo y PERSISTE la
        // URL donde corresponde (`carga.download_url` o `orden.download_url`). El borde no
        // habla con el repositorio (regla de capas).
        const descargaSvc = deps.descargaService ?? buildDescargaService();
        const out = await descargaSvc.generarYPersistir({
          modo: downloadType,
          cargaId: summary.cargaId,
          ordenIds: summary.ordenes.map((o) => o.id),
          actor: auth.actor,
        });
        urlPorOrden = out.porOrden;
        // R53: en `consolidate` el bloque `etiquetasPdf` conserva la forma de la 136
        // (`null` si no había etiqueta imprimible, R14/R49). En `individual` vale `null`
        // salvo fallo global: cada URL viaja en su orden (R54).
        etiquetasPdf = out.consolidado
          ? { url: out.consolidado.url, expiraEnSegundos: out.consolidado.expiraEnSegundos }
          : null;
      } catch (err) {
        // Best-effort (R12/R51): la carga ya esta commiteada; NO se revierte, y los
        // `download_url` afectados quedan NULL. Se registra el TIPO del error (nunca su
        // mensaje crudo: puede venir del render y traer datos de la orden) y se expone al
        // cliente un mensaje generico.
        console.error("etiquetas-pdf-lote: fallo best-effort en carga por API", {
          error: describirErrorSeguro(err),
          ordenes: summary.ordenes.length,
          modo: downloadType,
        });
        etiquetasPdf = { error: MSG_ETIQUETAS_FALLO };
        urlPorOrden = new Map();
      }
    }

    // R17 + feature 141 (R39/R54/R55): preserva TODOS los campos del summary (incluido
    // `cargaId`) y añade `etiquetasPdf`, el modo aplicado y la URL individual de cada orden.
    return {
      ...summary,
      ordenes: summary.ordenes.map((o) => ({ ...o, downloadUrl: urlPorOrden.get(o.id) ?? null })),
      downloadType,
      etiquetasPdf,
    };
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleCargaApi(req);
}
