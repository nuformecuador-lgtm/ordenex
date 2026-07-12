"use server";

import { z } from "zod";
import {
  actualizarZonaSchema,
  crearZonaSchema,
  listarZonasSchema,
  type ActualizarZonaResult,
  type ArbolZonasResult,
  type BorrarZonaResult,
  type CrearZonaResult,
  type ListarZonasResult,
  type MarcarZonaGamResult,
  type ObtenerZonaResult,
  type ZonaActionError,
} from "@/lib/types/zona";
import type { Actor, IZonaService } from "@/lib/interfaces/services/IZonaService";
import { ZonaService } from "@/lib/services/ZonaService";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
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

// Traduce el AppErrorShape del manejador global al ZonaActionError tipado. A
// diferencia de tarifas, el dominio de zonas SI produce `conflict` (borrar una
// zona referenciada). Switch exhaustivo sobre los 6 AppErrorCode.
function toZonaActionError(shape: AppErrorShape): ZonaActionError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
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
      throw new Error("internal");
    default: {
      const _exhaustive: never = shape.code;
      throw new Error(`Unhandled AppErrorCode: ${String(_exhaustive)}`);
    }
  }
}

function buildZonaService(): IZonaService {
  const prisma = getPrismaClient();
  return new ZonaService(new ZonaRepository(prisma));
}

export interface ZonaActionDeps {
  zonaService?: IZonaService;
  getActor?: () => Promise<Actor | null>;
}

/** Crear zona (solo maestro). */
export async function crearZona(
  input: unknown,
  deps: ZonaActionDeps = {},
): Promise<CrearZonaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = crearZonaSchema.parse(input);
    const service = deps.zonaService ?? buildZonaService();
    return service.crear(data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** Obtener zona por id (solo maestro). */
export async function obtenerZona(
  id: unknown,
  deps: ZonaActionDeps = {},
): Promise<ObtenerZonaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.zonaService ?? buildZonaService();
    return service.obtener(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** Listar zonas paginadas; include opcional ["tarifas"] (solo maestro). */
export async function listarZonas(
  input: unknown,
  deps: ZonaActionDeps = {},
): Promise<ListarZonasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarZonasSchema.parse(input ?? {});
    const service = deps.zonaService ?? buildZonaService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** Actualizar zona por id (reemplazo completo; solo maestro). */
export async function actualizarZona(
  id: unknown,
  input: unknown,
  deps: ZonaActionDeps = {},
): Promise<ActualizarZonaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = actualizarZonaSchema.parse(input);
    const service = deps.zonaService ?? buildZonaService();
    return service.actualizar(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/**
 * Marca una zona como la GAM (feature 24/R3). Designa esta zona como la unica en
 * true: el service/repo desmarca cualquier otra. Solo maestro.
 */
export async function marcarZonaGam(
  id: unknown,
  deps: ZonaActionDeps = {},
): Promise<MarcarZonaGamResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.zonaService ?? buildZonaService();
    return service.marcarGam(parsedId.data, true, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** Borrado FISICO de zona por id (solo maestro). */
export async function borrarZona(
  id: unknown,
  deps: ZonaActionDeps = {},
): Promise<BorrarZonaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.zonaService ?? buildZonaService();
    return service.borrar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** Arbol zona -> canton -> distrito indexado por nombre normalizado (solo maestro). */
export async function arbolZonas(deps: ZonaActionDeps = {}): Promise<ArbolZonasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.zonaService ?? buildZonaService();
    return service.arbol(actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}
