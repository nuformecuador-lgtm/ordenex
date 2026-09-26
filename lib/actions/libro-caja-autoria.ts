"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ILibroCajaAutoriaService } from "@/lib/interfaces/services/ILibroCajaAutoriaService";
import { LibroCajaAutoriaRepository } from "@/lib/repositories/LibroCajaAutoriaRepository";
import { LibroCajaAutoriaService } from "@/lib/services/LibroCajaAutoriaService";
import { autoriaLibroCajaSchema, type AutoriaLibroCajaResult } from "@/lib/types/libro-caja-autoria";

// FICHA 458-B (design §3.4, R56/R57) — el borde de «A quien» y «Registro» del libro de la caja.
// Sesion primero, forma despues (`.strict()`, lista de uuids con tope), rol en el servicio.

function toAutoriaActionError(
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
      throw new Error(`libro-caja-autoria: AppErrorCode inesperado ${shape.code}`);
  }
}

export interface LibroCajaAutoriaDeps {
  service?: ILibroCajaAutoriaService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * «A quien» y «Registro» de las filas de una pagina del libro de la caja, por sus ids.
 *
 * @sin-superficie FICHA 458-B (backend por delante del frontend): la llaman las columnas «A quien» y «Registro» del libro de la 458-E (design §5.2). Esta anotacion CADUCA con la 458-E.
 */
export async function autoriaDelLibroCajaAction(
  input: unknown,
  deps: LibroCajaAutoriaDeps = {},
): Promise<AutoriaLibroCajaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = autoriaLibroCajaSchema.parse(input);
    const service = deps.service ?? new LibroCajaAutoriaService(new LibroCajaAutoriaRepository(getPrismaClient()));
    return service.resolver(data, actor);
  });
  return isAppErrorShape(r) ? toAutoriaActionError(r) : r;
}
