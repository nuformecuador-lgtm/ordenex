// Feature 106 — Endpoint 2: DETALLE de UNA orden propia por `num_guia`, con sus evidencias de
// entrega/rechazo (feature 36) resueltas como URLs firmadas de 5 min. GET
// `/api/ordenes/api-key/[numGuia]`. Autenticacion por API key (feature 88). Owner = usuario
// dedicado de la key (R4). Una orden inexistente o de otro owner devuelve el MISMO 404 (R13/R14):
// no se filtra la existencia de recursos ajenos. La key NUNCA se loguea (R5).
import { NextResponse } from "next/server";
import { z } from "zod";
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
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenLecturaService } from "@/lib/interfaces/services/IApiOrdenLecturaService";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { gestionConfig } from "@/lib/config/gestion";
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";

export interface DetalleApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  lecturaService?: IApiOrdenLecturaService;
}

function buildLecturaService(): IApiOrdenLecturaService {
  const prisma = getPrismaClient();
  const signedUrls = new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET);
  return new ApiOrdenLecturaService(new OrdenRepository(prisma), signedUrls);
}

// Identificador publico = `num_guia` (decision (d) del gate): entero positivo.
const numGuiaSchema = z.coerce.number().int().positive();

/** Logica del endpoint, con `numGuia` crudo y `deps` inyectables para tests (sin DB). */
export async function handleDetalleApi(
  req: Request,
  rawNumGuia: string,
  deps: DetalleApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. R1-R5: autenticacion por API key ANTES de tocar la orden.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // R1/R2 -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // R3 -> 403

    // 2. Valida el path param como entero positivo.
    const parsed = numGuiaSchema.safeParse(rawNumGuia);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { numGuia: ["num_guia invalido"] },
      });
    }

    // 3. R12/R13/R14: detalle del owner; null (inexistente/ajena/borrada) -> 404 uniforme.
    const service = deps.lecturaService ?? buildLecturaService();
    const detalle = await service.detalle(auth.actor, parsed.data);
    if (!detalle) throw new NotFoundError(); // R13/R14 -> 404
    return detalle;
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ numGuia: string }> },
): Promise<NextResponse> {
  const { numGuia } = await ctx.params;
  return handleDetalleApi(req, numGuia);
}
