"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { GastoFijoPlantillaRepository } from "@/lib/repositories/GastoFijoPlantillaRepository";
import { GastoFijoPlantillaService } from "@/lib/services/GastoFijoPlantillaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ActualizarPlantillaServiceResult,
  CrearPlantillaServiceResult,
  IGastoFijoPlantillaService,
  ListarPlantillasPaginadoServiceResult,
  ListarPlantillasServiceResult,
  SetActivaPlantillaServiceResult,
} from "@/lib/interfaces/services/IGastoFijoPlantillaService";
import {
  actualizarGastoFijoPlantillaSchema,
  crearGastoFijoPlantillaSchema,
  listarPlantillasGastoFijoCompletoSchema,
  listarPlantillasGastoFijoPaginadoSchema,
  setActivaPlantillaSchema,
  type ListarPlantillasCompletoResult,
} from "@/lib/types/gasto-fijo-plantilla";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 45 (T19) — Server Actions del CRUD de PLANTILLAS de gasto fijo (patron
// lib/actions/wallet.ts). Resuelve el actor por sesion, valida en el borde con zod y delega
// en el servicio bajo `withErrorHandler`. `unauthenticated` (sin sesion, R18) y
// `validation_error` (ZodError, R24) se resuelven en el borde; `forbidden`/`ok`/`not_found`
// los devuelve el service. Money-safe: DTOs con montos STRING (R12). Sin borrado (R25).

export type CrearPlantillaActionResult =
  | CrearPlantillaServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type ActualizarPlantillaActionResult =
  | ActualizarPlantillaServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type SetActivaPlantillaActionResult =
  | SetActivaPlantillaServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type ListarPlantillasActionResult =
  | ListarPlantillasServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

// Feature 170 (T I.1, R41): el listado paginado. `forbidden` lo decide el servicio;
// `unauthenticated` y `validation_error`, este borde.
export type ListarPlantillasPaginadoActionResult =
  | ListarPlantillasPaginadoServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

function toPlantillaActionError(
  shape: AppErrorShape,
):
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`gasto-fijo-plantilla: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IGastoFijoPlantillaService {
  const prisma = getPrismaClient();
  return new GastoFijoPlantillaService(new GastoFijoPlantillaRepository(prisma));
}

export interface PlantillaDeps {
  service?: IGastoFijoPlantillaService;
  getActor?: () => Promise<Actor | null>;
}

/** R17/R18/R24: crea una plantilla de gasto fijo (solo maestro). */
export async function crearPlantillaAction(
  input: unknown,
  deps: PlantillaDeps = {},
): Promise<CrearPlantillaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = crearGastoFijoPlantillaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R24)
    const service = deps.service ?? buildService();
    return service.crearPlantilla(data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R17/R18/R25: edita concepto/monto de una plantilla (solo maestro). */
export async function actualizarPlantillaAction(
  input: unknown,
  deps: PlantillaDeps = {},
): Promise<ActualizarPlantillaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = actualizarGastoFijoPlantillaSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.actualizarPlantilla(data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R17/R18/R25: activa/desactiva una plantilla (solo maestro; sin borrado). */
export async function setActivaPlantillaAction(
  input: unknown,
  deps: PlantillaDeps = {},
): Promise<SetActivaPlantillaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = setActivaPlantillaSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.setActivaPlantilla(data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R17/R18/R26: lista todas las plantillas (solo maestro). */
export async function listarPlantillasAction(
  deps: PlantillaDeps = {},
): Promise<ListarPlantillasActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.service ?? buildService();
    return service.listarPlantillas(actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41/R44): UNA pagina de las plantillas + el total.
 *
 * Espejo exacto de `listarPlantillasAction` con `page`/`pageSize` validados por zod; el rol
 * lo sigue decidiendo el servicio (R17).
 */
export async function listarPlantillasPaginadoAction(
  input: unknown,
  deps: PlantillaDeps = {},
): Promise<ListarPlantillasPaginadoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarPlantillasGastoFijoPaginadoSchema.parse(input); // -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPlantillasPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/**
 * Feature 184 — Tanda G (R1/R6/R7/R17) — el CONJUNTO de las plantillas, sin recorte, para
 * producir el archivo (listado 11 del Anexo A).
 *
 * Sustituye a la relectura de `listarPlantillasAction()` que hacia el panel. La sustitucion NO
 * abarata la consulta —es la misma, sobre la misma tabla— y esta bitacora no va a fingir que si:
 * lo que gana es que el tope de filas lo decide el SERVIDOR (R6) y que el conjunto llega ya en
 * el contrato comun de descarga, sin que la pantalla tenga que destripar `{ plantillas }`.
 *
 * Como este listado no tiene filtros, la lista blanca derivada de la de su pagina no deja
 * NINGUNA clave: cualquier cosa que llegue —empezando por `page`/`pageSize`— muere aqui con
 * `validation_error` sin tocar el servicio (R17). El input se parsea aunque no se transporte
 * nada: parsear ES la barrera.
 */
export async function listarPlantillasCompletoAction(
  input: unknown = {},
  deps: PlantillaDeps = {},
): Promise<ListarPlantillasCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R7: antes de tocar el service
    listarPlantillasGastoFijoCompletoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPlantillasCompleto(actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}
