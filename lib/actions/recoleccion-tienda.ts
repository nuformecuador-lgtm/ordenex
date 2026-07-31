"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RecoleccionTiendaService } from "@/lib/services/RecoleccionTiendaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRecoleccionTiendaService } from "@/lib/interfaces/services/IRecoleccionTiendaService";
import {
  recolectarEnTiendaSchema,
  type RecolectarEnTiendaResult,
} from "@/lib/types/recoleccion-tienda";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 157 — Server Action de la RECOLECCION EN TIENDA (mutacion interna: Server Action, no
// Route API). Resuelve el actor por sesion, valida en el borde con zod y delega en el servicio,
// TODO bajo `withErrorHandler`. Espejo de `lib/actions/recepcion-bodega-central.ts`.

/**
 * Traduce el AppErrorShape que puede producir este borde: solo ZodError (VALIDATION_ERROR,
 * R20) o falta de sesion (UNAUTHORIZED, R29). El resto de estados los devuelve el service como
 * resultado de dominio. Falla fuerte ante un code inesperado (no lo enmascara como un
 * resultado de dominio).
 */
function toRecoleccionTiendaActionError(
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
      throw new Error(`recoleccion-tienda: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IRecoleccionTiendaService {
  return new RecoleccionTiendaService(new OrdenRepository(getPrismaClient()));
}

export interface RecoleccionTiendaDeps {
  service?: IRecoleccionTiendaService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Confirma la recoleccion en la tienda de la orden del `num_guia` escaneado (el QR codifica
 * `/paquete/<numGuia>`): `por_recolectar_en_tienda -> en_ruta_bodega_central`. El rol
 * (`mensajero`), la propiedad de la orden y la guardia de estado los impone el service,
 * server-side.
 */
export async function recolectarEnTiendaPorQr(
  input: unknown,
  deps: RecoleccionTiendaDeps = {},
): Promise<RecolectarEnTiendaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recolectarEnTiendaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.recolectarEnTienda(data.numGuia, actor);
  });
  return isAppErrorShape(r) ? toRecoleccionTiendaActionError(r) : r;
}
