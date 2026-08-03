// Feature 177 — T15 / Endpoint 3: PDF CONSOLIDADO de las etiquetas de UNA carga propia.
// `POST /api/ordenes/api-key/carga/{cargaId}/generate`. Autenticacion por API key (feature 88):
// el owner SIEMPRE sale de `actor.usuarioId` (R4), nunca de la peticion.
//
// SOLO `POST` (R44, decision (b) de la puerta F1.4): el modulo NO exporta `GET` ni ningun otro
// verbo, asi que Next responde 405 sin ejecutar nada — ninguna peticion que no sea POST puede
// generar, reutilizar ni firmar un PDF.
//
// El contrato de la respuesta 200 es IDENTICO al del endpoint por orden (R28):
// `{ url, expiraEnSegundos, generado }`. La URL se firma en ESTA llamada (R22/R23).
//
// Errores (R42): shape uniforme del manejador global con codigos EXISTENTES.
//   401 UNAUTHORIZED     — sin Bearer / esquema distinto / token vacio / key desconocida
//   403 FORBIDDEN        — usuario o key no activos
//   404 NOT_FOUND        — carga inexistente O de otro owner: MISMA respuesta (R29), no se
//                          filtra la existencia de lotes ajenos
//   409 CONFLICT         — lote sin etiquetas imprimibles (R33) o que excede el tope (R34)
//   422 VALIDATION_ERROR — `{cargaId}` no es un uuid (decision (c): el identificador publicado
//                          de la carga es `Carga.id`, un uuid)
// La key NUNCA se loguea ni entra al cuerpo (R5).
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
  NotFoundError,
  MSG,
} from "@/lib/errors";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiPdfEtiquetaService } from "@/lib/interfaces/services/IApiPdfEtiquetaService";
import { ApiPdfEtiquetaService } from "@/lib/services/ApiPdfEtiquetaService";
import { EtiquetaGuiaService } from "@/lib/services/EtiquetaGuiaService";
import { EtiquetasLotePdfService } from "@/lib/services/EtiquetasLotePdfService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { etiquetasConfig } from "@/lib/config/etiquetas";
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";

export interface CargaGenerateApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  pdfService?: IApiPdfEtiquetaService;
}

/** Composition root real (prod). En tests se inyecta un doble por `deps`. */
function buildPdfService(): IApiPdfEtiquetaService {
  const prisma = getPrismaClient();
  const bucket = etiquetasConfig.ETIQUETAS_BUCKET;
  const repo = new OrdenRepository(prisma);
  const lotePdf = new EtiquetasLotePdfService(
    new EtiquetaGuiaService(repo),
    new SupabaseFileStorage(undefined, bucket),
    new SupabaseSignedUrlProvider(undefined, bucket),
    etiquetasConfig.SIGNED_URL_TTL_SECONDS,
    etiquetasConfig.MAX_ETIQUETAS_POR_PDF,
  );
  return new ApiPdfEtiquetaService(
    repo,
    lotePdf,
    new SupabaseSignedUrlProvider(undefined, bucket),
    // R24/R43: el TTL de este canal sale de configuracion (300 s por defecto), nunca hardcodeado.
    etiquetasConfig.API_SIGNED_URL_TTL_SECONDS,
  );
}

// Decision (c) de la puerta F1.4: el identificador de la carga es el uuid de `Carga.id`, el
// mismo que `POST /api/ordenes/api-key/carga` devuelve como `cargaId`. Cualquier otra cosa
// (por ejemplo el `name` del lote, "LOTE-2026-07-22") es 422 y NO llega al service.
const cargaIdSchema = z.string().uuid();

/** Logica del endpoint, con `cargaId` crudo y `deps` inyectables para tests (sin DB). */
export async function handleCargaGenerateApi(
  req: Request,
  rawCargaId: string,
  deps: CargaGenerateApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. R1-R3: autenticacion por API key ANTES de tocar la carga (design §6, paso 1).
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // -> 403

    // 2. Valida el path param como uuid (design §5.3, paso 2). Sin invocar el service.
    const parsed = cargaIdSchema.safeParse(rawCargaId);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { cargaId: ["cargaId invalido"] },
      });
    }

    // 3. R29-R34: el service resuelve la carga con el owner FORZADO y decide reuso o generacion.
    const service = deps.pdfService ?? buildPdfService();
    const salida = await service.porCarga(auth.actor, parsed.data);

    switch (salida.status) {
      case "ok":
        // R28: misma forma exacta que el endpoint por orden.
        return {
          url: salida.url,
          expiraEnSegundos: salida.expiraEnSegundos,
          generado: salida.generado,
        };
      case "not_found":
        throw new NotFoundError(); // R29: ajena e inexistente son indistinguibles
      case "sin_etiqueta":
        throw new ConflictError(); // R33
      case "excede_tope":
        throw new ConflictError(); // R34
    }
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ cargaId: string }> },
): Promise<NextResponse> {
  const { cargaId } = await ctx.params;
  return handleCargaGenerateApi(req, cargaId);
}
