"use server";

import { z } from "zod";
import {
  actualizarZonaSchema,
  crearZonaSchema,
  listarZonasSchema,
  type ActualizarZonaResult,
  type CrearZonaResult,
  type ListarCantonesResult,
  type ListarDistritosResult,
  type ListarProvinciasResult,
  type ListarZonasLightResult,
  type ListarZonasResult,
  type MarcarZonaGamResult,
  type ObtenerZonaResult,
  type ZonaActionError,
} from "@/lib/types/zona";
import type { Actor, IZonaService } from "@/lib/interfaces/services/IZonaService";
import { ZonaService } from "@/lib/services/ZonaService";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { GeoRepository } from "@/lib/repositories/GeoRepository";
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

const idSchema = z.string().min(1);

// R25: adapta el AppErrorShape del manejador global al ActionError propio. Los
// conflictos de dominio (nombre/distrito) los produce el service como resultado
// discriminado, no el manejador global; un `conflict` por esta via seria un bug.
function toZonaActionError(shape: AppErrorShape): ZonaActionError {
  const err = toActionError(shape);
  if (err.status === "conflict") {
    throw new Error(`unexpected conflict status in zonas action: ${shape.code}`);
  }
  return err;
}

function buildZonaService(): IZonaService {
  const prisma = getPrismaClient();
  return new ZonaService(new ZonaRepository(prisma), new GeoRepository(prisma));
}

export interface ZonaActionDeps {
  zonaService?: IZonaService;
  getActor?: () => Promise<Actor | null>;
}

/** R13/R25/R26: crear zona. */
export async function crearZona(
  input: unknown,
  deps: ZonaActionDeps = {},
): Promise<CrearZonaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13: antes de tocar el service
    const data = crearZonaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R19)
    const service = deps.zonaService ?? buildZonaService();
    return service.crear(data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** R13: obtener zona por id. */
export async function obtenerZona(
  id: unknown,
  deps: ZonaActionDeps = {},
): Promise<ObtenerZonaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.zonaService ?? buildZonaService();
    return service.obtener(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** R13/R24: listar zonas paginadas. */
export async function listarZonas(
  input: unknown,
  deps: ZonaActionDeps = {},
): Promise<ListarZonasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const data = listarZonasSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.zonaService ?? buildZonaService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** R13/R22/R25/R26: actualizar zona (el `id` viaja en el input). */
export async function actualizarZona(
  input: unknown,
  deps: ZonaActionDeps = {},
): Promise<ActualizarZonaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const data = actualizarZonaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R19)
    const service = deps.zonaService ?? buildZonaService();
    return service.actualizar(data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** R13/R23: marcar una zona como GAM (desmarca la anterior). */
export async function marcarZonaGam(
  id: unknown,
  deps: ZonaActionDeps = {},
): Promise<MarcarZonaGamResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.zonaService ?? buildZonaService();
    return service.marcarGam(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** R13/R15: listado ligero de zonas para selectores de otras features. */
export async function listarZonasLight(
  deps: ZonaActionDeps = {},
): Promise<ListarZonasLightResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const service = deps.zonaService ?? buildZonaService();
    return service.listarLight(actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** R13/R14: catalogo geografico global — provincias. */
export async function listarProvincias(
  deps: ZonaActionDeps = {},
): Promise<ListarProvinciasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const service = deps.zonaService ?? buildZonaService();
    return service.listarProvincias(actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** R13/R14: catalogo geografico global — cantones de una provincia. */
export async function listarCantones(
  provinciaId: unknown,
  deps: ZonaActionDeps = {},
): Promise<ListarCantonesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const parsedId = idSchema.safeParse(provinciaId);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { provinciaId: ["id invalido"] },
      });
    }
    const service = deps.zonaService ?? buildZonaService();
    return service.listarCantones(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

/** R13/R14: catalogo geografico global — distritos de un canton (con marca de zona). */
export async function listarDistritos(
  cantonId: unknown,
  deps: ZonaActionDeps = {},
): Promise<ListarDistritosResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const parsedId = idSchema.safeParse(cantonId);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { cantonId: ["id invalido"] } });
    }
    const service = deps.zonaService ?? buildZonaService();
    return service.listarDistritos(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}
