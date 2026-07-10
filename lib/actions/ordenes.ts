"use server";

import { z } from "zod";
import {
  actualizarOrdenSchema,
  crearOrdenSchema,
  listarOrdenesSchema,
  type ActionError,
  type ActualizarOrdenResult,
  type BorrarOrdenResult,
  type CrearOrdenResult,
  type ListarOrdenesResult,
  type ObtenerOrdenResult,
} from "@/lib/types/orden";
import type { Actor, IOrdenService } from "@/lib/interfaces/services/IOrdenService";
import { OrdenService } from "@/lib/services/OrdenService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
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

const idSchema = z.string().min(1);

function buildOrdenService(): IOrdenService {
  const prisma = getPrismaClient();
  return new OrdenService(new OrdenRepository(prisma));
}

export interface OrdenActionDeps {
  ordenService?: IOrdenService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Adaptador inverso de CODE_BY_DOMAIN_STATUS: traduce el AppErrorShape que produce
 * el manejador global de errores al ActionError tipado que consume la UI, SIN
 * cambiar el contrato publico. Switch exhaustivo sobre los 6 AppErrorCode.
 */
function toActionError(shape: AppErrorShape): ActionError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        // La frontera ya fue validada por el handler global (normalizeError produce
        // details.fieldErrors via z.flattenError o via ValidationError con details).
        // Casteo seguro en esa frontera, sin `any`.
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    case "FORBIDDEN":
      return { status: "forbidden" };
    case "NOT_FOUND":
      return { status: "not_found" };
    case "CONFLICT":
      return { status: "conflict" };
    case "INTERNAL":
      // R: re-lanzar. El handler global ya loggeo el error real; preservamos el 500
      // actual sin exponer detalles internos ni ampliar el contrato ActionError.
      throw new Error("internal");
    default: {
      const _exhaustive: never = shape.code;
      throw new Error(`Unhandled AppErrorCode: ${String(_exhaustive)}`);
    }
  }
}

/** R25/R26/R27/R28: crear orden. */
export async function crearOrden(
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<CrearOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18: antes de tocar el service
    const data = crearOrdenSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.ordenService ?? buildOrdenService();
    return service.crear(data, actor); // R42: resultado tipado de dominio
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R29/R34: obtener orden por id. */
export async function obtenerOrden(
  id: unknown,
  deps: OrdenActionDeps = {},
): Promise<ObtenerOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // R9: conservar la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.ordenService ?? buildOrdenService();
    return service.obtener(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R30/R31/R32/R33/R34: listar ordenes paginadas. */
export async function listarOrdenes(
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<ListarOrdenesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18
    const data = listarOrdenesSchema.parse(input ?? {}); // R32: ZodError -> VALIDATION_ERROR
    const service = deps.ordenService ?? buildOrdenService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R35/R36/R37/R38: actualizar orden por id. */
export async function actualizarOrden(
  id: unknown,
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<ActualizarOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // R9: conservar la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = actualizarOrdenSchema.parse(input); // R38: ZodError -> VALIDATION_ERROR
    const service = deps.ordenService ?? buildOrdenService();
    return service.actualizar(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R39/R40/R41: borrado logico de orden por id. */
export async function borrarOrden(
  id: unknown,
  deps: OrdenActionDeps = {},
): Promise<BorrarOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // R9: conservar la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.ordenService ?? buildOrdenService();
    return service.borrar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
