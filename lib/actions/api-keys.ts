"use server";

import { generarApiKeySchema, type GenerarApiKeyResult } from "@/lib/types/api-key";
import type { Actor, IApiKeyService } from "@/lib/interfaces/services/IApiKeyService";
import { ApiKeyService } from "@/lib/services/ApiKeyService";
import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  withErrorHandler,
  isAppErrorShape,
  UnauthenticatedError,
  type AppErrorShape,
} from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

// Mutacion interna (no CORS, no API publica) => Server Action, no route handler
// (docs/architecture.md). El CONSUMO de la key por terceros es la feature 81a.

function buildApiKeyService(): IApiKeyService {
  return new ApiKeyService(new ApiKeyRepository(getPrismaClient()));
}

/**
 * Adapta el `AppErrorShape` del manejador global al resultado tipado de esta accion.
 * El service ya traduce el duplicado a `conflict` CON su `campo`, asi que un `conflict`
 * sin campo desde el borde seria un bug: se rompe ruidosamente en vez de mentir.
 */
function toApiKeyActionError(shape: AppErrorShape): GenerarApiKeyResult {
  const err = toActionError(shape);
  if (err.status === "conflict") {
    throw new Error(`unexpected conflict status in api-keys action: ${shape.code}`);
  }
  if (err.status === "not_found") {
    throw new Error(`unexpected not_found status in api-keys action: ${shape.code}`);
  }
  return err;
}

export interface ApiKeyActionDeps {
  apiKeyService?: IApiKeyService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * R1/R2/R3/R4/R18: genera una API key y su usuario dedicado. Devuelve el secreto en
 * claro UNA sola vez. Sin queries Prisma ni logica de negocio aqui: solo sesion, zod y
 * la llamada al service.
 */
export async function generarApiKey(
  input: unknown,
  deps: ApiKeyActionDeps = {},
): Promise<GenerarApiKeyResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const data = generarApiKeySchema.parse(input); // ZodError -> VALIDATION_ERROR (R4)
    const service = deps.apiKeyService ?? buildApiKeyService();
    return service.generar(data, actor);
  });
  return isAppErrorShape(r) ? toApiKeyActionError(r) : r;
}
