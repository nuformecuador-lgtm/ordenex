"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletMensajeroService } from "@/lib/services/WalletMensajeroService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletMensajeroService,
  ListarCuentasPorPagarServiceResult,
  ListarMisPagosServiceResult,
  ListarPagosDeMensajeroServiceResult,
  VerMiCuentaPorPagarServiceResult,
} from "@/lib/interfaces/services/IWalletMensajeroService";
import {
  listarMisPagosCompletoSchema,
  listarPagosDeMensajeroCompletoSchema,
  listarPagosDeMensajeroSchema,
  listarPagosMensajeroSchema,
  type ListarMisPagosCompletoResult,
  type ListarPagosDeMensajeroCompletoResult,
} from "@/lib/types/wallet-mensajero";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 44 (T13) — Server Actions del LIBRO del pago por mensajero (lecturas internas del
// mismo proyecto -> Server Action, no Route API, patron wallet-tienda.ts). Resuelve el actor por
// sesion, valida en el borde con zod y delega en el servicio bajo `withErrorHandler`.
// `unauthenticated` (sin sesion) y `validation_error` (ZodError) se resuelven en el borde;
// `forbidden`/`ok` los devuelve el service como resultado de dominio. Money-safe: los DTOs
// exponen montos como STRING (R21/R27); el cliente nunca recibe Prisma.Decimal.

export type VerMiCuentaPorPagarActionResult =
  | VerMiCuentaPorPagarServiceResult
  | { status: "unauthenticated" };

export type ListarMisPagosActionResult =
  | ListarMisPagosServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type ListarCuentasPorPagarActionResult =
  | ListarCuentasPorPagarServiceResult
  | { status: "unauthenticated" };

export type ListarPagosDeMensajeroActionResult =
  | ListarPagosDeMensajeroServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

// Traduce el AppErrorShape del borde: ZodError (VALIDATION_ERROR) o falta de sesion
// (UNAUTHORIZED). Espejo de `toWalletTiendaActionError`.
function toWalletMensajeroActionError(
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
      throw new Error(`wallet-mensajero: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IWalletMensajeroService {
  const prisma = getPrismaClient();
  return new WalletMensajeroService(new PagoMensajeroMovimientoRepository(prisma));
}

export interface WalletMensajeroDeps {
  service?: IWalletMensajeroService;
  getActor?: () => Promise<Actor | null>;
}

/** R16/R20/R27: cuenta por pagar total del mensajero (STRING+signo), acotada a su mensajero_id. Forbidden/unauthenticated sin exponer datos. */
export async function verMiCuentaPorPagarAction(
  deps: WalletMensajeroDeps = {},
): Promise<VerMiCuentaPorPagarActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R20: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.verMiCuentaPorPagar(actor);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R20/R22/R27: pagos paginados + filtros del mensajero, acotados a su mensajero_id en el WHERE. */
export async function listarMisPagosAction(
  input: unknown,
  deps: WalletMensajeroDeps = {},
): Promise<ListarMisPagosActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarPagosMensajeroSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMisPagos(data, actor);
  });
  return isAppErrorShape(r) ? toWalletMensajeroActionError(r) : r;
}

/**
 * Feature 170 (T C.2, design §4) — pagos PROPIOS del mensajero, sin paginacion, para la
 * descarga. Calcado de `listarMisPagosAction`: mismo borde, mismo actor, mismo schema
 * (menos `page`/`pageSize`, y `.strict()`) y el MISMO servicio, que acota a su
 * `mensajero_id` e ignora el `mensajeroId` del input (R14/R15). Ninguna rama devuelve filas
 * junto a un error (R16/R17/R18).
 */
export async function listarMisPagosCompletoAction(
  input: unknown,
  deps: WalletMensajeroDeps = {},
): Promise<ListarMisPagosCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = listarMisPagosCompletoSchema.parse(input ?? {}); // R18: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMisPagosCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletMensajeroActionError(r) : r;
}

/** R18/R19/R27: cuentas por pagar de TODOS los mensajeros (solo maestro). Forbidden/unauthenticated sin exponer datos. */
export async function listarCuentasPorPagarAction(
  deps: WalletMensajeroDeps = {},
): Promise<ListarCuentasPorPagarActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.service ?? buildService();
    return service.listarCuentasPorPagar(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * R18/R22/R27: DESGLOSE por cierre de UN mensajero (solo maestro), paginado (mas reciente primero)
 * + filtros server-side por fecha/cierre; el saldo refleja el conjunto filtrado. Espejo de
 * `listarMisPagosAction` pero SIN acotar a `actor.usuarioId`: el `mensajeroId` (REQUERIDO por
 * `listarPagosDeMensajeroSchema`) viaja en el input y el service gatea a maestro. `mensajeroId`
 * faltante/vacio -> validation_error. Montos STRING.
 */
export async function listarPagosDeMensajeroAction(
  input: unknown,
  deps: WalletMensajeroDeps = {},
): Promise<ListarPagosDeMensajeroActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarPagosDeMensajeroSchema.parse(input); // mensajeroId REQUERIDO -> ZodError si falta
    const service = deps.service ?? buildService();
    return service.listarPagosDeMensajero(data, actor);
  });
  return isAppErrorShape(r) ? toWalletMensajeroActionError(r) : r;
}

/**
 * Feature 170 (T C.2, design §4) — DESGLOSE COMPLETO de UN mensajero, sin paginacion, para
 * la descarga. Calcado de `listarPagosDeMensajeroAction`: `mensajeroId` sigue siendo
 * REQUERIDO (ausente -> `validation_error` sin tocar la base) y el guard de acceso total lo
 * pone el service (R17). Ninguna rama devuelve filas junto a un error (R16/R17/R18).
 */
export async function listarPagosDeMensajeroCompletoAction(
  input: unknown,
  deps: WalletMensajeroDeps = {},
): Promise<ListarPagosDeMensajeroCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = listarPagosDeMensajeroCompletoSchema.parse(input); // R18: mensajeroId REQUERIDO
    const service = deps.service ?? buildService();
    return service.listarPagosDeMensajeroCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletMensajeroActionError(r) : r;
}
