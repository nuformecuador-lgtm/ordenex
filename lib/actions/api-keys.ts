"use server";

import {
  apiKeyIdSchema,
  generarApiKeySchema,
  listarApiKeysSchema,
  type ActivarApiKeyResult,
  type ApiKeyActionErrorResult,
  type DesactivarApiKeyResult,
  type GenerarApiKeyResult,
  type ListarApiKeysResult,
  type RotarApiKeyResult,
} from "@/lib/types/api-key";
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
 * Adapta el `AppErrorShape` del manejador global al resultado tipado de estas acciones.
 * El service ya traduce el duplicado a `conflict` CON su `campo`, asi que un `conflict`
 * sin campo desde el borde seria un bug: se rompe ruidosamente en vez de mentir.
 *
 * Devuelve el union estrecho de errores comunes (`ApiKeyActionErrorResult`), que es lo
 * unico que puede quedar tras descartar `conflict` y `not_found`: asi sirve tanto a
 * `generarApiKey` como a `listarApiKeys`, cuyo union no admite esos dos estados.
 */
function toApiKeyActionError(shape: AppErrorShape): ApiKeyActionErrorResult {
  const err = toActionError(shape);
  if (err.status === "conflict") {
    throw new Error(`unexpected conflict status in api-keys action: ${shape.code}`);
  }
  if (err.status === "not_found") {
    throw new Error(`unexpected not_found status in api-keys action: ${shape.code}`);
  }
  return err;
}

/**
 * Variante para las actions del ciclo de vida (rotar/activar/desactivar), donde
 * `not_found` (R3) SI es un status esperado y no un bug. A diferencia de
 * `toApiKeyActionError`, deja pasar `not_found`; sigue rechazando `conflict`, que no tiene
 * sentido en estas operaciones. En la practica el service produce `not_found` como
 * RETORNO (no como excepcion), asi que este mapeo solo lo tocan los errores LANZADOS
 * (UnauthenticatedError, ZodError); admitir `not_found` aqui es defensa en profundidad.
 */
function toApiKeyLifecycleActionError(
  shape: AppErrorShape,
): ApiKeyActionErrorResult | { status: "not_found" } {
  const err = toActionError(shape);
  if (err.status === "conflict") {
    throw new Error(`unexpected conflict status in api-keys lifecycle action: ${shape.code}`);
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

/**
 * Feature 82/R1/R2/R3/R4: lista las API keys paginadas. Server Action (lectura interna
 * desde componente propio), no route handler.
 *
 * La autorizacion es server-side y de dos capas: aqui se resuelve el actor (R1) y el
 * service filtra por rol (R2). Que la UI oculte el enlace no es una defensa.
 *
 * R6: el resultado no puede contener el secreto ni su hash — no por un filtrado aqui,
 * sino porque `ApiKeyListItem` no los declara y `LIST_SELECT` no los pide a Postgres.
 */
export async function listarApiKeys(
  input: unknown,
  deps: ApiKeyActionDeps = {},
): Promise<ListarApiKeysResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const data = listarApiKeysSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR (R3)
    const service = deps.apiKeyService ?? buildApiKeyService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toApiKeyActionError(r) : r;
}

/**
 * Ciclo de vida/R1/R2/R3: rota el secreto de una API key. Devuelve el nuevo secreto en
 * claro UNA sola vez. Autorizacion en dos capas: actor aqui (R1 -> `UnauthenticatedError`),
 * rol en el service (solo `maestro`). Solo sesion, zod (`id` uuid) y la llamada al service.
 */
export async function rotarApiKey(
  input: unknown,
  deps: ApiKeyActionDeps = {},
): Promise<RotarApiKeyResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1
    const data = apiKeyIdSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.apiKeyService ?? buildApiKeyService();
    return service.rotar(data, actor);
  });
  return isAppErrorShape(r) ? toApiKeyLifecycleActionError(r) : r;
}

/**
 * Ciclo de vida/R1/R3/R4: activa una API key (`estado='activa'`). Idempotente. Misma
 * envoltura que `rotarApiKey`; `not_found` (R3) es un status esperado del ciclo de vida.
 */
export async function activarApiKey(
  input: unknown,
  deps: ApiKeyActionDeps = {},
): Promise<ActivarApiKeyResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1
    const data = apiKeyIdSchema.parse(input);
    const service = deps.apiKeyService ?? buildApiKeyService();
    return service.activar(data, actor);
  });
  return isAppErrorShape(r) ? toApiKeyLifecycleActionError(r) : r;
}

/**
 * Ciclo de vida/R1/R3/R4: desactiva una API key (`estado='inactiva'`, palanca de
 * revocacion). Idempotente. `not_found` (R3) es un status esperado del ciclo de vida.
 */
export async function desactivarApiKey(
  input: unknown,
  deps: ApiKeyActionDeps = {},
): Promise<DesactivarApiKeyResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1
    const data = apiKeyIdSchema.parse(input);
    const service = deps.apiKeyService ?? buildApiKeyService();
    return service.desactivar(data, actor);
  });
  return isAppErrorShape(r) ? toApiKeyLifecycleActionError(r) : r;
}
