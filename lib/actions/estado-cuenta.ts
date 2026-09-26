"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IEstadoCuentaService } from "@/lib/interfaces/services/IEstadoCuentaService";
import { EstadoCuentaRepository } from "@/lib/repositories/EstadoCuentaRepository";
import { RechazoTiendaCobroAnulacionRepository } from "@/lib/repositories/RechazoTiendaCobroAnulacionRepository";
import { EstadoCuentaService } from "@/lib/services/EstadoCuentaService";
import { estadoCuentaSchema, type VerEstadoCuentaResult } from "@/lib/types/estado-cuenta";

// FICHA 458-B (design §3.2/§6, R16–R25, R81) — el borde del ESTADO DE CUENTA. Lectura interna del
// mismo proyecto: Server Action (`docs/architecture.md`). Sesion primero, forma despues (`.strict()`:
// una clave de mas es `validation_error` sin leer nada), el resto lo decide el servicio (rol antes de
// leer, cuenta inexistente o de otro papel → `no_encontrado` sin distinguir).

function toEstadoCuentaActionError(
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
      throw new Error(`estado-cuenta: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IEstadoCuentaService {
  const prisma = getPrismaClient();
  return new EstadoCuentaService(new EstadoCuentaRepository(prisma), new RechazoTiendaCobroAnulacionRepository(prisma));
}

export interface EstadoCuentaDeps {
  service?: IEstadoCuentaService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * El estado de cuenta de una tienda, un mensajero o una bodega satelite: tarjetas (saldo actual con su
 * sentido, saldo inicial, abonos y cargos netos del periodo, saldo final) y el extracto paginado con
 * el saldo corrido de la cuenta ENTERA.
 *
 * @sin-superficie FICHA 458-B (backend por delante del frontend): la llaman las paginas `/wallet/tiendas/[tiendaId]`, `/wallet/mensajeros/[mensajeroId]` y `/wallet/satelites/[zonaId]` de la 458-D (design §5). Esta anotacion CADUCA con la 458-D.
 */
export async function verEstadoCuentaAction(
  input: unknown,
  deps: EstadoCuentaDeps = {},
): Promise<VerEstadoCuentaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = estadoCuentaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.leer(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}
