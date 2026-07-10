"use server";

import {
  idSchema,
  listarPostulacionesSchema,
  type DecisionResult,
  type ListarPostulacionesResult,
} from "@/lib/types/aprobacion-postulacion";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IAprobacionPostulacionService } from "@/lib/interfaces/services/IAprobacionPostulacionService";
import { AprobacionPostulacionService } from "@/lib/services/AprobacionPostulacionService";
import { AprobacionPostulacionRepository } from "@/lib/repositories/AprobacionPostulacionRepository";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError, ValidationError, MSG } from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

// Feature 22 (R1) — 3 Server Actions internas (no rutas API): listar/aprobar/
// rechazar postulaciones. Autentican con la sesion (R4), validan el borde con zod
// (R21) y traducen los resultados de dominio al contrato tipado (R20) reusando el
// manejador de errores global (feature 10). `deps` inyectables para test.

function buildService(): IAprobacionPostulacionService {
  const prisma = getPrismaClient();
  return new AprobacionPostulacionService(
    new AprobacionPostulacionRepository(prisma),
    new SupabaseSignedUrlProvider(),
  );
}

export interface AprobacionActionDeps {
  service?: IAprobacionPostulacionService;
  getActor?: () => Promise<Actor | null>;
}

/** R6-R11: listar postulaciones pendientes paginadas con URLs firmadas. */
export async function listarPostulacionesPendientes(
  input: unknown,
  deps: AprobacionActionDeps = {},
): Promise<ListarPostulacionesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4/R5: antes del service
    const data = listarPostulacionesSchema.parse(input ?? {}); // R21: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPendientes(data, actor); // R20: resultado de dominio
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R12-R15: aprobar una postulacion (pendiente -> activo). */
export async function aprobarPostulacion(
  id: unknown,
  deps: AprobacionActionDeps = {},
): Promise<DecisionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4/R5
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // R21: id vacio/mal formado -> validation_error sin tocar el service.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.service ?? buildService();
    return service.aprobar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R16-R19: rechazar una postulacion (pendiente -> inactivo). */
export async function rechazarPostulacion(
  id: unknown,
  deps: AprobacionActionDeps = {},
): Promise<DecisionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4/R5
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.service ?? buildService();
    return service.rechazar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
