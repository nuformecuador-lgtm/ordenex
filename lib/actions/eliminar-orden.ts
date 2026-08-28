"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { EliminarOrdenService } from "@/lib/services/EliminarOrdenService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  EliminarOrdenServiceResult,
  IEliminarOrdenService,
} from "@/lib/interfaces/services/IEliminarOrdenService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature «eliminar orden» — Server Action del borrado LOGICO por lote. Mutacion interna del
// mismo proyecto => Server Action, nunca ruta API (`docs/architecture.md`). Patron literal de
// `lib/actions/deshacer-asignacion.ts`: `withErrorHandler` + `resolveActorFromSession` + zod en
// el borde + fabrica del service. Sin PII en logs: esta accion no registra destinatario ni
// telefono.

const eliminarSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
});

// Estados del BORDE (los de dominio los devuelve el service).
type BorderError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type EliminarOrdenActionResult = EliminarOrdenServiceResult | BorderError;

export interface EliminarOrdenDeps {
  service?: IEliminarOrdenService;
  getActor?: () => Promise<Actor | null>;
}

function buildService(): IEliminarOrdenService {
  const prisma = getPrismaClient();
  // FICHA 319 (2026-08-28): el service deja de recibir el historial. Se le inyectaba para
  // contar transiciones («esta orden ya fue gestionada»), y ese conteo se retiro: hoy decide el
  // ESTADO, que ya viene en la fila. Se retira tambien del wiring —y no solo del uso— porque una
  // dependencia construida y nunca consultada es un cable suelto que miente sobre la regla.
  return new EliminarOrdenService(new OrdenRepository(prisma));
}

/** Espejo de `toDeshacerActionError`: solo los dos codigos que este borde puede producir. */
function toEliminarActionError(shape: AppErrorShape): BorderError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`eliminar-orden: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Elimina (borrado LOGICO: fija `deleted_at`) el lote de ordenes indicado. `unauthenticated`
 * (sin sesion) y `validation_error` (lote vacio o uuid invalido) se resuelven en el BORDE, sin
 * construir el service ni tocar dato alguno; `forbidden` y `conflict` los devuelve el service.
 */
export async function eliminarOrdenes(
  input: unknown,
  deps: EliminarOrdenDeps = {},
): Promise<EliminarOrdenActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = eliminarSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.eliminar({ ordenIds: data.ordenIds }, actor);
  });
  return isAppErrorShape(r) ? toEliminarActionError(r) : r;
}
