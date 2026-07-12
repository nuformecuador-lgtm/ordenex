"use server";

import type { RolValue } from "@prisma/client";
import type { ActionError } from "@/lib/types/orden";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IUsuariosPorRolService } from "@/lib/interfaces/services/IUsuariosPorRolService";
import { UsuariosPorRolService } from "@/lib/services/UsuariosPorRolService";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

function buildUsuariosPorRolService(): IUsuariosPorRolService {
  return new UsuariosPorRolService(new UserRepository(getPrismaClient()));
}

export interface UsuariosPorRolActionDeps {
  usuariosPorRolService?: IUsuariosPorRolService;
  getActor?: () => Promise<Actor | null>;
}

export type ListarUsuariosPorRolResult =
  | { status: "ok"; usuarios: UsuarioPorRolDTO[] }
  | ActionError;

/** Lista usuarios activos del rol pedido (proyeccion id/nombre) para el select. */
export async function listarUsuariosPorRol(
  rolValue: RolValue,
  deps: UsuariosPorRolActionDeps = {},
): Promise<ListarUsuariosPorRolResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.usuariosPorRolService ?? buildUsuariosPorRolService();
    return service.listarPorRol(rolValue, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** Atajo: lista los adminTienda activos (misma estrategia que los mensajeros). */
export async function listarAdminTiendas(
  deps: UsuariosPorRolActionDeps = {},
): Promise<ListarUsuariosPorRolResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.usuariosPorRolService ?? buildUsuariosPorRolService();
    return service.listarAdminTiendas(actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
