"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { RecuperacionBodegaRepository } from "@/lib/repositories/RecuperacionBodegaRepository";
import { ReprogramacionTiendaService } from "@/lib/services/ReprogramacionTiendaService";
import { RecuperacionBodegaService } from "@/lib/services/RecuperacionBodegaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esFechaFutura } from "@/lib/types/gestion-orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IReprogramacionTiendaService,
  ReprogramarNovedadResult,
} from "@/lib/interfaces/services/IReprogramacionTiendaService";
import type {
  IRecuperacionBodegaService,
  RecuperarABodegaResult,
} from "@/lib/interfaces/services/IRecuperacionBodegaService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 100 — Server Actions que RESUELVEN una novedad (mutaciones internas del mismo proyecto ->
// Server Actions, no Route API, patron devolucion-origen.ts). Cada una resuelve el actor por sesion,
// valida en el borde con zod y delega en su servicio, TODO bajo `withErrorHandler`: un error
// EXCEPCIONAL (caida de DB) se normaliza a AppErrorShape en vez de propagarse crudo. La UBICACION de
// los botones que consumen estas acciones es de frontend (reprogramar en /novedades; recuperar en
// /recepcion-satelite y /ordenes); aqui SOLO se exponen las acciones server-side (R22, gate F1.4-Q4).
// Sin PII en logs (R24): estas acciones no registran telefono ni destinatario.

// R23: el `ordenId` del cliente es el `orden.id` (uuid). `fechaReprogramacion` es `YYYY-MM-DD` y
// debe ser mañana o posterior en el calendario de Costa Rica (R4, misma regla `esFechaFutura` que
// la reprogramacion del mensajero). `motivo` es OPCIONAL (gate F1.4-Q1). Un valor invalido ->
// ZodError -> validation_error ANTES del service, sin tocar datos.
const reprogramarSchema = z.object({
  ordenId: z.string().uuid(),
  fechaReprogramacion: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha invalida")
    .refine((v) => esFechaFutura(v), "la fecha debe ser mañana o posterior"), // R4
  motivo: z.string().trim().optional(),
});

const recuperarSchema = z.object({
  ordenId: z.string().uuid(), // R23
});

// Resultado expuesto por cada Server Action: el resultado de dominio del service + los dos estados
// del borde (validation_error de zod, unauthenticated sin sesion).
type BorderError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type ReprogramarNovedadActionResult = ReprogramarNovedadResult | BorderError;
export type RecuperarABodegaActionResult = RecuperarABodegaResult | BorderError;

export interface ReprogramarNovedadDeps {
  service?: IReprogramacionTiendaService;
  getActor?: () => Promise<Actor | null>;
}

export interface RecuperarABodegaDeps {
  service?: IRecuperacionBodegaService;
  getActor?: () => Promise<Actor | null>;
}

function buildReprogramacionService(): IReprogramacionTiendaService {
  const prisma = getPrismaClient();
  return new ReprogramacionTiendaService(
    new OrdenRepository(prisma),
    new GestionOrdenRepository(prisma),
  );
}

function buildRecuperacionService(): IRecuperacionBodegaService {
  const prisma = getPrismaClient();
  return new RecuperacionBodegaService(
    new OrdenRepository(prisma),
    new ZonaRepository(prisma),
    new RecuperacionBodegaRepository(prisma),
  );
}

// Traduce el AppErrorShape que puede producir este borde: solo ZodError (VALIDATION_ERROR, R4/R23)
// o falta de sesion (UNAUTHORIZED, R22). El resto de estados los devuelve el service como resultado
// de dominio. Espejo de toDevolucionOrigenActionError.
function toResolverNovedadActionError(shape: AppErrorShape): BorderError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`resolver-novedad: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * R2/R3/R4/R22/R23: el adminTienda dueño reprograma una orden en `devuelta` (transicion a
 * `reprogramada` + gestion sintetica). `unauthenticated` (sin sesion) y `validation_error`
 * (ordenId no-uuid / fecha no futura) se resuelven en el borde; forbidden/not_found/conflict/
 * config_error los devuelve el service. Patron `devolverATienda`.
 */
export async function reprogramarNovedad(
  input: unknown,
  deps: ReprogramarNovedadDeps = {},
): Promise<ReprogramarNovedadActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R22: antes de tocar el service
    const data = reprogramarSchema.parse(input); // R4/R23: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildReprogramacionService();
    // motivo OPCIONAL (Q1): vacio tras el trim -> null (no forzar texto).
    const motivo = data.motivo && data.motivo.length > 0 ? data.motivo : null;
    return service.reprogramar(data.ordenId, data.fechaReprogramacion, motivo, actor);
  });
  return isAppErrorShape(r) ? toResolverNovedadActionError(r) : r;
}

/**
 * R13/R14/R15/R22/R23: la bodega responsable recupera una orden en `devuelta` a bodega (transicion
 * a `en_bodega`/`en_bodega_satelite`, limpia mensajero). `unauthenticated` (sin sesion) y
 * `validation_error` (ordenId no-uuid) se resuelven en el borde; forbidden/not_found/conflict/
 * config_error los devuelve el service. Patron `devolverATienda`.
 */
export async function recuperarABodega(
  input: unknown,
  deps: RecuperarABodegaDeps = {},
): Promise<RecuperarABodegaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R22: antes de tocar el service
    const data = recuperarSchema.parse(input); // R23: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildRecuperacionService();
    return service.recuperar(data.ordenId, actor);
  });
  return isAppErrorShape(r) ? toResolverNovedadActionError(r) : r;
}
