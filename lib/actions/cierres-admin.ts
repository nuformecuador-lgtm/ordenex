"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { TarifaVigentePorZonaRepository } from "@/lib/repositories/TarifaVigentePorZonaRepository";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { gestionConfig } from "@/lib/config/gestion";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierresAdminService } from "@/lib/interfaces/services/ICierresAdminService";
import {
  cierreIdSchema,
  aprobarCierreSchema,
  rechazarCierreSchema,
  type ListarCierresAdminResult,
  type VerCierreDetalleResult,
  type AprobarCierreResult,
  type RechazarCierreResult,
} from "@/lib/types/cierres-admin";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 38 — Server Actions de "Cierres del dia" del admin (lecturas + mutaciones
// internas del mismo proyecto; van como Server Action, no como Route API, patron
// feature 37). Resuelve el actor por sesion, valida en el borde con zod (mutaciones)
// y delega en el servicio, TODO bajo `withErrorHandler`: un error EXCEPCIONAL (caida
// de DB, fallo de storage al firmar) se normaliza a AppErrorShape. `unauthenticated`
// (UNAUTHORIZED) y `validation_error` (ZodError) se resuelven en el borde; el resto
// (forbidden/no_encontrada/conflict) los devuelve el service como resultado de dominio.

// Traduce el AppErrorShape que puede producir este borde: ZodError
// (VALIDATION_ERROR, R11) o falta de sesion (UNAUTHORIZED, R1). Espejo de
// `toRecepcionSateliteActionError`.
function toCierresAdminActionError(
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
      throw new Error(`cierres-admin: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): ICierresAdminService {
  const prisma = getPrismaClient();
  return new CierresAdminService(
    // Feature 42/T8: el repo de cierres alimenta la wallet al aprobar (R5/R7), por
    // inyeccion del repo de movimientos + el feed que resuelve tarifas por zona.
    new CierresAdminRepository(
      prisma,
      new WalletMovimientoRepository(prisma),
      new WalletFeedService(new TarifaVigentePorZonaRepository(prisma)),
      // Feature 43/T10: alimenta el LEDGER por tienda al aprobar (misma tx que la 42). El
      // feed reutiliza el mismo resolver de tarifas por zona y lee el interruptor Q3 del
      // singleton walletTiendaConfig (default true).
      new WalletTiendaMovimientoRepository(prisma),
      new WalletTiendaFeedService(new TarifaVigentePorZonaRepository(prisma)),
    ),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
    // Evidencias: mismo bucket privado de gestion_orden (feature 36).
    new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET),
  );
}

export interface CierresAdminDeps {
  service?: ICierresAdminService;
  getActor?: () => Promise<Actor | null>;
}

/** R1-R5/R8/R9: pendientes + historico del alcance del admin; solo maestro/adminSatelite. */
export async function listarCierresAdmin(
  deps: CierresAdminDeps = {},
): Promise<ListarCierresAdminResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.listarCierresAdmin(actor);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R6-R9/R13: detalle de un cierre del alcance con evidencias firmadas. */
export async function verCierreDetalle(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<VerCierreDetalleResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = cierreIdSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.verCierreDetalle(data.cierreId, actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/** R10/R12-R14: aprueba un cierre `solicitado` del alcance. */
export async function aprobarCierre(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<AprobarCierreResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = aprobarCierreSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.aprobarCierre(data.cierreId, actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/** R11-R14: rechaza un cierre `solicitado` del alcance con motivo obligatorio. */
export async function rechazarCierre(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<RechazarCierreResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = rechazarCierreSchema.parse(input); // R11: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.rechazarCierre(data.cierreId, data.motivo, actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}
