// Feature 248 (design §3 D4, §4.2 — R12/R13/R14/R15/R17) — COTIZADOR del canal integrador por
// API key: POST `/api/ordenes/api-key/cotizar`.
//
// Mismo patron de borde que el resto del canal (`app/api/ordenes/api-key/route.ts:48-86`):
// `extraerBearer` -> `buildAutenticar` -> 401/403 -> zod -> 422 -> service. AQUI NO HAY LOGICA
// DE NEGOCIO NI UNA SOLA QUERY: el handler traduce HTTP y delega (docs/architecture.md).
//
// POST y no GET a proposito: un GET con query params seria cacheable, pero mete el MONTO COD en
// la URL, y las URLs viajan a logs de plataforma y a analitica. Un cuerpo POST no.
//
// `SELF_AUTH_ROUTES` (`middleware.ts:32`) ya contiene el PREFIJO `/api/ordenes/api-key`, asi que
// este endpoint pasa el middleware sin tocar ninguna lista firmada.
//
// SEGURIDAD (R17): la key viaja en cada peticion y NUNCA se loguea —ni ella ni su hash—, ni
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
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { ICotizadorService } from "@/lib/interfaces/services/ICotizadorService";
import { CoberturaDistritoRepository } from "@/lib/repositories/CoberturaDistritoRepository";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";
import { CoberturaService } from "@/lib/services/CoberturaService";
import { CotizadorService } from "@/lib/services/CotizadorService";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { cotizacionApiSchema } from "@/lib/types/cotizador";

// Prisma no corre en edge.
export const runtime = "nodejs";

export interface CotizarApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  cotizadorService?: ICotizadorService;
}

function buildCotizadorService(): ICotizadorService {
  const prisma = getPrismaClient();
  return new CotizadorService(
    new CoberturaService(new CoberturaDistritoRepository(prisma)),
    new TarifaVigentePorTiendaRepository(prisma),
  );
}

/** Logica del endpoint, extraida para inyeccion de dependencias en tests (sin DB ni cookies). */
export async function handleCotizarApi(
  req: Request,
  deps: CotizarApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. R12/R13: autenticacion por API key ANTES de tocar el cuerpo.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // R12 -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // R13 -> 403

    // 2. R14/R25/R27: el cuerpo valida ANTES de consultar cobertura o tarifa. El tope de
    // `cantidad` (1..1000) lo aplica el schema leyendo `lib/config/cotizador.ts`, no un literal.
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { body: ["cuerpo JSON invalido"] },
      });
    }
    const parsed = cotizacionApiSchema.safeParse(json);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors }); // R14/R27 -> 422
    }

    // 3. R15: la tienda es el usuario dedicado de la key (`auth.actor`), nunca un dato del
    // cuerpo — el schema no declara ninguna clave de tienda, asi que no hay nada que ignorar.
    const service = deps.cotizadorService ?? buildCotizadorService();
    return service.cotizar(auth.actor, parsed.data);
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleCotizarApi(req);
}
