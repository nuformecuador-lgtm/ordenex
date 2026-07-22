// Feature 106 — Endpoint 1: LISTADO paginado de las ordenes del owner (canal integrador por
// API key). GET `/api/ordenes/api-key`. Mismo patron de autenticacion que la carga (feature 88):
// `Authorization: Bearer ordx_...`. El owner es SIEMPRE el usuario dedicado de la key
// (`actor.usuarioId`), nunca un parametro de la peticion (R4). La key NUNCA se loguea (R5).
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
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenLecturaService } from "@/lib/interfaces/services/IApiOrdenLecturaService";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { gestionConfig } from "@/lib/config/gestion";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";

export interface ListadoApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  lecturaService?: IApiOrdenLecturaService;
}

function buildLecturaService(): IApiOrdenLecturaService {
  const prisma = getPrismaClient();
  // El provider firma contra el bucket PRIVADO de evidencias (feature 36), con TTL de 5 min.
  const signedUrls = new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET);
  return new ApiOrdenLecturaService(new OrdenRepository(prisma), signedUrls);
}

// R9: paginacion offset/limit validada en el borde. `limit` 1..100 (tope 100, default 50);
// `offset` >= 0 (default 0); `estado` opcional acotado al catalogo. Un `tiendaId`/`owner` en la
// query NO esta en el schema y jamas se lee -> no puede ampliar el scope (R8).
const listadoQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  estado: z.enum(ORDER_STATUS_SEED).optional(),
});

/** Logica del endpoint, extraida para inyeccion de dependencias en tests (sin DB ni cookies). */
export async function handleListadoApi(
  req: Request,
  deps: ListadoApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. R1-R5: autenticacion por API key ANTES de parsear la query.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // R1/R2 -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // R3 -> 403

    // 2. R8/R9: valida SOLO las claves conocidas; cualquier otra (p. ej. tiendaId) se ignora.
    const sp = new URL(req.url).searchParams;
    const raw: Record<string, string> = {};
    if (sp.has("limit")) raw.limit = sp.get("limit") ?? "";
    if (sp.has("offset")) raw.offset = sp.get("offset") ?? "";
    if (sp.has("estado")) raw.estado = sp.get("estado") ?? "";
    const parsed = listadoQuerySchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors }); // R9 -> 422
    }

    // 3. R6/R7/R10: el service fuerza owner = actor.usuarioId y pagina con total.
    const service = deps.lecturaService ?? buildLecturaService();
    return service.listar(auth.actor, {
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      estado: parsed.data.estado,
    });
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleListadoApi(req);
}
