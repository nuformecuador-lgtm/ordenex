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
  quienesDelLibroCajaSchema,
  type CierresDeLaCuentaResult,
  type ConceptosConMovimientosResult,
  type QuienesDelLibroCajaResult,
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
 * La consumen `WalletFiltros`, `MiWalletFiltros` y `DesgloseMovimientosTienda`
 * (`useConceptosConMovimientos`).
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
 * La consume el `SelectorBuscable` de `DesgloseMovimientosTienda` y `DesglosePagosMensajero`
 * (`useCierresDeLaCuenta`).
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

/**
 * Ficha 458-E (TE.2, R59; design §6) — las opciones del selector «A quién» de `/wallet`: las tiendas,
 * los mensajeros y los nombres libres con movimientos en la caja en el periodo (y la direccion)
 * pedidos, buscables por nombre, con tope de configuracion y `hayMas`. Cada opcion trae en `valor` el
 * `aQuien` que se manda de vuelta al libro (`listarMovimientosAction`, `verResumenCajaAction`,
 * `verDesgloseEgresosAction`, la descarga y el detalle de la composicion). Solo acceso total.
 *
 * @sin-superficie FICHA 458-E (TE.2, R59): la parte servidor del filtro «A quién» se entrega ANTES que su control; el `SelectorBuscable` de `WalletFiltros` es de frontend_dev (pendiente en `progress/impl_458-E.md`) y esta anotacion se borra al cablearlo.
 */
export async function quienesDelLibroCajaAction(
  input: unknown,
  deps: FiltrosWalletDeps = {},
): Promise<QuienesDelLibroCajaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = quienesDelLibroCajaSchema.parse(input ?? {});
    return (deps.service ?? buildService()).quienesDelLibroCaja(data, actor);
  });
  return isAppErrorShape(r) ? toError(r) : r;
}
