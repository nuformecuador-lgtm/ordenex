"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { RechazosSlaTiendaService } from "@/lib/services/RechazosSlaTiendaService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRechazosSlaTiendaService,
  ListarRechazosSlaTiendaServiceResult,
} from "@/lib/interfaces/services/IRechazosSlaTiendaService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 102 (T9, design §5.2) — Server Action de la lista de RECHAZOS POR SLA de la tienda
// (lectura interna del mismo proyecto -> Server Action, NO Route API; sin canal/notificacion nuevo,
// R17; patron `novedades.ts`). Resuelve el actor por sesion, valida `page` en el borde con zod y
// delega en el service bajo `withErrorHandler`. `unauthenticated` (sin sesion) y `validation_error`
// (ZodError) se resuelven en el borde; `forbidden`/`ok` los devuelve el service. Se usa como
// pre-fetch server-side (pagina 1) desde la page Y como re-fetch de pagina desde el modulo cliente.

// Tamano de pagina FIJO (paridad con /novedades). El cliente NO lo elige.
const PAGE_SIZE = 10;

// Valida solo `page` (entero >= 1, default 1). `input` opcional/undefined -> pagina 1.
const listarRechazosSlaTiendaSchema = z.object({
  page: z.number().int().min(1).default(1),
});

export type ListarRechazosSlaTiendaActionResult =
  | ListarRechazosSlaTiendaServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

// Traduce el AppErrorShape del borde: ZodError (VALIDATION_ERROR) o falta de sesion (UNAUTHORIZED).
// Espejo de `toNovedadesActionError`.
function toRechazosSlaTiendaActionError(
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
      throw new Error(`rechazos-sla-tienda: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IRechazosSlaTiendaService {
  const prisma = getPrismaClient();
  const ordenRepo = new OrdenRepository(prisma);
  return new RechazosSlaTiendaService(
    ordenRepo,
    // Feature 160 (R11/R26): derivador de intentos EN LOTE de la pagina de rechazos por plazo.
    new OrdenHistorialService(ordenRepo, new OrdenHistorialRepository(prisma)),
  );
}

export interface RechazosSlaTiendaDeps {
  service?: IRechazosSlaTiendaService;
  getActor?: () => Promise<Actor | null>;
}

/** R12/R14: lista paginada (10/pagina) de las ordenes rechazadas por SLA de la tienda del adminTienda. */
export async function listarRechazosSlaTiendaAction(
  input?: { page?: number },
  deps: RechazosSlaTiendaDeps = {},
): Promise<ListarRechazosSlaTiendaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const { page } = listarRechazosSlaTiendaSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listar({ page, pageSize: PAGE_SIZE }, actor);
  });
  return isAppErrorShape(r) ? toRechazosSlaTiendaActionError(r) : r;
}
