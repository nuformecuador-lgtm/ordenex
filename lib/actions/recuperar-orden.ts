"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RecuperarOrdenService } from "@/lib/services/RecuperarOrdenService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRecuperarOrdenService,
  RecuperarOrdenServiceResult,
} from "@/lib/interfaces/services/IRecuperarOrdenService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Pedido humano (2026-08-27) — Server Action de la REVERSION del borrado logico. Calcada de
// `lib/actions/eliminar-orden.ts`, que a su vez calca `deshacer-asignacion`: `withErrorHandler`
// + `resolveActorFromSession` + zod en el borde + fabrica del service. Sin PII en logs.

const recuperarSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
});

// Estados del BORDE (los de dominio los devuelve el service).
type BorderError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type RecuperarOrdenActionResult = RecuperarOrdenServiceResult | BorderError;

export interface RecuperarOrdenDeps {
  service?: IRecuperarOrdenService;
  getActor?: () => Promise<Actor | null>;
}

function buildService(): IRecuperarOrdenService {
  return new RecuperarOrdenService(new OrdenRepository(getPrismaClient()));
}

/** Espejo de `toEliminarActionError`: solo los dos codigos que este borde puede producir. */
function toRecuperarActionError(shape: AppErrorShape): BorderError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`recuperar-orden: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Recupera (devuelve `deleted_at` a NULL) el lote de ordenes borradas indicado. `unauthenticated`
 * y `validation_error` se resuelven en el BORDE, sin construir el service ni tocar dato alguno;
 * `forbidden` y `conflict` los devuelve el service.
 */
export async function recuperarOrdenes(
  input: unknown,
  deps: RecuperarOrdenDeps = {},
): Promise<RecuperarOrdenActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recuperarSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.recuperar({ ordenIds: data.ordenIds }, actor);
  });
  return isAppErrorShape(r) ? toRecuperarActionError(r) : r;
}
