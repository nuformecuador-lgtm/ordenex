"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IOrdenHistorialService,
  ObtenerHistorialServiceResult,
} from "@/lib/interfaces/services/IOrdenHistorialService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";

// Feature 49 (T4.3, design §4.3) — Server Action de LECTURA del historial (dato interno del
// mismo proyecto -> Server Action, no Route API; patron liberacion-reprogramada). Resuelve
// el actor por sesion y delega en el servicio bajo `withErrorHandler`. `unauthenticated`
// (sin sesion) se resuelve en el borde; `ok`/`forbidden`/`not_found` los devuelve el service
// como resultado de dominio. Los datos van por PROPS al componente (R28): la UI nunca
// fetchea datos sensibles desde el cliente.

export type ObtenerHistorialOrdenResult =
  | ObtenerHistorialServiceResult
  | { status: "unauthenticated" };

export interface ObtenerHistorialOrdenDeps {
  service?: IOrdenHistorialService;
  getActor?: () => Promise<Actor | null>;
}

function buildService(): IOrdenHistorialService {
  const prisma = getPrismaClient();
  return new OrdenHistorialService(
    new OrdenRepository(prisma),
    new OrdenHistorialRepository(prisma),
    // Feature 262 (B26): la SEGUNDA fuente del drawer. Sin este repo la linea de tiempo no
    // tendria las correcciones del dia de reparto (R37) — y por eso el constructor lo EXIGE.
    new OrdenDiaRepartoCambioRepository(prisma),
  );
}

/**
 * R26/R27/R28: linea de tiempo de la orden para el actor autenticado. Sin sesion ->
 * unauthenticated (antes de tocar el service); el service autoriza por visibilidad de la
 * orden y devuelve ok/forbidden/not_found sin filtrar datos.
 */
export async function obtenerHistorialOrden(
  ordenId: string,
  deps: ObtenerHistorialOrdenDeps = {},
): Promise<ObtenerHistorialOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R28: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.obtenerHistorial(ordenId, actor);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}
