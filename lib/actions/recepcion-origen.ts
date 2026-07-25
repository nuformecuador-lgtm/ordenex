"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RecepcionOrigenService } from "@/lib/services/RecepcionOrigenService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRecepcionOrigenService } from "@/lib/interfaces/services/IRecepcionOrigenService";
import {
  recibirEnOrigenSchema,
  type RecibirEnOrigenResult,
} from "@/lib/types/recepcion-origen";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Server Action de la recepcion en la tienda de ORIGEN (mutacion interna: Server
// Action, no Route API). Resuelve el actor por sesion, valida en el borde con zod y
// delega en el servicio, TODO bajo `withErrorHandler`: un error EXCEPCIONAL (caida
// de DB) se normaliza a AppErrorShape en vez de propagarse crudo. Espejo de
// `lib/actions/recepcion-satelite.ts`.

/**
 * Traduce el AppErrorShape que puede producir este borde: solo ZodError
 * (VALIDATION_ERROR) o falta de sesion (UNAUTHORIZED). El resto de estados los
 * devuelve el service como resultado de dominio. Falla fuerte ante un code
 * inesperado (no lo enmascara como un resultado de dominio).
 */
function toRecepcionOrigenActionError(
  shape: AppErrorShape,
):
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors:
          (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`recepcion-origen: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IRecepcionOrigenService {
  return new RecepcionOrigenService(new OrdenRepository(getPrismaClient()));
}

export interface RecepcionOrigenDeps {
  service?: IRecepcionOrigenService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Recibe en la tienda de origen la orden del `num_guia` escaneado (el QR codifica
 * `/paquete/<numGuia>`): `devolviendo_a_tienda` -> `devuelta_a_tienda`. El alcance por
 * tienda y la guardia de estado los impone el service, server-side.
 */
export async function recibirEnOrigenPorQr(
  input: unknown,
  deps: RecepcionOrigenDeps = {},
): Promise<RecibirEnOrigenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recibirEnOrigenSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.recibirEnOrigen(data.numGuia, actor);
  });
  return isAppErrorShape(r) ? toRecepcionOrigenActionError(r) : r;
}
