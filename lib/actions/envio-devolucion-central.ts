"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { EnvioDevolucionCentralService } from "@/lib/services/EnvioDevolucionCentralService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IEnvioDevolucionCentralService,
  EnviarACentralResult,
} from "@/lib/interfaces/services/IEnvioDevolucionCentralService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 139 — Server Action del ENVIO satelite -> bodega CENTRAL (mutacion interna del mismo
// proyecto -> Server Action, no Route API; espejo de `lib/actions/devolucion-origen.ts`). Resuelve
// el actor por sesion, valida en el borde con zod y delega en el servicio, TODO bajo
// `withErrorHandler`: un error EXCEPCIONAL (caida de DB) se normaliza a AppErrorShape en vez de
// propagarse crudo. `unauthenticated` (sin sesion) y `validation_error` (ordenId no-uuid) se
// resuelven en el borde; el resto (ok/forbidden/not_found/conflict/config_error) los devuelve el
// service como resultado de dominio. La UI lo invoca en loop sobre la seleccion (por lote).

// El input del cliente es el `orden.id` (uuid). Un valor no-uuid -> ZodError -> validation_error
// ANTES del service, sin tocar datos.
const enviarACentralSchema = z.object({
  ordenId: z.string().uuid(),
});

// Resultado expuesto por la Server Action: el resultado de dominio del service + los dos estados
// del borde (validation_error de zod, unauthenticated sin sesion).
export type EnviarACentralActionResult =
  | EnviarACentralResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export interface EnvioDevolucionCentralDeps {
  service?: IEnvioDevolucionCentralService;
  getActor?: () => Promise<Actor | null>;
}

function buildService(): IEnvioDevolucionCentralService {
  return new EnvioDevolucionCentralService(new OrdenRepository(getPrismaClient()));
}

// Traduce el AppErrorShape que puede producir este borde: solo ZodError (VALIDATION_ERROR) o falta
// de sesion (UNAUTHORIZED). El resto de estados los devuelve el service como resultado de dominio.
// Espejo de toDevolucionOrigenActionError.
function toEnvioDevolucionCentralActionError(
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
      throw new Error(`envio-devolucion-central: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * R13/R14: el adminSatelite de la zona ejecuta "Enviar a central" sobre una orden `por_devolver`
 * (transicion a `devolviendo_a_bodega_central`). `unauthenticated` (sin sesion) y `validation_error`
 * (ordenId no-uuid) se resuelven en el borde; forbidden/not_found/conflict/config_error los devuelve
 * el service. Patron `devolverATienda`.
 */
export async function enviarACentral(
  input: unknown,
  deps: EnvioDevolucionCentralDeps = {},
): Promise<EnviarACentralActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = enviarACentralSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.enviarACentral(data.ordenId, actor);
  });
  return isAppErrorShape(r) ? toEnvioDevolucionCentralActionError(r) : r;
}
