"use server";

import { z } from "zod";
import {
  actualizarPlantillaSchema,
  cambiarEstadoPlantillaSchema,
  crearPlantillaSchema,
  listarPlantillasSchema,
  previewPlantillaSchema,
  type ActionError,
  type ActualizarPlantillaResult,
  type CambiarEstadoPlantillaResult,
  type CrearPlantillaResult,
  type EliminarPlantillaResult,
  type ListarPlantillasResult,
  type ObtenerPlantillaResult,
  type PreviewPlantillaResult,
} from "@/lib/types/plantilla-mensaje";
import type {
  Actor,
  IPlantillaMensajeService,
} from "@/lib/interfaces/services/IPlantillaMensajeService";
import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
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

// Adapta el AppErrorShape del manejador global al ActionError propio. Los conflictos de
// unicidad los devuelve el service como resultado de dominio (`conflict` con `campo`); un
// `conflict` en el borde (thrown) no deberia ocurrir aqui. Patron `toUsuarioActionError`.
function toPlantillaActionError(shape: AppErrorShape): ActionError {
  const err = toActionError(shape);
  if (err.status === "conflict") {
    throw new Error(`unexpected conflict status in plantillas action: ${shape.code}`);
  }
  return err;
}

function buildPlantillaService(): IPlantillaMensajeService {
  const prisma = getPrismaClient();
  return new PlantillaMensajeService(new PlantillaMensajeRepository(prisma));
}

export interface PlantillaActionDeps {
  plantillaService?: IPlantillaMensajeService;
  getActor?: () => Promise<Actor | null>;
}

/** R4/R5/R8: crear plantilla (nace `pending`). */
export async function crearPlantilla(
  input: unknown,
  deps: PlantillaActionDeps = {},
): Promise<CrearPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4: antes de tocar el service
    const data = crearPlantillaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R9/R11)
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.crear(data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R6/R7: listar plantillas paginadas. */
export async function listarPlantillas(
  input: unknown,
  deps: PlantillaActionDeps = {},
): Promise<ListarPlantillasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const data = listarPlantillasSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5: obtener plantilla por id. */
export async function obtenerPlantilla(
  id: unknown,
  deps: PlantillaActionDeps = {},
): Promise<ObtenerPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.obtener(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R20/R22: actualizar nombre y/o cuerpo. */
export async function actualizarPlantilla(
  id: unknown,
  input: unknown,
  deps: PlantillaActionDeps = {},
): Promise<ActualizarPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = actualizarPlantillaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R22)
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.actualizar(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R24/R25: DESACTIVAR (unica transicion del front). */
export async function cambiarEstadoPlantilla(
  id: unknown,
  input: unknown,
  deps: PlantillaActionDeps = {},
): Promise<CambiarEstadoPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = cambiarEstadoPlantillaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R25)
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.cambiarEstado(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R27: eliminar (soft delete). */
export async function eliminarPlantilla(
  id: unknown,
  deps: PlantillaActionDeps = {},
): Promise<EliminarPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.eliminar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R18: vista previa del cuerpo con los ejemplos del catalogo. */
export async function previewPlantilla(
  cuerpo: unknown,
  deps: PlantillaActionDeps = {},
): Promise<PreviewPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsed = previewPlantillaSchema.safeParse(cuerpo);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { cuerpo: ["cuerpo invalido"] } });
    }
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.preview(parsed.data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}
