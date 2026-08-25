// Feature 266 — HABILITACION POR LOTE de pedidos con novedad desde el canal por API key.
// `POST /api/ordenes/api-key/habilitar`. Recibe `{ ordenes: [{ num_guia, nota }] }` y devuelve un
// resultado POR FILA (200), aunque todas fallen (R9). Calco de `handleCancelarApi` (106): mismo
// `extraerBearer` + `buildAutenticar`, mismo `withErrorHandler`, mismos 401/403/422.
//
// CERO LOGICA DE NEGOCIO AQUI. La validacion de los CAMPOS de cada fila (R7) es del service a
// proposito: una fila mal formada NO puede tumbar el lote entero, asi que este borde solo mira el
// ENVOLTORIO (R6). Todo lo demas —guarda de estado, ramas, bitacora— vive en
// `ApiHabilitacionService`.
//
// `middleware.ts` NO se toca: `SELF_AUTH_ROUTES` ya cubre el prefijo `/api/ordenes/api-key`, y la
// guardia 229 compara sus tres listas posicionalmente contra una lista firmada — anadir la ruta
// alli la pondria roja sin necesidad.
//
// SEGURIDAD (R5): la key viaja en cada peticion y NUNCA se loguea, ni en claro ni su hash, ni
// entra al cuerpo de ninguna respuesta (`appErrorToResponse` no incluye headers).
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
import type {
  FilaHabilitacionInput,
  IApiHabilitacionService,
} from "@/lib/interfaces/services/IApiHabilitacionService";
import { ApiHabilitacionService } from "@/lib/services/ApiHabilitacionService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHabilitacionApiRepository } from "@/lib/repositories/OrdenHabilitacionApiRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";
import { TOPE_FILAS_HABILITAR } from "@/lib/config/habilitacion-api";

// Prisma y el hash de la API key no corren en edge.
export const runtime = "nodejs";

export interface HabilitarApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  habilitacionService?: IApiHabilitacionService;
}

function buildHabilitacionService(): IApiHabilitacionService {
  const prisma = getPrismaClient();
  return new ApiHabilitacionService(
    new OrdenRepository(prisma),
    new OrdenHabilitacionApiRepository(prisma),
  );
}

/**
 * R6 — EL ENVOLTORIO, y solo el envoltorio: el cuerpo es JSON, `ordenes` es un array de entre 1 y
 * `TOPE_FILAS_HABILITAR` elementos, y cada elemento es un objeto. Un cuerpo que ni siquiera tiene
 * la forma de un lote no se puede procesar «por filas», asi que eso —y nada mas— es 422 global.
 *
 * ⚠️ Los CAMPOS de cada fila (`num_guia`, `nota`) NO se validan aqui (R7). Si se validaran, una
 * sola fila mal formada devolveria 422 y tiraria las 99 buenas, que es exactamente lo que el
 * contrato promete que no pasa.
 */
const habilitarBodySchema = z.object({
  ordenes: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "el lote no puede estar vacío")
    .max(TOPE_FILAS_HABILITAR, `el lote excede el máximo de ${TOPE_FILAS_HABILITAR} filas`),
});

/** Logica del endpoint, con `deps` inyectables para tests sin DB (patron `handleCancelarApi`). */
export async function handleHabilitarApi(
  req: Request,
  deps: HabilitarApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. R1/R2: autenticacion por API key ANTES de leer el cuerpo (defensa en profundidad): sin
    //    key valida no se lee, no se escribe y no se registra ninguna orden.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // R1 -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // R2 -> 403

    // 2. R6: cuerpo JSON + envoltorio. Los dos fallos posibles son el mismo 422.
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { ordenes: ["cuerpo JSON inválido"] },
      });
    }
    const parsed = habilitarBodySchema.safeParse(json);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors });
    }

    // 3. R3/R9/R10/R11: el service decide fila por fila. El owner es el actor de la key y no
    //    ningun identificador del cuerpo. El resultado se devuelve tal cual: el borde traduce
    //    HTTP, no reinterpreta desenlaces.
    const service = deps.habilitacionService ?? buildHabilitacionService();
    const filas: FilaHabilitacionInput[] = parsed.data.ordenes.map((o) => ({
      num_guia: o.num_guia,
      nota: o.nota,
    }));
    return await service.habilitarLote(auth.actor, filas);
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 }); // R9: 200 aunque todas las filas fallen
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleHabilitarApi(req);
}
