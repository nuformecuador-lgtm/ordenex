"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPrevisualizarMovimientoService } from "@/lib/interfaces/services/IPrevisualizarMovimientoService";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { PrevisualizarMovimientoService } from "@/lib/services/PrevisualizarMovimientoService";
import { previsualizarMovimientoSchema, type PrevisualizarMovimientoResult } from "@/lib/types/efecto-movimiento";

// FICHA 458-B (design §4.4, R44–R47, R82) — el borde de «Así queda». Sesion primero, forma despues
// (`.strict()`, monto positivo), rol en el servicio (antes de leer). Solo lectura.

function toEfectoActionError(
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
      throw new Error(`efecto-movimiento: AppErrorCode inesperado ${shape.code}`);
  }
}

/** El composition root: los lectores REALES de la caja, del saldo inicial y de las dos cuentas. */
function buildService(): IPrevisualizarMovimientoService {
  const prisma = getPrismaClient();
  return new PrevisualizarMovimientoService(
    new WalletMovimientoRepository(prisma),
    new AporteCapitalRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new UserRepository(prisma),
    new PagoMensajeroMovimientoRepository(prisma),
  );
}

export interface EfectoMovimientoDeps {
  service?: IPrevisualizarMovimientoService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * R44–R47 — el antes y el despues de un registro, calculados en el servidor.
 *
 * @sin-superficie FICHA 458-B (backend por delante del frontend): la llama «Así queda» del `RegistrarMovimientoDialog` de la 458-C (design §4.4). Esta anotacion CADUCA con la 458-C.
 */
export async function previsualizarMovimientoAction(
  input: unknown,
  deps: EfectoMovimientoDeps = {},
): Promise<PrevisualizarMovimientoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = previsualizarMovimientoSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.previsualizar(data, actor);
  });
  return isAppErrorShape(r) ? toEfectoActionError(r) : r;
}
