"use server";

import { z } from "zod";
import type {
  GeoActionError,
  ListarCantonesResult,
  ListarDistritosResult,
  ListarProvinciasResult,
} from "@/lib/types/zona";
import type { Actor, IGeoService } from "@/lib/interfaces/services/IGeoService";
import { GeoService } from "@/lib/services/GeoService";
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

const idSchema = z.string().min(1);

// Traduce el AppErrorShape del manejador global al GeoActionError tipado (reusa el
// shape ZonaActionError). El catalogo geo solo produce validation_error/
// unauthenticated/forbidden; not_found/conflict quedan cubiertos por el shape.
function toGeoActionError(shape: AppErrorShape): GeoActionError {
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

function buildGeoService(): IGeoService {
  const prisma = getPrismaClient();
  return new GeoService(new GeoRepository(prisma));
}

export interface GeoActionDeps {
  geoService?: IGeoService;
  getActor?: () => Promise<Actor | null>;
}

/** Provincias del catalogo geografico global (solo maestro). */
export async function listarProvincias(
  deps: GeoActionDeps = {},
): Promise<ListarProvinciasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.geoService ?? buildGeoService();
    return service.listarProvincias(actor);
  });
  return isAppErrorShape(r) ? toGeoActionError(r) : r;
}

/** Cantones de una provincia (solo maestro). */
export async function listarCantones(
  provinciaId: unknown,
  deps: GeoActionDeps = {},
): Promise<ListarCantonesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsed = idSchema.safeParse(provinciaId);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { provinciaId: ["provinciaId invalido"] },
      });
    }
    const service = deps.geoService ?? buildGeoService();
    return service.listarCantones(parsed.data, actor);
  });
  return isAppErrorShape(r) ? toGeoActionError(r) : r;
}

/** Distritos de un canton, con su zona asignada si la hay (solo maestro). */
export async function listarDistritos(
  cantonId: unknown,
  deps: GeoActionDeps = {},
): Promise<ListarDistritosResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsed = idSchema.safeParse(cantonId);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { cantonId: ["cantonId invalido"] },
      });
    }
    const service = deps.geoService ?? buildGeoService();
    return service.listarDistritos(parsed.data, actor);
  });
  return isAppErrorShape(r) ? toGeoActionError(r) : r;
}
