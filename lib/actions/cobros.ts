"use server";

import { z } from "zod";
import {
  actualizarCobroSchema,
  crearCobroSchema,
  listarCobrosSchema,
  type ActualizarCobroResult,
  type BorrarCobroResult,
  type CrearCobroResult,
  type ListarCobrosResult,
  type ObtenerCobroResult,
} from "@/lib/types/cobro";
import type { Actor, ICobroService } from "@/lib/interfaces/services/ICobroService";
import { CobroService } from "@/lib/services/CobroService";
import { CobroRepository } from "@/lib/repositories/CobroRepository";
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
import type { ActionError } from "@/lib/types/cobro";

const idSchema = z.string().min(1);

// design.md: no hay estado `conflict` para cobros (id uuid, nombre no unico).
// `toActionError` (compartido con ordenes) es superset con `conflict`; aqui se
// angosta al `ActionError` propio de cobros sin modificar el adaptador comun.
function toCobroActionError(shape: AppErrorShape): ActionError {
  const err = toActionError(shape);
  if (err.status === "conflict") {
    // El dominio de cobros nunca produce un conflicto de unicidad (R26).
    throw new Error(`unexpected conflict status in cobros action: ${shape.code}`);
  }
  return err;
}

function buildCobroService(): ICobroService {
  const prisma = getPrismaClient();
  return new CobroService(new CobroRepository(prisma));
}

export interface CobroActionDeps {
  cobroService?: ICobroService;
  getActor?: () => Promise<Actor | null>;
}

/** R8/R14/R15/R16: crear cobro. */
export async function crearCobro(
  input: unknown,
  deps: CobroActionDeps = {},
): Promise<CrearCobroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8: antes de tocar el service
    const data = crearCobroSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.cobroService ?? buildCobroService();
    return service.crear(data, actor); // resultado tipado de dominio (R26)
  });
  return isAppErrorShape(r) ? toCobroActionError(r) : r;
}

/** R8/R17: obtener cobro por id. */
export async function obtenerCobro(
  id: unknown,
  deps: CobroActionDeps = {},
): Promise<ObtenerCobroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // conserva la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.cobroService ?? buildCobroService();
    return service.obtener(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toCobroActionError(r) : r;
}

/** R8/R18/R19: listar cobros paginados. */
export async function listarCobros(
  input: unknown,
  deps: CobroActionDeps = {},
): Promise<ListarCobrosResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8
    const data = listarCobrosSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.cobroService ?? buildCobroService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toCobroActionError(r) : r;
}

/** R8/R20/R21/R22/R23: actualizar cobro por id. */
export async function actualizarCobro(
  id: unknown,
  input: unknown,
  deps: CobroActionDeps = {},
): Promise<ActualizarCobroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // conserva la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = actualizarCobroSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.cobroService ?? buildCobroService();
    return service.actualizar(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toCobroActionError(r) : r;
}

/** R8/R24/R25: borrado logico de cobro por id. */
export async function borrarCobro(
  id: unknown,
  deps: CobroActionDeps = {},
): Promise<BorrarCobroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R8
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // conserva la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.cobroService ?? buildCobroService();
    return service.borrar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toCobroActionError(r) : r;
}
