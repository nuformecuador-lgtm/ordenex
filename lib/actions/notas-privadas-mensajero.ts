"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenMensajeroMetaRepository } from "@/lib/repositories/OrdenMensajeroMetaRepository";
import { NotaPrivadaMensajeroService } from "@/lib/services/NotaPrivadaMensajeroService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { INotaPrivadaMensajeroService } from "@/lib/interfaces/services/INotaPrivadaMensajeroService";
import {
  guardarNotaSchema,
  limpiarNotaSchema,
  type GuardarNotaResult,
  type LimpiarNotaResult,
} from "@/lib/types/nota-privada-mensajero";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 116 — Server Actions de la NOTA PRIVADA del mensajero (mutacion interna del mismo
// proyecto: va como Server Action, no como Route API). Patron EXACTO de mis-asignaciones.ts /
// orden-mensajero-meta.ts: resuelve el actor por sesion, valida en el borde con zod y delega en
// el service, TODO bajo `withErrorHandler`. `unauthenticated` se resuelve en el borde
// (UNAUTHORIZED); `forbidden` lo devuelve el service como resultado de dominio (rol != mensajero
// u orden inexistente por la FK), NUNCA como excepcion.

// Traduce el AppErrorShape que puede producir este borde: solo ZodError (VALIDATION_ERROR) o
// falta de sesion (UNAUTHORIZED). `forbidden` lo devuelve el service directamente, por eso NO
// aparece aqui. Espejo de `toMarcarLuegoActionError`.
function toNotaActionError(
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
      throw new Error(`notas-privadas-mensajero: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): INotaPrivadaMensajeroService {
  const prisma = getPrismaClient();
  return new NotaPrivadaMensajeroService(new OrdenMensajeroMetaRepository(prisma));
}

export interface NotasPrivadasMensajeroDeps {
  service?: INotaPrivadaMensajeroService;
  getActor?: () => Promise<Actor | null>;
}

/** R1/R2/R3/R5/R10/R13/R16: crea o edita la nota privada del actor para una orden. */
export async function guardarNotaPrivada(
  input: unknown,
  deps: NotasPrivadasMensajeroDeps = {},
): Promise<GuardarNotaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R10: antes de tocar el service
    const data = guardarNotaSchema.parse(input); // R13: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.guardar(data.ordenId, data.nota, actor);
  });
  return isAppErrorShape(r) ? toNotaActionError(r) : r;
}

/** R4/R10/R13: deja la nota privada del actor en NULL (sin borrar la fila; idempotente). */
export async function limpiarNotaPrivada(
  input: unknown,
  deps: NotasPrivadasMensajeroDeps = {},
): Promise<LimpiarNotaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R10
    const data = limpiarNotaSchema.parse(input); // R13: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.limpiar(data.ordenId, actor);
  });
  return isAppErrorShape(r) ? toNotaActionError(r) : r;
}
