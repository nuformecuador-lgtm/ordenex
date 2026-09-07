"use server";

import { z } from "zod";
import {
  actualizarZonaSchema,
  crearZonaSchema,
  listarZonasSchema,
  type ActualizarZonaResult,
  type BorrarZonaResult,
  type CrearZonaResult,
  type ImpactoZonaCentralResult,
  type ListarZonasResult,
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
/**
 * FICHA 376 (Q4): el borde de `impactoZonaCentral`. Tope de 20 ids —la pantalla pregunta por dos:
 * la que pierde la marca y la que la gana— para que un payload inventado no se convierta en una
 * consulta sobre el catalogo entero.
 */
const idsSchema = z.array(idSchema).max(20);

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
  if (!isAppErrorShape(r)) return r;
  const error = toZonaActionError(r);
  // ⭑ FICHA 376 (R11) — POR QUE `en_uso` ES EL DEFAULT CORRECTO POR ESTA VIA, Y NO UNA SUPOSICION.
  // `toZonaActionError` traduce el `AppErrorShape` del manejador GLOBAL, y por ahi solo puede
  // llegar un `ConflictError` LANZADO —hoy, el `translateEsCentralConflict` de `ZonaRepository`
  // («Ya existe una zona central»), que es una carrera perdida contra el indice unico, no un
  // rechazo de R10—. El rechazo de R10 NO se lanza: viaja tipado como `"es_central"` por el
  // `return` del service y no pasa por aqui.
  return error.status === "conflict" ? { status: "conflict", motivo: "en_uso" } : error;
}

/**
 * ⭑ FICHA 376 (Q4) — cuantas ordenes VIVAS re-tarifaria mover la marca de zona central.
 *
 * Solo lectura y `maestro`-only, como el resto del CRUD de zonas. Existe para que la confirmacion
 * del formulario pueda decir el IMPACTO antes de enviar nada: mover la marca cambia la columna de
 * flete (`resolverFlete`) de todo lo que aun no esta congelado en un cierre, y ese numero no es
 * pequeño. Devuelve una entrada POR ZONA PEDIDA —con cero si no tiene ninguna—: quien lo consuma
 * compone el texto, este borde no lo redacta.
 *
 * @sin-superficie La pantalla que la consume es la T12 de esta MISMA ficha (la confirmacion de `CrearZonaForm`), que va aparte por reparto de trabajo. La anotacion CADUCA SOLA: en cuanto el formulario la importe, `superficie-de-uso.guardia` exige borrarla.
 */
export async function impactoZonaCentral(
  zonaIds: unknown,
  deps: ZonaActionDeps = {},
): Promise<ImpactoZonaCentralResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsed = idsSchema.safeParse(zonaIds);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { zonaIds: ["zonaIds invalido"] },
      });
    }
    const service = deps.zonaService ?? buildZonaService();
    return service.impactoZonaCentral(parsed.data, actor);
  });
  return isAppErrorShape(r) ? toZonaActionError(r) : r;
}

// `arbolZonas` (arbol zona -> canton -> distrito) se borro el 2026-08-07 por decision humana:
// su unico importador fue siempre `configuracion/_components/ZonaForm.tsx`, que dejo de estar
// montado en `19b9cccf` (2026-07-22, «remove zones from cofign>user») y lo borro la tanda 1 de
// este mismo chore. `IZonaService.arbol` / `ZonaRepository.arbol` NO se tocan: siguen probados y
// son la lectura que habria que recablear si la pantalla vuelve.
