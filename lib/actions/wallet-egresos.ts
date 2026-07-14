"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletEgresoService,
  RegistrarEgresoServiceResult,
  ReversarEgresoServiceResult,
  VerDesgloseEgresosServiceResult,
} from "@/lib/interfaces/services/IWalletEgresoService";
import {
  listarMovimientosSchema,
  registrarEgresoAdministrativoSchema,
  reversarEgresoSchema,
} from "@/lib/types/wallet";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 45 (T5) — Server Actions de EGRESOS administrativos (mutaciones/lecturas internas
// del mismo proyecto -> Server Action, no Route API, patron lib/actions/wallet.ts). Resuelve
// el actor por sesion, valida en el borde con zod y delega en el servicio bajo
// `withErrorHandler`. `unauthenticated` (sin sesion, R18) y `validation_error` (ZodError,
// R4/R5/R19) se resuelven en el borde; `forbidden`/`ok`/`not_found`/`already_reversed` los
// devuelve el service como resultado de dominio. Money-safe: DTOs con montos STRING (R12).

export type RegistrarEgresoActionResult =
  | RegistrarEgresoServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type ReversarEgresoActionResult =
  | ReversarEgresoServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type VerDesgloseEgresosActionResult =
  | VerDesgloseEgresosServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

// Traduce el AppErrorShape del borde: ZodError (VALIDATION_ERROR) o falta de sesion
// (UNAUTHORIZED). Espejo de `toWalletActionError`.
function toEgresoActionError(
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
      throw new Error(`wallet-egresos: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IWalletEgresoService {
  const prisma = getPrismaClient();
  const repo = new WalletMovimientoRepository(prisma);
  return new WalletEgresoService(repo, prisma);
}

export interface WalletEgresoDeps {
  service?: IWalletEgresoService;
  getActor?: () => Promise<Actor | null>;
}

/** R1/R2/R17/R18/R19: registra un egreso administrativo manual (gasto variable o sueldo). */
export async function registrarEgresoAdministrativoAction(
  input: unknown,
  deps: WalletEgresoDeps = {},
): Promise<RegistrarEgresoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18: antes de tocar el service
    const data = registrarEgresoAdministrativoSchema.parse(input); // ZodError -> VALIDATION_ERROR (R4/R5/R19)
    const service = deps.service ?? buildService();
    return service.registrarEgreso(data, actor);
  });
  return isAppErrorShape(r) ? toEgresoActionError(r) : r;
}

/** R13/R15/R16/R17/R18/R32: reversa un egreso administrativo (manual o del cron) por su id. */
export async function reversarEgresoAdministrativoAction(
  input: unknown,
  deps: WalletEgresoDeps = {},
): Promise<ReversarEgresoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = reversarEgresoSchema.parse(input); // ZodError -> VALIDATION_ERROR (R13)
    const service = deps.service ?? buildService();
    return service.reversarEgreso(data, actor);
  });
  return isAppErrorShape(r) ? toEgresoActionError(r) : r;
}

/** R11/R17/R18: desglose de egresos administrativos por tipo del conjunto filtrado (solo maestro). */
export async function verDesgloseEgresosAction(
  input: unknown,
  deps: WalletEgresoDeps = {},
): Promise<VerDesgloseEgresosActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarMovimientosSchema.parse(input); // mismos filtros que el libro
    const service = deps.service ?? buildService();
    return service.verDesgloseEgresos(data, actor);
  });
  return isAppErrorShape(r) ? toEgresoActionError(r) : r;
}
