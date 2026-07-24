"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenMensajeroMetaRepository } from "@/lib/repositories/OrdenMensajeroMetaRepository";
import { OrdenMensajeroMetaService } from "@/lib/services/OrdenMensajeroMetaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenMensajeroMetaService } from "@/lib/interfaces/services/IOrdenMensajeroMetaService";
import { marcarLuegoSchema, type MarcarLuegoResult } from "@/lib/types/orden-mensajero-meta";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 115 — Server Action del toggle "gestionar mas tarde" (mutacion interna del mismo
// proyecto: va como Server Action, no como Route API). Patron EXACTO de mis-asignaciones.ts:
// resuelve el actor por sesion, valida en el borde con zod y delega en el service, TODO bajo
// `withErrorHandler`. `unauthenticated` se resuelve en el borde (UNAUTHORIZED); `forbidden`/
// `not_found` los devuelve el service como resultado de dominio (nunca como excepcion).

// Traduce el AppErrorShape que puede producir este borde: solo ZodError (VALIDATION_ERROR) o
// falta de sesion (UNAUTHORIZED). `forbidden`/`not_found` los devuelve el service directamente,
// por eso NO aparecen aqui. Espejo de `toMisAsignacionesActionError`.
function toMarcarLuegoActionError(
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
      // Este borde nunca lanza FORBIDDEN/NOT_FOUND como AppError; si algo desconocido llega
      // aqui, se propaga como fallo real.
      throw new Error(`orden-mensajero-meta: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IOrdenMensajeroMetaService {
  const prisma = getPrismaClient();
  return new OrdenMensajeroMetaService(
    new OrdenMensajeroMetaRepository(prisma),
    new OrdenRepository(prisma),
  );
}

export interface OrdenMensajeroMetaDeps {
  service?: IOrdenMensajeroMetaService;
  getActor?: () => Promise<Actor | null>;
}

/** R5/R6/R9/R10/R11/R13/R14: marca/desmarca una orden del actor como "gestionar mas tarde". */
export async function marcarGestionarLuego(
  input: unknown,
  deps: OrdenMensajeroMetaDeps = {},
): Promise<MarcarLuegoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R10: antes de tocar el service
    const data = marcarLuegoSchema.parse(input); // R9: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.marcarGestionarLuego(data, actor);
  });
  return isAppErrorShape(r) ? toMarcarLuegoActionError(r) : r;
}
