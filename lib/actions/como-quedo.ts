"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { IComoQuedoService } from "@/lib/interfaces/services/IComoQuedoService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { ComoQuedoRepository } from "@/lib/repositories/ComoQuedoRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { ComoQuedoService } from "@/lib/services/ComoQuedoService";
import { comoQuedoSchema, type ComoQuedoResult } from "@/lib/types/como-quedo";

// FICHA 458-B (design §3.7, R58, R82) — el borde de «Cómo quedó». Sesion primero, forma despues
// (`.strict()`), rol en el servicio (antes de leer). Solo lectura.

function toComoQuedoActionError(
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
      throw new Error(`como-quedo: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IComoQuedoService {
  const prisma = getPrismaClient();
  return new ComoQuedoService(new ComoQuedoRepository(prisma), new WalletMovimientoRepository(prisma), new AporteCapitalRepository(prisma));
}

export interface ComoQuedoDeps {
  service?: IComoQuedoService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * R58 — la caja y la cuenta afectada tras un movimiento.
 *
 * Superficie (458-C): «Cómo quedó» del panel «Ver» (`components/shared/wallet/DetalleMovimientoPanel.tsx`).
 */
export async function comoQuedoAction(input: unknown, deps: ComoQuedoDeps = {}): Promise<ComoQuedoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = comoQuedoSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.comoQuedo(data, actor);
  });
  return isAppErrorShape(r) ? toComoQuedoActionError(r) : r;
}
