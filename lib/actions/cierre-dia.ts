"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { gestionConfig } from "@/lib/config/gestion";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierreDiaService } from "@/lib/interfaces/services/ICierreDiaService";
import type { ListarCierreDiaResult, SolicitarCierreResult } from "@/lib/types/cierre";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";

// Feature 37 — Server Actions del "Cierre del dia" del mensajero (mutaciones y
// lecturas internas del mismo proyecto; van como Server Action, no como Route API,
// patron feature 36). Resuelve el actor por sesion y delega en el servicio, TODO
// bajo `withErrorHandler`: un error EXCEPCIONAL (caida de DB, fallo de storage al
// firmar) se normaliza a AppErrorShape en vez de propagarse crudo. `unauthenticated`
// se resuelve en el borde (UNAUTHORIZED); el resto (forbidden/conflict/
// validation_error) los devuelve el service como resultado de dominio. Sin input de
// negocio ni zod: el unico AppErrorShape posible en este borde es UNAUTHORIZED.

function buildService(): ICierreDiaService {
  const prisma = getPrismaClient();
  return new CierreDiaService(
    new CierreDiaRepository(prisma),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
    // Las evidencias son las de gestion_orden (feature 36): mismo bucket privado.
    new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET),
  );
}

export interface CierreDiaDeps {
  service?: ICierreDiaService;
  getActor?: () => Promise<Actor | null>;
}

/** R1-R11/R17/R18: detalle del dia + totales + gate + historico; solo `mensajero`. */
export async function listarCierreDia(
  deps: CierreDiaDeps = {},
): Promise<ListarCierreDiaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.listarCierreDia(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R10-R16: crea la solicitud de cierre del dia del mensajero. */
export async function solicitarCierre(
  deps: CierreDiaDeps = {},
): Promise<SolicitarCierreResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.solicitarCierre(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}
