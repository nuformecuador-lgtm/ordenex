"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import {
  actualizarOrdenSchema,
  crearOrdenSchema,
  listarOrdenesSchema,
  type ActualizarOrdenResult,
  type BorrarOrdenResult,
  type CrearOrdenResult,
  type ListarOrdenesResult,
  type ObtenerOrdenResult,
} from "@/lib/types/orden";
import type { Actor, IOrdenService } from "@/lib/interfaces/services/IOrdenService";
import { OrdenService } from "@/lib/services/OrdenService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { SessionRepository } from "@/lib/repositories/SessionRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { SESSION_COOKIE_NAME } from "@/lib/constants/auth";

const idSchema = z.string().min(1);

function buildOrdenService(): IOrdenService {
  const prisma = getPrismaClient();
  return new OrdenService(new OrdenRepository(prisma));
}

/**
 * Resuelve el actor autenticado desde la cookie de sesion (R18/R19): valida la
 * sesion y resuelve el rol (RolValue) del usuario. Devuelve null si no hay sesion
 * valida, sin tocar la capa de ordenes.
 */
async function resolveActorFromSession(): Promise<Actor | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const prisma = getPrismaClient();
  const session = await new SessionRepository(prisma).findValidById(sessionId);
  if (!session) return null;

  const usuario = await prisma.usuario.findUnique({
    where: { id: session.userId },
    include: { rol: true },
  });
  if (!usuario) return null;

  return { usuarioId: usuario.id, rol: usuario.rol.value };
}

export interface OrdenActionDeps {
  ordenService?: IOrdenService;
  getActor?: () => Promise<Actor | null>;
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  return error.flatten().fieldErrors as Record<string, string[]>;
}

/** R25/R26/R27/R28: crear orden. */
export async function crearOrden(
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<CrearOrdenResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R18

  const parsed = crearOrdenSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "validation_error", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const service = deps.ordenService ?? buildOrdenService();
  return service.crear(parsed.data, actor); // R42: resultado tipado
}

/** R29/R34: obtener orden por id. */
export async function obtenerOrden(
  id: unknown,
  deps: OrdenActionDeps = {},
): Promise<ObtenerOrdenResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R18

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return { status: "validation_error", fieldErrors: { id: ["id invalido"] } };
  }

  const service = deps.ordenService ?? buildOrdenService();
  return service.obtener(parsedId.data, actor);
}

/** R30/R31/R32/R33/R34: listar ordenes paginadas. */
export async function listarOrdenes(
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<ListarOrdenesResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R18

  const parsed = listarOrdenesSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { status: "validation_error", fieldErrors: fieldErrorsFrom(parsed.error) }; // R32
  }

  const service = deps.ordenService ?? buildOrdenService();
  return service.listar(parsed.data, actor);
}

/** R35/R36/R37/R38: actualizar orden por id. */
export async function actualizarOrden(
  id: unknown,
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<ActualizarOrdenResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R18

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return { status: "validation_error", fieldErrors: { id: ["id invalido"] } };
  }
  const parsed = actualizarOrdenSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "validation_error", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const service = deps.ordenService ?? buildOrdenService();
  return service.actualizar(parsedId.data, parsed.data, actor);
}

/** R39/R40/R41: borrado logico de orden por id. */
export async function borrarOrden(
  id: unknown,
  deps: OrdenActionDeps = {},
): Promise<BorrarOrdenResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R18

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return { status: "validation_error", fieldErrors: { id: ["id invalido"] } };
  }

  const service = deps.ordenService ?? buildOrdenService();
  return service.borrar(parsedId.data, actor);
}
