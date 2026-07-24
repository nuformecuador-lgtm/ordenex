"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RecepcionBodegaCentralService } from "@/lib/services/RecepcionBodegaCentralService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRecepcionBodegaCentralService } from "@/lib/interfaces/services/IRecepcionBodegaCentralService";
import {
  recibirEnBodegaCentralSchema,
  type RecibirEnBodegaCentralResult,
} from "@/lib/types/recepcion-bodega-central";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Server Action de la recepcion en la BODEGA CENTRAL (mutacion interna: Server Action, no
// Route API). Resuelve el actor por sesion, valida en el borde con zod y delega en el
// servicio, TODO bajo `withErrorHandler`: un error EXCEPCIONAL (caida de DB) se normaliza a
// AppErrorShape en vez de propagarse crudo. Espejo de `lib/actions/recepcion-origen.ts`.

/**
 * Traduce el AppErrorShape que puede producir este borde: solo ZodError (VALIDATION_ERROR,
 * R10) o falta de sesion (UNAUTHORIZED, R5). El resto de estados los devuelve el service como
 * resultado de dominio. Falla fuerte ante un code inesperado (no lo enmascara como un
 * resultado de dominio).
 */
function toRecepcionBodegaCentralActionError(
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
      throw new Error(`recepcion-bodega-central: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IRecepcionBodegaCentralService {
  return new RecepcionBodegaCentralService(new OrdenRepository(getPrismaClient()));
}

export interface RecepcionBodegaCentralDeps {
  service?: IRecepcionBodegaCentralService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Recibe en la bodega central la orden del `num_guia` escaneado (el QR codifica
 * `/paquete/<numGuia>`): `en_ruta_bodega_central` -> `en_bodega_central`. El rol (maestro/admin)
 * y la guardia de estado los impone el service, server-side; sin acotar por zona ni tienda (R11).
 */
export async function recibirEnBodegaCentralPorQr(
  input: unknown,
  deps: RecepcionBodegaCentralDeps = {},
): Promise<RecibirEnBodegaCentralResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recibirEnBodegaCentralSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.recibirEnBodegaCentral(data.numGuia, actor);
  });
  return isAppErrorShape(r) ? toRecepcionBodegaCentralActionError(r) : r;
}
