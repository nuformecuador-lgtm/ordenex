"use server";

import { manifiestoSchema, type ManifiestoResult } from "@/lib/types/manifiesto";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IManifiestoService } from "@/lib/interfaces/services/IManifiestoService";
import { ManifiestoService } from "@/lib/services/ManifiestoService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

function buildManifiestoService(): IManifiestoService {
  const prisma = getPrismaClient();
  const ordenRepo = new OrdenRepository(prisma);
  return new ManifiestoService(
    ordenRepo,
    new ZonaRepository(prisma),
    // Feature 160 (R28): derivador de intentos EN LOTE. El manifiesto lleva los datos de la
    // orden, y el numero de intentos es uno de ellos (design 160 §6.3).
    new OrdenHistorialService(
      ordenRepo,
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
  );
}

export interface ManifiestoActionDeps {
  manifiestoService?: IManifiestoService;
  getActor?: () => Promise<Actor | null>;
}

// Traduce el AppErrorShape que puede producir este borde: solo ZodError
// (VALIDATION_ERROR, R30) o falta de sesion (UNAUTHORIZED, R28). `forbidden` lo
// devolveria el service como resultado de dominio (nunca como excepcion), por eso NO
// aparece aqui. Patron `lib/actions/etiquetas-guia.ts`.
function toManifiestoActionError(
  shape: AppErrorShape,
): { status: "validation_error"; fieldErrors: Record<string, string[]> } | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      // FORBIDDEN/NOT_FOUND/CONFLICT/INTERNAL: este borde nunca los lanza como
      // AppError; si algo desconocido llega aqui, se propaga como fallo real.
      throw new Error(`manifiesto: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Feature 148/R1/R24/R28/R30 — devuelve las FILAS del manifiesto del lote
 * seleccionado (ids de orden, o `num_remision` en la carga masiva). READ DERIVADO Y
 * PURO: no muta nada (R24) y por eso no revalida rutas ni toca cache. El binario
 * `.xlsx` NO se genera aqui: se arma y descarga en el navegador (design.md §0/D1), asi
 * que un fallo de la descarga no puede revertir ni re-ejecutar la operacion de negocio
 * ya cometida (R25).
 *
 * Sin sesion -> `unauthenticated` ANTES de tocar el service, sin devolver dato alguno
 * de ninguna orden (R28). Entrada invalida (seleccion vacia, identificador malformado
 * o flujo desconocido) -> `validation_error`, tambien sin datos (R30).
 */
export async function obtenerManifiesto(
  input: unknown,
  deps: ManifiestoActionDeps = {},
): Promise<ManifiestoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R28: antes de tocar el service
    const data = manifiestoSchema.parse(input); // ZodError -> VALIDATION_ERROR (R30)
    const service = deps.manifiestoService ?? buildManifiestoService();
    return service.armar(data, actor); // resultado tipado de dominio (ok/forbidden)
  });
  return isAppErrorShape(r) ? toManifiestoActionError(r) : r;
}
