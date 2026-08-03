// Feature 177 (T13, design §5.1/§5.4) — CONSULTA del detalle de UNA orden propia por un
// identificador libre `{id}`, resuelto contra `num_guia` Y `num_remision` con la precedencia
// fija decidida en la puerta F1.4 (`num_guia` gana, R14/R15; NUNCA 409).
// `GET /api/ordenes/api-key/orden/{id}`. Autenticacion por API key (feature 88): el owner es
// SIEMPRE `actor.usuarioId` (R4), jamas un parametro de la peticion. Una orden inexistente,
// borrada o de otro owner devuelve EXACTAMENTE el mismo 404 (R11/R12): no se filtra la
// existencia de recursos ajenos. La key NUNCA se loguea ni se serializa (R5).
//
// Controller puro: HTTP + zod + llamada al service. Ni Prisma ni logica de negocio aqui.
import { NextResponse } from "next/server";
import {
  withErrorHandler,
  isAppErrorShape,
  appErrorToResponse,
  UnauthenticatedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  MSG,
} from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenResolucionService } from "@/lib/interfaces/services/IApiOrdenResolucionService";
import type { ApiOrdenDetalleDTO } from "@/lib/types/api-orden";
import { ApiOrdenResolucionService } from "@/lib/services/ApiOrdenResolucionService";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { gestionConfig } from "@/lib/config/gestion";
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";
import { idOrdenApiSchema } from "@/lib/api/api-orden-identificador";

/** Lee el detalle publico (DTO de la feature 106) de una orden YA resuelta a `orden.id`. */
export type DetallePorOrdenId = (
  actor: Actor,
  ordenId: string,
) => Promise<ApiOrdenDetalleDTO | null>;

export interface ConsultaOrdenApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  resolucionService?: IApiOrdenResolucionService;
  detallePorOrdenId?: DetallePorOrdenId;
}

function buildResolucionService(): IApiOrdenResolucionService {
  return new ApiOrdenResolucionService(new OrdenRepository(getPrismaClient()));
}

/**
 * R16/R17 — el DTO de detalle lo produce el `ApiOrdenLecturaService` YA EXISTENTE de la 106:
 * mismo mapeo, mismas evidencias firmadas a 5 min, mismo `[]` cuando no hay. Como su
 * `detalle(actor, numGuia)` opera por `num_guia` (que puede ser NULL) y aqui la resolucion
 * entrega un `orden.id`, se usa su metodo hermano `detallePorOrdenId(actor, ordenId)`, que
 * comparte el mapeo/firmado y lee por `findDetalleByOrdenIdForOwner` (MISMA proyeccion,
 * `IOrdenRepository:617-622`). `detalle` de la 106 no se toca (R17).
 */
function buildDetallePorOrdenId(): DetallePorOrdenId {
  const prisma = getPrismaClient();
  const signedUrls = new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET);
  const lectura = new ApiOrdenLecturaService(new OrdenRepository(prisma), signedUrls);
  return (actor, ordenId) => lectura.detallePorOrdenId(actor, ordenId);
}

/** Logica del endpoint, con `{id}` crudo y `deps` inyectables para tests (sin DB). */
export async function handleConsultaOrdenApi(
  req: Request,
  rawId: string,
  deps: ConsultaOrdenApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. R1-R3/R5: autenticacion por API key ANTES de cualquier lectura de ordenes o Storage.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // R1/R2 -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // R3 -> 403

    // 2. R13: validacion del path param SIN consultar la base.
    const parsed = idOrdenApiSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: {
          id: ["id invalido: requerido, no vacio y de hasta 128 caracteres"],
        },
      });
    }

    // 3. R6-R15: resolucion con el owner forzado y precedencia `num_guia` > `num_remision`.
    //    El dominio no tiene estado `ambiguo`, asi que este endpoint NUNCA responde 409.
    const resolucion = deps.resolucionService ?? buildResolucionService();
    const resuelta = await resolucion.resolver(auth.actor, parsed.data);
    if (resuelta.status === "not_found") throw new NotFoundError(); // R11/R12 -> 404 uniforme

    // 4. R16/R18: detalle publico (mismo DTO de la 106), sin storage_path, sin bucket, sin ids
    //    internos y sin PII del mensajero.
    const detalle = await (deps.detallePorOrdenId ?? buildDetallePorOrdenId())(
      auth.actor,
      resuelta.orden.id,
    );
    // Carrera (borrada entre la resolucion y la lectura): MISMO 404, sin filtrar nada.
    if (!detalle) throw new NotFoundError();
    return detalle;
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  return handleConsultaOrdenApi(req, id);
}
