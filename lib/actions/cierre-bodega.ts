"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { CierreBodegaRepository } from "@/lib/repositories/CierreBodegaRepository";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CierreBodegaService } from "@/lib/services/CierreBodegaService";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { gestionConfig } from "@/lib/config/gestion";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierreBodegaService } from "@/lib/interfaces/services/ICierreBodegaService";
import type { ICierresBodegaAdminService } from "@/lib/interfaces/services/ICierresBodegaAdminService";
import {
  cierreBodegaIdSchema,
  aprobarCierreBodegaSchema,
  rechazarCierreBodegaSchema,
  listarCierresBodegaPaginadoSchema,
  type ListarConsolidacionResult,
  type SolicitarCierreBodegaResult,
  type ListarCierresBodegaAdminResult,
  type ListarCierresBodegaSolicitadosResult,
  type ListarHistoricoCierresBodegaResult,
  type VerCierreBodegaDetalleResult,
  type AprobarCierreBodegaResult,
  type RechazarCierreBodegaResult,
} from "@/lib/types/cierre-bodega";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 40 — Server Actions del "Cierre de bodega" (mutaciones internas del mismo
// proyecto; van como Server Action, no como Route API, patron feature 37/38). Resuelve
// el actor por sesion, valida en el borde con zod (mutaciones/ver-detalle) y delega en
// el servicio, TODO bajo `withErrorHandler`: un error EXCEPCIONAL (caida de DB, fallo
// de storage al firmar) se normaliza a AppErrorShape. `unauthenticated` (UNAUTHORIZED)
// y `validation_error` (ZodError) se resuelven en el borde; el resto
// (forbidden/no_encontrada/conflict) los devuelve el service como resultado de dominio.

// Traduce el AppErrorShape que puede producir este borde: ZodError (VALIDATION_ERROR,
// R17) o falta de sesion (UNAUTHORIZED, R1/R2). Espejo de toCierresAdminActionError.
function toCierreBodegaActionError(
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
      throw new Error(`cierre-bodega: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildCierreBodegaService(): ICierreBodegaService {
  const prisma = getPrismaClient();
  return new CierreBodegaService(new CierreBodegaRepository(prisma), new OrdenRepository(prisma));
}

function buildCierresBodegaAdminService(): ICierresBodegaAdminService {
  const prisma = getPrismaClient();
  return new CierresBodegaAdminService(
    new CierresBodegaAdminRepository(prisma),
    // Evidencias: mismo bucket privado de gestion_orden (feature 36).
    new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET),
  );
}

export interface CierreBodegaDeps {
  cierreBodegaService?: ICierreBodegaService; // lado adminSatelite (consolidar/solicitar)
  cierresBodegaAdminService?: ICierresBodegaAdminService; // lado maestro (aprobar/rechazar)
  getActor?: () => Promise<Actor | null>;
}

/** R1/R3-R7: consolidacion + totales + gate + historico; solo adminSatelite (via service). */
export async function listarConsolidacion(
  deps: CierreBodegaDeps = {},
): Promise<ListarConsolidacionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const service = deps.cierreBodegaService ?? buildCierreBodegaService();
    return service.listarConsolidacion(actor);
  });
  // Sin zod en este borde: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R1/R4/R6-R10: crea la solicitud de cierre de bodega; solo adminSatelite (via service). */
export async function solicitarCierreBodega(
  deps: CierreBodegaDeps = {},
): Promise<SolicitarCierreBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.cierreBodegaService ?? buildCierreBodegaService();
    return service.solicitarCierreBodega(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R2/R15: cola + historico de cierres de bodega; solo maestro (via service). */
export async function listarCierresBodegaAdmin(
  deps: CierreBodegaDeps = {},
): Promise<ListarCierresBodegaAdminResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.cierresBodegaAdminService ?? buildCierresBodegaAdminService();
    return service.listarCierresBodegaAdmin(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41/R44): UNA pagina de los cierres de bodega SOLICITADOS
 * por la zona del adminSatelite + el total. La zona NO viaja en el input: la resuelve el
 * servicio desde el actor de la sesion.
 */
export async function listarCierresBodegaSolicitadosPaginado(
  input: unknown,
  deps: CierreBodegaDeps = {},
): Promise<ListarCierresBodegaSolicitadosResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarCierresBodegaPaginadoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.cierreBodegaService ?? buildCierreBodegaService();
    return service.listarCierresBodegaSolicitadosPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toCierreBodegaActionError(r) : r;
}

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41/R44): UNA pagina del HISTORICO de cierres de bodega
 * (los ya resueltos) + el total. Solo acceso total, y lo decide el servicio.
 */
export async function listarHistoricoCierresBodegaPaginado(
  input: unknown,
  deps: CierreBodegaDeps = {},
): Promise<ListarHistoricoCierresBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarCierresBodegaPaginadoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.cierresBodegaAdminService ?? buildCierresBodegaAdminService();
    return service.listarHistoricoCierresBodegaPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toCierreBodegaActionError(r) : r;
}

/** R2/R11-R13/R19: detalle agregado con evidencias firmadas; solo maestro (via service). */
export async function verCierreBodegaDetalle(
  input: unknown,
  deps: CierreBodegaDeps = {},
): Promise<VerCierreBodegaDetalleResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = cierreBodegaIdSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.cierresBodegaAdminService ?? buildCierresBodegaAdminService();
    return service.verCierreBodegaDetalle(data.cierreBodegaId, actor);
  });
  return isAppErrorShape(r) ? toCierreBodegaActionError(r) : r;
}

/** R2/R16/R18-R20: aprueba un cierre de bodega `solicitado`; solo maestro (via service). */
export async function aprobarCierreBodega(
  input: unknown,
  deps: CierreBodegaDeps = {},
): Promise<AprobarCierreBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = aprobarCierreBodegaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.cierresBodegaAdminService ?? buildCierresBodegaAdminService();
    return service.aprobarCierreBodega(data.cierreBodegaId, actor);
  });
  return isAppErrorShape(r) ? toCierreBodegaActionError(r) : r;
}

/** R2/R17-R20: rechaza un cierre de bodega `solicitado` con motivo obligatorio; solo maestro. */
export async function rechazarCierreBodega(
  input: unknown,
  deps: CierreBodegaDeps = {},
): Promise<RechazarCierreBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = rechazarCierreBodegaSchema.parse(input); // R17: ZodError -> VALIDATION_ERROR
    const service = deps.cierresBodegaAdminService ?? buildCierresBodegaAdminService();
    return service.rechazarCierreBodega(data.cierreBodegaId, data.motivo, actor);
  });
  return isAppErrorShape(r) ? toCierreBodegaActionError(r) : r;
}
