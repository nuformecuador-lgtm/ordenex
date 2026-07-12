"use server";

import { z } from "zod";
import {
  actualizarUsuarioSchema,
  cambiarEstadoUsuarioSchema,
  crearUsuarioSchema,
  listarUsuariosSchema,
  type ActionError,
  type ActualizarUsuarioResult,
  type CambiarEstadoUsuarioResult,
  type CrearUsuarioResult,
  type ListarRolesResult,
  type ListarTiposIdentificacionResult,
  type ListarUsuariosResult,
  type ObtenerUsuarioResult,
} from "@/lib/types/usuario";
import type { Actor, IUsuarioService } from "@/lib/interfaces/services/IUsuarioService";
import { UsuarioService } from "@/lib/services/UsuarioService";
import { UserRepository } from "@/lib/repositories/UserRepository";
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
import { toActionError } from "@/lib/actions/_shared/to-action-error";

const idSchema = z.string().min(1);

// R28: adapta el AppErrorShape del manejador global al ActionError propio. El
// service ya traduce los conflictos de unicidad a resultados de dominio con
// `campo`; un `conflict` en el borde no deberia ocurrir aqui.
function toUsuarioActionError(shape: AppErrorShape): ActionError {
  const err = toActionError(shape);
  if (err.status === "conflict") {
    throw new Error(`unexpected conflict status in usuarios action: ${shape.code}`);
  }
  return err;
}

function buildUsuarioService(): IUsuarioService {
  const prisma = getPrismaClient();
  // Feature 24/R28: se inyecta el repo de zonas para validar `usuario.zona_id`.
  return new UsuarioService(new UserRepository(prisma), new ZonaRepository(prisma));
}

export interface UsuarioActionDeps {
  usuarioService?: IUsuarioService;
  getActor?: () => Promise<Actor | null>;
}

/** R1/R2/R5/R6/R33: crear usuario (propaga `generatedPassword` en modo generate). */
export async function crearUsuario(
  input: unknown,
  deps: UsuarioActionDeps = {},
): Promise<CrearUsuarioResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2: antes de tocar el service
    const data = crearUsuarioSchema.parse(input); // ZodError -> VALIDATION_ERROR (R5/R6)
    const service = deps.usuarioService ?? buildUsuarioService();
    return service.crear(data, actor);
  });
  return isAppErrorShape(r) ? toUsuarioActionError(r) : r;
}

/** R1/R2/R13: listar usuarios paginados. */
export async function listarUsuarios(
  input: unknown,
  deps: UsuarioActionDeps = {},
): Promise<ListarUsuariosResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2
    const data = listarUsuariosSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.usuarioService ?? buildUsuarioService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toUsuarioActionError(r) : r;
}

/** R1/R2: obtener usuario por id. */
export async function obtenerUsuario(
  id: unknown,
  deps: UsuarioActionDeps = {},
): Promise<ObtenerUsuarioResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.usuarioService ?? buildUsuarioService();
    return service.obtener(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toUsuarioActionError(r) : r;
}

/** R1/R2/R16: actualizar campos editables del usuario. */
export async function actualizarUsuario(
  id: unknown,
  input: unknown,
  deps: UsuarioActionDeps = {},
): Promise<ActualizarUsuarioResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = actualizarUsuarioSchema.parse(input); // ZodError -> VALIDATION_ERROR (R16)
    const service = deps.usuarioService ?? buildUsuarioService();
    return service.actualizar(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toUsuarioActionError(r) : r;
}

/** R1/R2/R23: activar/inactivar usuario (baja logica). */
export async function cambiarEstadoUsuario(
  id: unknown,
  input: unknown,
  deps: UsuarioActionDeps = {},
): Promise<CambiarEstadoUsuarioResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = cambiarEstadoUsuarioSchema.parse(input); // ZodError -> VALIDATION_ERROR (R23)
    const service = deps.usuarioService ?? buildUsuarioService();
    return service.cambiarEstado(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toUsuarioActionError(r) : r;
}

/** R1/R2/R29: catalogo de tipos de identificacion para el formulario. */
export async function listarTiposIdentificacion(
  deps: UsuarioActionDeps = {},
): Promise<ListarTiposIdentificacionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2
    const service = deps.usuarioService ?? buildUsuarioService();
    return service.listarTiposIdentificacion(actor);
  });
  return isAppErrorShape(r) ? toUsuarioActionError(r) : r;
}

/** R1/R2: catalogo de roles para poblar el select del formulario. */
export async function listarRoles(
  deps: UsuarioActionDeps = {},
): Promise<ListarRolesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2
    const service = deps.usuarioService ?? buildUsuarioService();
    return service.listarRoles(actor);
  });
  return isAppErrorShape(r) ? toUsuarioActionError(r) : r;
}
