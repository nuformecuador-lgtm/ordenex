// Feature 106 — Endpoint 3: CANCELACION de una orden por API key. PUT (decision (c) del gate)
// `/api/ordenes/api-key/[numGuia]/cancelar`. Solo procede si el estado actual es `en_bodega_central` o
// `en_ruta_bodega_central` -> transiciona al estado EXISTENTE `devolviendo_a_tienda` (R19); cualquier
// otro estado -> 409 (R20). La transicion pasa por `appendCambioEstado` con
// `motivo='cancelada por tienda'` y `origen_tipo='cancelacion_api'` en la MISMA tx (dispara el
// webhook de la feature 104). Owner = usuario dedicado de la key (R4). La key NUNCA se loguea (R5).
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
  ConflictError,
  MSG,
} from "@/lib/errors";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenCancelacionService } from "@/lib/interfaces/services/IApiOrdenCancelacionService";
import { ApiOrdenCancelacionService } from "@/lib/services/ApiOrdenCancelacionService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";

export interface CancelarApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  cancelacionService?: IApiOrdenCancelacionService;
}

function buildCancelacionService(): IApiOrdenCancelacionService {
  return new ApiOrdenCancelacionService(new OrdenRepository(getPrismaClient()));
}

const numGuiaSchema = z.coerce.number().int().positive();

/** Logica del endpoint, con `numGuia` crudo y `deps` inyectables para tests (sin DB). */
export async function handleCancelarApi(
  req: Request,
  rawNumGuia: string,
  deps: CancelarApiDeps = {},
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

    // 3. R19/R20/R23: cancela; traduce el resultado de dominio a HTTP.
    const service = deps.cancelacionService ?? buildCancelacionService();
    const res = await service.cancelar(auth.actor, parsed.data);
    if (res.status === "not_found") throw new NotFoundError(); // R23/R24 -> 404
    if (res.status === "conflict") throw new ConflictError(); // R20 -> 409
    return res.data; // R19 -> 200 { numGuia, estadoAnterior, estado }
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ numGuia: string }> },
): Promise<NextResponse> {
  const { numGuia } = await ctx.params;
  return handleCancelarApi(req, numGuia);
}
