"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { DevolucionOrigenService } from "@/lib/services/DevolucionOrigenService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IDevolucionOrigenService,
  DevolverATiendaResult,
} from "@/lib/interfaces/services/IDevolucionOrigenService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 48 — Server Action del RETORNO a la tienda de origen (mutacion interna del
// mismo proyecto -> Server Action, no Route API, patron recepcion-satelite.ts). Resuelve
// el actor por sesion, valida en el borde con zod y delega en el servicio, TODO bajo
// `withErrorHandler`: un error EXCEPCIONAL (caida de DB) se normaliza a AppErrorShape en
// vez de propagarse crudo. `unauthenticated` (sin sesion) y `validation_error` (ordenId
// no-uuid) se resuelven en el borde; el resto (ok/forbidden/not_found/conflict/
// config_error) los devuelve el service como resultado de dominio.

// R4: el input del cliente es el `orden.id` (uuid, ver Orden.id en schema.prisma). Un
// valor que no sea uuid -> ZodError -> validation_error ANTES del service, sin tocar datos.
const devolverATiendaSchema = z.object({
  ordenId: z.string().uuid(),
});

// Resultado expuesto por la Server Action: el resultado de dominio del service + los dos
// estados del borde (validation_error de zod, unauthenticated sin sesion).
export type DevolverATiendaActionResult =
  | DevolverATiendaResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export interface DevolucionOrigenDeps {
  service?: IDevolucionOrigenService;
  getActor?: () => Promise<Actor | null>;
}

function buildService(): IDevolucionOrigenService {
  const prisma = getPrismaClient();
  return new DevolucionOrigenService(new OrdenRepository(prisma), new ZonaRepository(prisma));
}

// Traduce el AppErrorShape que puede producir este borde: solo ZodError
// (VALIDATION_ERROR, R4) o falta de sesion (UNAUTHORIZED, R11). El resto de estados los
// devuelve el service como resultado de dominio. Espejo de toRecepcionSateliteActionError.
function toDevolucionOrigenActionError(
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
      throw new Error(`devolucion-origen: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * R4/R11: la bodega responsable ejecuta "Devolver a la tienda" sobre una orden `rechazada`
 * (transicion a `devuelta_origen`). `unauthenticated` (sin sesion) y `validation_error`
 * (ordenId no-uuid) se resuelven en el borde; forbidden/not_found/conflict/config_error
 * los devuelve el service. Patron `recibirPorQr`.
 */
export async function devolverATienda(
  input: unknown,
  deps: DevolucionOrigenDeps = {},
): Promise<DevolverATiendaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R11: antes de tocar el service
    const data = devolverATiendaSchema.parse(input); // R4: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.devolverATienda(data.ordenId, actor);
  });
  return isAppErrorShape(r) ? toDevolucionOrigenActionError(r) : r;
}
