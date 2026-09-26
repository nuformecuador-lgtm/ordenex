"use server";

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { isAppErrorShape, UnauthenticatedError, withErrorHandler } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { IFiltrosWalletService } from "@/lib/interfaces/services/IFiltrosWalletService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { FiltrosWalletRepository } from "@/lib/repositories/FiltrosWalletRepository";
import { FiltrosWalletService } from "@/lib/services/FiltrosWalletService";
import {
  cierresDeLaCuentaSchema,
  conceptosConMovimientosSchema,
  type CierresDeLaCuentaResult,
  type ConceptosConMovimientosResult,
} from "@/lib/types/wallet-filtros";

// Ficha 458-A (TA.3/TA.4, design §3.5, R10–R15) — Server Actions de los FILTROS de la wallet.
// Lecturas internas del mismo proyecto → Server Action. Orden del borde (y es parte del contrato):
// sesion → zod `.strict()` → servicio (que comprueba el rol ANTES de leer). Ninguna rama de error
// viaja con filas.

export interface FiltrosWalletDeps {
  service?: IFiltrosWalletService;
  getActor?: () => Promise<Actor | null>;
}

function buildService(): IFiltrosWalletService {
  return new FiltrosWalletService(new FiltrosWalletRepository(getPrismaClient()));
}

function toError(
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
      throw new Error(`wallet-filtros: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * R13–R15 — los conceptos con movimientos del periodo y la cuenta que se miran, con su numero.
 * `libro`: `caja` (`/wallet`), `tienda` (desglose/estado de cuenta de UNA tienda, con `tiendaId`) o
 * `mi_tienda` (`/mi-wallet`: la tienda sale de la sesion y NO se admite ningun id).
 *
 * @sin-superficie 458-A: el backend llega antes que su pantalla; la consumen WalletFiltros, MiWalletFiltros y DesgloseMovimientosTienda en la parte frontend de la misma hija (TA.3), que debe borrar esta anotacion al cablearla.
 */
export async function conceptosConMovimientosAction(
  input: unknown,
  deps: FiltrosWalletDeps = {},
): Promise<ConceptosConMovimientosResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = conceptosConMovimientosSchema.parse(input);
    return (deps.service ?? buildService()).conceptosConMovimientos(data, actor);
  });
  return isAppErrorShape(r) ? toError(r) : r;
}

/**
 * R10–R12 — los cierres con movimientos en el libro de UNA tienda o de UN mensajero, para el
 * selector con busqueda (por dia `YYYY-MM-DD` o por nombre del mensajero). Solo acceso total.
 *
 * @sin-superficie 458-A: el backend llega antes que su pantalla; la consume el SelectorBuscable de DesgloseMovimientosTienda y DesglosePagosMensajero en la parte frontend de la misma hija (TA.4), que debe borrar esta anotacion al cablearla.
 */
export async function cierresDeLaCuentaAction(
  input: unknown,
  deps: FiltrosWalletDeps = {},
): Promise<CierresDeLaCuentaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = cierresDeLaCuentaSchema.parse(input);
    return (deps.service ?? buildService()).cierresDeLaCuenta(data, actor);
  });
  return isAppErrorShape(r) ? toError(r) : r;
}
