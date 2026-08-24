"use server";

import { z } from "zod";
import {
  actualizarTarifaSchema,
  crearTarifaSchema,
  listarTarifasSchema,
  type ActualizarTarifaResult,
  type BorrarTarifaResult,
  type CrearTarifaResult,
  type ListarTarifasResult,
  type ObtenerTarifaResult,
} from "@/lib/types/tarifa";
import type { Actor, ITarifaService } from "@/lib/interfaces/services/ITarifaService";
import { TarifaService } from "@/lib/services/TarifaService";
import { TarifaRepository } from "@/lib/repositories/TarifaRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  withErrorHandler,
  isAppErrorShape,
  UnauthenticatedError,
  ValidationError,
  MSG,
  type AppErrorShape,
} from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";
import type { ActionError } from "@/lib/types/tarifa";

const idSchema = z.string().min(1);

// El diseno original decia que tarifas nunca produce `conflict` y esta funcion lo
// hacia cumplir lanzando. YA NO ES CIERTO y por eso se abre: la tabla tiene un unico
// `(zona_id, tienda_id)` (crear/actualizar pueden chocar) y el borrado es fisico
// contra una FK RESTRICT desde `cierre_detail`. `ActionError` de tarifas ahora
// incluye `conflict`, asi que el adaptador comun se usa tal cual.
function toTarifaActionError(shape: AppErrorShape): ActionError {
  return toActionError(shape);
}

function buildTarifaService(): ITarifaService {
  const prisma = getPrismaClient();
  return new TarifaService(new TarifaRepository(prisma));
}

export interface TarifaActionDeps {
  tarifaService?: ITarifaService;
  getActor?: () => Promise<Actor | null>;
}

/** R8/R14/R15/R16: crear tarifa. */
export async function crearTarifa(
  input: unknown,
  deps: TarifaActionDeps = {},
): Promise<CrearTarifaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8: antes de tocar el service
    const data = crearTarifaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.tarifaService ?? buildTarifaService();
    return service.crear(data, actor); // resultado tipado de dominio (R26)
  });
  return isAppErrorShape(r) ? toTarifaActionError(r) : r;
}

/** R8/R17: obtener tarifa por id. */
export async function obtenerTarifa(
  id: unknown,
  deps: TarifaActionDeps = {},
): Promise<ObtenerTarifaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // conserva la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.tarifaService ?? buildTarifaService();
    return service.obtener(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toTarifaActionError(r) : r;
}

/** R8/R18/R19: listar tarifas paginados. */
export async function listarTarifas(
  input: unknown,
  deps: TarifaActionDeps = {},
): Promise<ListarTarifasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8
    const data = listarTarifasSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.tarifaService ?? buildTarifaService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toTarifaActionError(r) : r;
}

/** R8/R20/R21/R22/R23: actualizar tarifa por id. */
export async function actualizarTarifa(
  id: unknown,
  input: unknown,
  deps: TarifaActionDeps = {},
): Promise<ActualizarTarifaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // conserva la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = actualizarTarifaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.tarifaService ?? buildTarifaService();
    return service.actualizar(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toTarifaActionError(r) : r;
}

/** R8: borrado FISICO de tarifa por id. `conflict` si algun cierre la congelo. */
export async function borrarTarifa(
  id: unknown,
  deps: TarifaActionDeps = {},
): Promise<BorrarTarifaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // conserva la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.tarifaService ?? buildTarifaService();
    return service.borrar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toTarifaActionError(r) : r;
}
