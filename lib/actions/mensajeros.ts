"use server";

import type { ActionError } from "@/lib/types/orden";
import {
  asignarMensajeroSchema,
  resumenCargaSchema,
  type MensajeroDTO,
  type ResumenCargaOrdenDTO,
} from "@/lib/types/asignacion-mensajero";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IAsignacionMensajeroService } from "@/lib/interfaces/services/IAsignacionMensajeroService";
import { AsignacionMensajeroService } from "@/lib/services/AsignacionMensajeroService";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

function buildAsignacionService(): IAsignacionMensajeroService {
  const prisma = getPrismaClient();
  return new AsignacionMensajeroService(new UserRepository(prisma), new OrdenRepository(prisma));
}

export interface AsignacionMensajeroActionDeps {
  asignacionService?: IAsignacionMensajeroService;
  getActor?: () => Promise<Actor | null>;
}

export type ListarMensajerosResult = { status: "ok"; mensajeros: MensajeroDTO[] } | ActionError;
export type ResumenCargaMasivaResult =
  | { status: "ok"; ordenes: ResumenCargaOrdenDTO[] }
  | ActionError;
export type AsignarMensajeroSugeridoResult = { status: "ok"; asignadas: number } | ActionError;

/** R1/R4/R5: lista mensajeros activos para el select. */
export async function listarMensajeros(
  deps: AsignacionMensajeroActionDeps = {},
): Promise<ListarMensajerosResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const service = deps.asignacionService ?? buildAsignacionService();
    return service.listarMensajeros(actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R6/R11/R19: resumen del lote recien cargado (num_remision -> orden). */
export async function resumenCargaMasiva(
  input: unknown,
  deps: AsignacionMensajeroActionDeps = {},
): Promise<ResumenCargaMasivaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = resumenCargaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.asignacionService ?? buildAsignacionService();
    return service.resumenCargaMasiva(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R12-R18/R17/R19: asigna mensajero_sugerido_id (global + override). */
export async function asignarMensajeroSugerido(
  input: unknown,
  deps: AsignacionMensajeroActionDeps = {},
): Promise<AsignarMensajeroSugeridoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = asignarMensajeroSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.asignacionService ?? buildAsignacionService();
    return service.asignarMensajeroSugerido(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
