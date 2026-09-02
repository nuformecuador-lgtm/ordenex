"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { DeshacerAsignacionService } from "@/lib/services/DeshacerAsignacionService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  DeshacerAsignacionServiceResult,
  IDeshacerAsignacionService,
} from "@/lib/interfaces/services/IDeshacerAsignacionService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 149 (design §5) — Server Action que DESHACE una asignacion/ruteo antes de la recogida.
// Mutacion interna del mismo proyecto => Server Action, nunca ruta API (`docs/architecture.md`).
// Patron literal de `lib/actions/resolver-novedad.ts`: `withErrorHandler` + `resolveActorFromSession`
// + zod en el borde + fabrica del service. Sin PII en logs (R40): esta accion no registra
// destinatario ni telefono.

// R22/D4: el `motivo` es OBLIGATORIO y se valida en el BORDE. `trim()` corre ANTES de las
// cotas, asi que "   " (solo espacios) queda en "" y falla el min(10); el valor que llega al
// service ya viene RECORTADO. 300 es el tope del campo de motivo de gestion (consistencia
// visual de la linea de tiempo). `ordenIds` es un lote no vacio de uuid (R23 de la 100).
const deshacerSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
  motivo: z
    .string()
    .trim()
    .min(10, "explica el motivo (minimo 10 caracteres)")
    .max(300, "el motivo no puede superar los 300 caracteres"),
});

// Estados del BORDE (los de dominio los devuelve el service).
type BorderError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type DeshacerAsignacionActionResult = DeshacerAsignacionServiceResult | BorderError;

export interface DeshacerAsignacionDeps {
  service?: IDeshacerAsignacionService;
  getActor?: () => Promise<Actor | null>;
}

function buildService(): IDeshacerAsignacionService {
  const prisma = getPrismaClient();
  // FICHA 363: sin `ZonaRepository`. La zona central se leia SOLO para la comparacion
  // zona/destino que la 363 retira; la zona del ACTOR (R4/R5/R6) la sigue resolviendo
  // `OrdenRepository.findUsuarioZonaId` y no cambia.
  return new DeshacerAsignacionService(
    new OrdenRepository(prisma),
    new OrdenHistorialRepository(prisma),
  );
}

// Traduce el AppErrorShape que puede producir este borde: ZodError (VALIDATION_ERROR, R22) o
// falta de sesion (UNAUTHORIZED, R7). Espejo de `toResolverNovedadActionError`.
function toDeshacerActionError(shape: AppErrorShape): BorderError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`deshacer-asignacion: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * R1-R33: revierte un lote de ordenes en `por_recoger` (caso a) o `en_ruta_bodega_satelite`
 * (caso b) a la bodega de la que salieron, derivando el destino del historial. `unauthenticated`
 * (sin sesion, R7) y `validation_error` (lote vacio / uuid invalido / motivo fuera de rango,
 * R22) se resuelven en el BORDE, sin construir el service ni tocar dato alguno;
 * forbidden/sin_zona/conflict los devuelve el service.
 */
export async function deshacerAsignacion(
  input: unknown,
  deps: DeshacerAsignacionDeps = {},
): Promise<DeshacerAsignacionActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R7: antes de leer o escribir nada
    const data = deshacerSchema.parse(input); // R22: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    // R24: UN motivo (ya recortado por el schema) para todas las ordenes del lote.
    return service.deshacer({ ordenIds: data.ordenIds, motivo: data.motivo }, actor);
  });
  return isAppErrorShape(r) ? toDeshacerActionError(r) : r;
}
