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
  ValidationError,
  MSG,
} from "@/lib/errors";
import type { IBulkOrdenService } from "@/lib/interfaces/services/IBulkOrdenService";
import type {
  ApiKeyAuthResult,
  IApiKeyAuthService,
} from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IEtiquetasLotePdfService } from "@/lib/interfaces/services/IEtiquetasLotePdfService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { ApiKeyAuthService } from "@/lib/services/ApiKeyAuthService";
import { EtiquetaGuiaService } from "@/lib/services/EtiquetaGuiaService";
import {
  EtiquetasLotePdfService,
  EtiquetasLoteExcedeTopeError,
} from "@/lib/services/EtiquetasLotePdfService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";
import { etiquetasConfig } from "@/lib/config/etiquetas";
import { notificarCargaMasivaTerminadaReal } from "@/lib/notificaciones/notificadores";

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
  // Feature 136: orquestador del PDF consolidado de etiquetas (inyectable en tests).
  etiquetasService?: IEtiquetasLotePdfService;
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
    // Feature 146/R22: COMPOSITION ROOT del aviso "carga masiva terminada". Esta via SI tiene
    // fin de lote real (una peticion = un lote), asi que es la unica que lo cablea server-side.
    notificarCargaMasivaTerminadaReal,
  );
}

// Feature 136 — arma el orquestador del PDF de etiquetas con sus dependencias reales:
// servicio de etiquetas (feature 32), Storage y firma de URLs sobre el bucket privado
// de config (feature 21/22). El cliente Supabase es perezoso (no toca red al construir).
function buildEtiquetasService(): IEtiquetasLotePdfService {
  const prisma = getPrismaClient();
  const bucket = etiquetasConfig.ETIQUETAS_BUCKET;
  return new EtiquetasLotePdfService(
    new EtiquetaGuiaService(new OrdenRepository(prisma)),
    new SupabaseFileStorage(undefined, bucket),
    new SupabaseSignedUrlProvider(undefined, bucket),
    etiquetasConfig.SIGNED_URL_TTL_SECONDS,
    etiquetasConfig.MAX_ETIQUETAS_POR_PDF,
  );
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
});

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
    const service = deps.bulkService ?? buildBulkService();
    const cargaResult = await service.cargarViaApi(parsed.data.ordenes as RawRow[], auth.actor);
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
    const topeEtiquetas = etiquetasConfig.MAX_ETIQUETAS_POR_PDF;
    let etiquetasPdf: EtiquetasPdf = null;
    if (summary.ordenes.length > topeEtiquetas) {
      // Degradacion explicita (R12): 200 con el summary intacto y el motivo visible.
      etiquetasPdf = { error: msgLoteExcedeTope(topeEtiquetas) };
    } else if (summary.ordenes.length > 0) {
      try {
        const etiquetasSvc = deps.etiquetasService ?? buildEtiquetasService();
        const out = await etiquetasSvc.generarYAlmacenar(
          summary.ordenes.map((o) => o.id),
          auth.actor,
        );
        // `out === null` => no habia etiqueta imprimible: `null`, no es error (R14).
        etiquetasPdf = out ? { url: out.signedUrl, expiraEnSegundos: out.expiraEnSegundos } : null;
      } catch (err) {
        // Best-effort (R12): la carga ya esta commiteada; NO se revierte. Se registra
        // el TIPO del error (nunca su mensaje crudo: puede venir del render y traer
        // datos de la orden) y se expone al cliente un mensaje generico.
        console.error("etiquetas-pdf-lote: fallo best-effort en carga por API", {
          error: describirErrorSeguro(err),
          ordenes: summary.ordenes.length,
        });
        etiquetasPdf = { error: MSG_ETIQUETAS_FALLO };
      }
    }

    // R17: preserva TODOS los campos del summary y añade `etiquetasPdf`.
    return { ...summary, etiquetasPdf };
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleCargaApi(req);
}
