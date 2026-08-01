"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletTiendaService,
  ListarMisMovimientosServiceResult,
  ListarMovimientosDeTiendaServiceResult,
  ListarSaldosTiendasServiceResult,
  VerMiSaldoServiceResult,
} from "@/lib/interfaces/services/IWalletTiendaService";
import {
  listarMovimientosDeTiendaCompletoSchema,
  listarMovimientosDeTiendaSchema,
  listarMovimientosTiendaCompletoSchema,
  listarMovimientosTiendaSchema,
  type ListarMovimientosDeTiendaCompletoResult,
  type ListarMovimientosTiendaCompletoResult,
} from "@/lib/types/wallet-tienda";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 43 (T13) — Server Actions del ledger POR TIENDA (lecturas internas del mismo
// proyecto -> Server Action, no Route API, patron wallet.ts). Resuelve el actor por sesion,
// valida en el borde con zod y delega en el servicio bajo `withErrorHandler`. `unauthenticated`
// (sin sesion) y `validation_error` (ZodError) se resuelven en el borde; `forbidden`/`ok` los
// devuelve el service como resultado de dominio. Money-safe: los DTOs exponen montos como
// STRING (R21/R27); el cliente nunca recibe Prisma.Decimal.

export type VerMiSaldoActionResult =
  | VerMiSaldoServiceResult
  | { status: "unauthenticated" };

export type ListarMisMovimientosActionResult =
  | ListarMisMovimientosServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type ListarSaldosTiendasActionResult =
  | ListarSaldosTiendasServiceResult
  | { status: "unauthenticated" };

// Feature 171 — desglose de UNA tienda elegida. `forbidden` lo decide el servicio (dominio);
// `unauthenticated` y `validation_error` los decide este borde, antes de llamarlo.
export type ListarMovimientosDeTiendaActionResult =
  | ListarMovimientosDeTiendaServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

// Traduce el AppErrorShape del borde: ZodError (VALIDATION_ERROR) o falta de sesion
// (UNAUTHORIZED). Espejo de `toWalletActionError`.
function toWalletTiendaActionError(
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
      throw new Error(`wallet-tienda: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IWalletTiendaService {
  const prisma = getPrismaClient();
  return new WalletTiendaService(new WalletTiendaMovimientoRepository(prisma));
}

export interface WalletTiendaDeps {
  service?: IWalletTiendaService;
  getActor?: () => Promise<Actor | null>;
}

/** R17/R19: saldo total del adminTienda (STRING+signo), acotado a su tienda_id. Forbidden/unauthenticated sin exponer datos. */
export async function verMiSaldoAction(
  deps: WalletTiendaDeps = {},
): Promise<VerMiSaldoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R19: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.verMiSaldo(actor);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R19/R22/R27: movimientos paginados + filtros del adminTienda, acotados a su tienda_id en el WHERE. */
export async function listarMisMovimientosAction(
  input: unknown,
  deps: WalletTiendaDeps = {},
): Promise<ListarMisMovimientosActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarMovimientosTiendaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMisMovimientos(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/**
 * Feature 170 (T C.2, design §4) — ledger COMPLETO de la tienda del actor, sin paginacion,
 * para la descarga. Calcado de `listarMisMovimientosAction`: mismo borde, mismo actor, mismo
 * schema (menos `page`/`pageSize`, y `.strict()`) y el MISMO servicio, que acota a su
 * `tienda_id` (R14/R15). Ninguna rama devuelve filas junto a un error (R16/R17/R18).
 */
export async function listarMisMovimientosCompletoAction(
  input: unknown,
  deps: WalletTiendaDeps = {},
): Promise<ListarMovimientosTiendaCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = listarMovimientosTiendaCompletoSchema.parse(input ?? {}); // R18: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMisMovimientosCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/** R20/R27: saldo de TODAS las tiendas (solo maestro). Forbidden/unauthenticated sin exponer datos. */
export async function listarSaldosTiendasAction(
  deps: WalletTiendaDeps = {},
): Promise<ListarSaldosTiendasActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.service ?? buildService();
    return service.listarSaldosTiendas(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Feature 171 (T1.5, R22/R25/R29) — desglose de UNA tienda elegida por el acceso total:
 * pagina de movimientos + total del conjunto filtrado + los cuatro importes de la cabecera.
 *
 * Mismo esqueleto que las cuatro de arriba, y el ORDEN importa: sin sesion se corta ANTES de
 * validar y antes de llamar al servicio (R29), y un `tiendaId` ausente o vacio se corta en
 * `schema.parse` (R25) — en ninguno de los dos casos se llega a consultar la base.
 */
export async function listarMovimientosDeTiendaAction(
  input: unknown,
  deps: WalletTiendaDeps = {},
): Promise<ListarMovimientosDeTiendaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R29: antes del schema y del service
    const data = listarMovimientosDeTiendaSchema.parse(input); // R25: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMovimientosDeTienda(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/**
 * Feature 171 (T1.5, R37/R40) — el MISMO desglose sin paginacion, para la descarga. Mismo
 * borde, mismo actor, mismo `tiendaId` requerido y el mismo servicio; el schema `.strict()`
 * rechaza `page`/`pageSize` porque este modo no pagina. Ninguna rama devuelve filas junto a un
 * error.
 */
export async function listarMovimientosDeTiendaCompletoAction(
  input: unknown,
  deps: WalletTiendaDeps = {},
): Promise<ListarMovimientosDeTiendaCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R29: antes de tocar el service
    const data = listarMovimientosDeTiendaCompletoSchema.parse(input); // R25
    const service = deps.service ?? buildService();
    return service.listarMovimientosDeTiendaCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}
