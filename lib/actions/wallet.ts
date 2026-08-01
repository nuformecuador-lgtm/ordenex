"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletService } from "@/lib/services/WalletService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletService,
  ListarMovimientosServiceResult,
  RegistrarMovimientoManualServiceResult,
  VerBalanceServiceResult,
} from "@/lib/interfaces/services/IWalletService";
import {
  listarMovimientosCompletoSchema,
  listarMovimientosSchema,
  registrarMovimientoManualSchema,
  type ListarMovimientosCompletoResult,
} from "@/lib/types/wallet";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 42 (T10) — Server Actions de la wallet (mutaciones/lecturas internas del mismo
// proyecto -> Server Action, no Route API, patron cierres-admin). Resuelve el actor por
// sesion, valida en el borde con zod y delega en el servicio bajo `withErrorHandler`.
// `unauthenticated` (sin sesion) y `validation_error` (ZodError) se resuelven en el borde;
// `forbidden`/`ok` los devuelve el service como resultado de dominio. Money-safe: los DTOs
// exponen montos como STRING (R21/R25); el cliente nunca recibe Prisma.Decimal.

export type ListarMovimientosActionResult =
  | ListarMovimientosServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type VerBalanceActionResult =
  | VerBalanceServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type RegistrarMovimientoManualActionResult =
  | RegistrarMovimientoManualServiceResult
  | { status: "unauthenticated" };

// Traduce el AppErrorShape del borde: ZodError (VALIDATION_ERROR) o falta de sesion
// (UNAUTHORIZED). Espejo de `toCierresAdminActionError`.
function toWalletActionError(
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
      throw new Error(`wallet: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IWalletService {
  const prisma = getPrismaClient();
  const repo = new WalletMovimientoRepository(prisma);
  return new WalletService(repo, prisma);
}

export interface WalletDeps {
  service?: IWalletService;
  getActor?: () => Promise<Actor | null>;
}

/** R19/R20/R25: lista el libro (solo maestro). Forbidden/unauthenticated sin exponer datos. */
export async function listarMovimientosAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<ListarMovimientosActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R19: antes de tocar el service
    const data = listarMovimientosSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMovimientos(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Feature 170 (T C.2, design §4) — libro de caja COMPLETO, sin paginacion, para la descarga.
 * Calcado de `listarMovimientosAction`: mismo borde, mismo actor, mismo schema (menos
 * `page`/`pageSize`, y `.strict()`) y el MISMO servicio, que es quien autoriza y aplica el
 * tope. Ninguna rama devuelve filas junto a un error (R16/R17/R18).
 */
export async function listarMovimientosCompletoAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<ListarMovimientosCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = listarMovimientosCompletoSchema.parse(input ?? {}); // R18: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMovimientosCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/** R16/R19/R25: balance derivado (STRING+signo) del conjunto filtrado (solo maestro). */
export async function verBalanceAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<VerBalanceActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarMovimientosSchema.parse(input); // mismos filtros que el listado
    const service = deps.service ?? buildService();
    return service.verBalance(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/** R15/R19: registra un movimiento manual de ajuste (solo maestro; monto>0, descripcion obligatoria). */
export async function registrarMovimientoManualAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<RegistrarMovimientoManualActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = registrarMovimientoManualSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.registrarMovimientoManual(data, actor);
  });
  // El service ya devuelve validation_error de dominio si aplica; el borde solo traduce
  // ZodError/UNAUTHORIZED.
  if (isAppErrorShape(r)) {
    const t = toWalletActionError(r);
    if (t.status === "unauthenticated") return t;
    return { status: "validation_error", fieldErrors: t.fieldErrors };
  }
  return r;
}
