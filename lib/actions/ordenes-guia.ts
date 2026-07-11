"use server";

import {
  asignarBodegaSchema,
  generarGuiaSchema,
  type AsignarBodegaResult,
  type GenerarGuiaResult,
  type ListarCatalogoEstatusResult,
  type ListarMensajerosParaAsignacionResult,
} from "@/lib/types/orden-guia";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGuiaAsignacionService } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

function buildGuiaService(): IGuiaAsignacionService {
  const prisma = getPrismaClient();
  return new GuiaAsignacionService(new OrdenRepository(prisma));
}

function buildOrdenRepo(): Pick<IOrdenRepository, "findAllMensajeros"> {
  return new OrdenRepository(getPrismaClient());
}

function buildOrdenRepoParaCatalogo(): Pick<IOrdenRepository, "listOrderStatus"> {
  return new OrdenRepository(getPrismaClient());
}

export interface GuiaActionDeps {
  guiaService?: IGuiaAsignacionService;
  getActor?: () => Promise<Actor | null>;
}

export interface ListarMensajerosDeps {
  ordenRepo?: Pick<IOrdenRepository, "findAllMensajeros">;
  getActor?: () => Promise<Actor | null>;
}

export interface ListarCatalogoEstatusDeps {
  ordenRepo?: Pick<IOrdenRepository, "listOrderStatus">;
  getActor?: () => Promise<Actor | null>;
}

// Traduce el AppErrorShape que puede producir este borde: solo ZodError
// (VALIDATION_ERROR) o falta de sesion (UNAUTHORIZED, R14). `forbidden` y
// `conflict` los devuelve el service directamente como resultado de dominio
// (nunca como excepcion), por eso NO aparecen aqui.
function toGuiaActionError(
  shape: AppErrorShape,
): { status: "validation_error"; fieldErrors: Record<string, string[]> } | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      // FORBIDDEN/NOT_FOUND/CONFLICT/INTERNAL: este borde nunca los lanza como
      // AppError; si algo desconocido llega aqui, se propaga como fallo real.
      throw new Error(`ordenes-guia: AppErrorCode inesperado ${shape.code}`);
  }
}

/** R11-R14/R18-R25/R27-R29: genera guia y transiciona el lote (solo maestro). */
export async function generarGuia(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<GenerarGuiaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R14: antes de tocar el service
    const data = generarGuiaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.guiaService ?? buildGuiaService();
    return service.generarGuia(data, actor); // resultado tipado de dominio
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/** R26-R29: asigna mensajero a ordenes en_bodega (solo maestro). */
export async function asignarDesdeBodega(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<AsignarBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = asignarBodegaSchema.parse(input);
    const service = deps.guiaService ?? buildGuiaService();
    return service.asignarDesdeBodega(data, actor);
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/**
 * T15/R28: TODOS los usuarios rol mensajero, SIN filtro de zona (la feature 30
 * restringira el CUERPO de este loader sin cambiar la firma). `maestro` escribe
 * en este modulo y `admin` es solo-lectura (R12); ambos pueden listar
 * mensajeros para el modal. El resto -> forbidden.
 */
export async function listarMensajerosParaAsignacion(
  deps: ListarMensajerosDeps = {},
): Promise<ListarMensajerosParaAsignacionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    if (actor.rol !== "maestro" && actor.rol !== "admin") {
      return { status: "forbidden" as const };
    }
    const repo = deps.ordenRepo ?? buildOrdenRepo();
    const mensajeros = await repo.findAllMensajeros();
    return { status: "ok" as const, mensajeros };
  });
  // Este borde solo puede lanzar UnauthenticatedError (no hay zod aqui): el
  // unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Soporte R15/R16 — loader de solo lectura del catalogo `order_status` (id,
 * value) para que la UI del maestro resuelva `value` -> `estatusId` y siga
 * usando `listarOrdenes` (contrato feature 6/7 intacto, patron "filtrando
 * estatusId por value" de design.md §4). `maestro` y `admin` pueden leer
 * (mismo criterio de solo-lectura que `listarMensajerosParaAsignacion`); el
 * resto -> forbidden.
 */
export async function listarCatalogoEstatus(
  deps: ListarCatalogoEstatusDeps = {},
): Promise<ListarCatalogoEstatusResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    if (actor.rol !== "maestro" && actor.rol !== "admin") {
      return { status: "forbidden" as const };
    }
    const repo = deps.ordenRepo ?? buildOrdenRepoParaCatalogo();
    const estatus = await repo.listOrderStatus();
    return { status: "ok" as const, estatus };
  });
  // Este borde solo puede lanzar UnauthenticatedError (no hay zod aqui): el
  // unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}
