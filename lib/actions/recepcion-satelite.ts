"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRecepcionSateliteService } from "@/lib/interfaces/services/IRecepcionSateliteService";
import {
  recibirSchema,
  type ListarRecepcionSateliteResult,
  type RecibirResult,
} from "@/lib/types/recepcion-satelite";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 33 — Server Actions de la bodega satelite (mutaciones internas del mismo
// proyecto; van como Server Action, no como Route API, patron feature 36). Resuelve
// el actor por sesion, valida en el borde con zod y delega en el servicio, TODO
// bajo `withErrorHandler` (patron mis-asignaciones.ts): un error EXCEPCIONAL
// (caida de DB) se normaliza a AppErrorShape en vez de propagarse crudo.
// `unauthenticated` se resuelve en el borde (UNAUTHORIZED); el resto
// (forbidden/sin_zona/zona_ajena/estado_invalido/ya_recibida/no_encontrada/
// conflict/validation_error) los devuelve el service como resultado de dominio.

// Traduce el AppErrorShape que puede producir este borde: solo ZodError
// (VALIDATION_ERROR, R16) o falta de sesion (UNAUTHORIZED, R3). El resto de estados
// los devuelve el service directamente como resultado de dominio. Espejo de
// `toMisAsignacionesActionError`.
function toRecepcionSateliteActionError(
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
      throw new Error(`recepcion-satelite: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IRecepcionSateliteService {
  const prisma = getPrismaClient();
  return new RecepcionSateliteService(new OrdenRepository(prisma));
}

export interface RecepcionSateliteDeps {
  service?: IRecepcionSateliteService;
  getActor?: () => Promise<Actor | null>;
}

/** R3/R4/R5/R6/R8: lista "Por recibir" / "Recibidas" de la zona del adminSatelite. */
export async function listarRecepcionSatelite(
  deps: RecepcionSateliteDeps = {},
): Promise<ListarRecepcionSateliteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.listar(actor);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R3/R10/R16/R17: recibe una orden por el `orden.id` escaneado (texto del QR). */
export async function recibirPorQr(
  input: unknown,
  deps: RecepcionSateliteDeps = {},
): Promise<RecibirResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recibirSchema.parse(input); // R16: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.recibir(data.ordenId, actor);
  });
  return isAppErrorShape(r) ? toRecepcionSateliteActionError(r) : r;
}
