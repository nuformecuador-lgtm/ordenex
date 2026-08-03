// Feature 177 (T14, design §5.2/§6) — GENERACION/OBTENCION del PDF de la etiqueta de UNA orden
// propia: `POST /api/ordenes/api-key/orden/{id}/generate`.
//
// SOLO `POST` (decision (b) de la puerta F1.4, R44): el modulo NO exporta `GET` ni ningun otro
// verbo, asi que Next responde 405 sin ejecutar nada. Razon: la llamada escribe en la base y
// crea un objeto en Storage; un `GET` seria pre-fetcheable por navegadores, crawlers y proxies.
//
// Resuelve `{id}` con las MISMAS reglas del endpoint de consulta (R19): mismo zod (importado,
// no reescrito), mismo service de resolucion, misma precedencia `num_guia` > `num_remision`,
// mismos 404 y 422. Controller puro: HTTP + zod + service.
import { NextResponse } from "next/server";
import {
  withErrorHandler,
  isAppErrorShape,
  appErrorToResponse,
  UnauthenticatedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  MSG,
} from "@/lib/errors";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenResolucionService } from "@/lib/interfaces/services/IApiOrdenResolucionService";
import type { IApiPdfEtiquetaService } from "@/lib/interfaces/services/IApiPdfEtiquetaService";
import { ApiOrdenResolucionService } from "@/lib/services/ApiOrdenResolucionService";
import { ApiPdfEtiquetaService } from "@/lib/services/ApiPdfEtiquetaService";
import { EtiquetasLotePdfService } from "@/lib/services/EtiquetasLotePdfService";
import { EtiquetaGuiaService } from "@/lib/services/EtiquetaGuiaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { etiquetasConfig } from "@/lib/config/etiquetas";
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";
import { idOrdenApiSchema } from "@/lib/api/api-orden-identificador";

export interface GenerarPdfOrdenApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  resolucionService?: IApiOrdenResolucionService;
  pdfService?: IApiPdfEtiquetaService;
}

function buildResolucionService(): IApiOrdenResolucionService {
  return new ApiOrdenResolucionService(new OrdenRepository(getPrismaClient()));
}

/**
 * Composition root del PDF por API key: reusa el generador de la 136 (que YA devuelve el `path`
 * del objeto) instanciandolo con el TTL de ESTA feature (`API_SIGNED_URL_TTL_SECONDS`, 300 s por
 * defecto, R24/R43) sobre el MISMO bucket privado de etiquetas. La 136/141 no se modifica.
 */
function buildPdfService(): IApiPdfEtiquetaService {
  const prisma = getPrismaClient();
  const bucket = etiquetasConfig.ETIQUETAS_BUCKET;
  const ttl = etiquetasConfig.API_SIGNED_URL_TTL_SECONDS;
  const repo = new OrdenRepository(prisma);
  const signedUrls = new SupabaseSignedUrlProvider(undefined, bucket);
  const lotePdf = new EtiquetasLotePdfService(
    new EtiquetaGuiaService(repo),
    new SupabaseFileStorage(undefined, bucket),
    signedUrls,
    ttl,
    etiquetasConfig.MAX_ETIQUETAS_POR_PDF,
  );
  return new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, ttl);
}

/** Logica del endpoint, con `{id}` crudo y `deps` inyectables para tests (sin DB ni Storage). */
export async function handleGenerarPdfOrdenApi(
  req: Request,
  rawId: string,
  deps: GenerarPdfOrdenApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. R1-R3/R5: autenticacion ANTES de leer ordenes o tocar Storage.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // R1/R2 -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // R3 -> 403

    // 2. R13/R19: mismo zod que la consulta, sin consultar la base.
    const parsed = idOrdenApiSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: {
          id: ["id invalido: requerido, no vacio y de hasta 128 caracteres"],
        },
      });
    }

    // 3. R19: misma resolucion y misma precedencia que la consulta; nunca 409 por ambiguedad.
    const resolucion = deps.resolucionService ?? buildResolucionService();
    const resuelta = await resolucion.resolver(auth.actor, parsed.data);
    if (resuelta.status === "not_found") throw new NotFoundError(); // R11/R12 -> 404 uniforme

    // 4. R20/R21/R22: reuso-o-genera sobre la orden YA verificada como propia.
    const pdf = deps.pdfService ?? buildPdfService();
    const salida = await pdf.porOrden(auth.actor, resuelta.orden.id);
    switch (salida.status) {
      case "ok":
        return {
          url: salida.url,
          expiraEnSegundos: salida.expiraEnSegundos,
          generado: salida.generado,
        };
      case "not_found":
        throw new NotFoundError(); // carrera: borrada entre la resolucion y la generacion
      case "sin_etiqueta":
        throw new ConflictError(); // R25: orden sin etiqueta imprimible (sin `num_guia`)
      case "excede_tope":
        throw new ConflictError(); // R34 (defensivo: una sola orden no deberia superarlo)
    }
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

// R44: UNICO verbo exportado. No se exporta `GET`, `PUT`, `PATCH` ni `DELETE`.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  return handleGenerarPdfOrdenApi(req, id);
}
