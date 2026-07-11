"use server";

import {
  asignarBodegaSchema,
  generarGuiaSchema,
  rutearSateliteSchema,
  type AsignarBodegaResult,
  type GenerarGuiaResult,
  type ListarCatalogoEstatusResult,
  type ListarMensajerosParaAsignacionResult,
  type RutearSateliteResult,
} from "@/lib/types/orden-guia";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGuiaAsignacionService } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

function buildGuiaService(): IGuiaAsignacionService {
  const prisma = getPrismaClient();
  // Feature 30/R18: inyecta ademas ZonaRepository (guardia GAM); firmas estables.
  return new GuiaAsignacionService(new OrdenRepository(prisma), new ZonaRepository(prisma));
}

function buildOrdenRepo(): Pick<IOrdenRepository, "findMensajerosGam"> {
  return new OrdenRepository(getPrismaClient());
}

function buildZonaRepoParaMensajeros(): Pick<IZonaRepository, "findGamZonaId"> {
  return new ZonaRepository(getPrismaClient());
}

function buildOrdenRepoParaCatalogo(): Pick<IOrdenRepository, "listOrderStatus"> {
  return new OrdenRepository(getPrismaClient());
}

export interface GuiaActionDeps {
  guiaService?: IGuiaAsignacionService;
  getActor?: () => Promise<Actor | null>;
}

export interface ListarMensajerosDeps {
  ordenRepo?: Pick<IOrdenRepository, "findMensajerosGam">;
  zonaRepo?: Pick<IZonaRepository, "findGamZonaId">;
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
 * Feature 30/R5/R18: SOLO los usuarios rol mensajero de la zona GAM (firma y tipo
 * `MensajeroLiteDTO[]` intactos respecto a la feature 17). Resuelve `gamZonaId` y
 * filtra por zona en el repo; si aun no hay zona GAM configurada -> lista vacia
 * (la UI ya maneja lista vacia; la escritura falla con R4 en el service, mensaje
 * claro). `maestro` escribe y `admin` es solo-lectura (R16); ambos pueden listar
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
    const zonaRepo = deps.zonaRepo ?? buildZonaRepoParaMensajeros();
    const gamZonaId = await zonaRepo.findGamZonaId();
    if (gamZonaId === null) {
      // R5: sin zona GAM configurada, no hay mensajeros GAM que listar.
      return { status: "ok" as const, mensajeros: [] };
    }
    const repo = deps.ordenRepo ?? buildOrdenRepo();
    const mensajeros = await repo.findMensajerosGam(gamZonaId);
    return { status: "ok" as const, mensajeros };
  });
  // Este borde solo puede lanzar UnauthenticatedError (no hay zod aqui): el
  // unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** Feature 30/R13/R16: rutea ordenes no-GAM a en_ruta_bodega_satelite (solo maestro). */
export async function rutearABodegaSatelite(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<RutearSateliteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = rutearSateliteSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.guiaService ?? buildGuiaService();
    return service.rutearABodegaSatelite(data, actor); // resultado tipado de dominio
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
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
