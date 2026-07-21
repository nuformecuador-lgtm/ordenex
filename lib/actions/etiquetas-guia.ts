"use server";

import {
  generarEtiquetasSchema,
  etiquetaPorGuiaSchema,
  type GenerarEtiquetasResult,
  type EtiquetaPorGuiaResult,
} from "@/lib/types/etiqueta-guia";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IEtiquetaGuiaService } from "@/lib/interfaces/services/IEtiquetaGuiaService";
import { EtiquetaGuiaService } from "@/lib/services/EtiquetaGuiaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

function buildEtiquetaService(): IEtiquetaGuiaService {
  return new EtiquetaGuiaService(new OrdenRepository(getPrismaClient()));
}

export interface EtiquetaActionDeps {
  etiquetaService?: IEtiquetaGuiaService;
  getActor?: () => Promise<Actor | null>;
}

// Traduce el AppErrorShape que puede producir este borde: solo ZodError
// (VALIDATION_ERROR, R15) o falta de sesion (UNAUTHORIZED, R14). `forbidden`
// (R13) lo devuelve el service directamente como resultado de dominio (nunca como
// excepcion), por eso NO aparece aqui.
function toEtiquetaActionError(
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
      throw new Error(`etiquetas-guia: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Feature 32/R1-R8/R14-R15: genera las etiquetas de guia (QR + barcode + datos)
 * de la seleccion. READ derivado, sin efectos. Disponible para CUALQUIER rol
 * autenticado: el service NO restringe por rol (decision del usuario, ver
 * EtiquetaGuiaService.generarEtiquetas); quien lo dispara desde el flujo de
 * guia/asignacion por lote es maestro/admin, ya gateados aguas arriba. Sin sesion
 * -> `unauthenticated` antes de tocar el service (R14); entrada invalida (lista
 * vacia / id malformado) -> `validation_error` (R15).
 */
export async function generarEtiquetas(
  input: unknown,
  deps: EtiquetaActionDeps = {},
): Promise<GenerarEtiquetasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R14: antes de tocar el service
    const data = generarEtiquetasSchema.parse(input); // ZodError -> VALIDATION_ERROR (R15)
    const service = deps.etiquetaService ?? buildEtiquetaService();
    return service.generarEtiquetas(data, actor); // resultado tipado de dominio (ok/forbidden)
  });
  return isAppErrorShape(r) ? toEtiquetaActionError(r) : r;
}

/**
 * Feature 32/R1-R8/R14/R15 (QR por guia): resuelve la etiqueta de UNA orden por su
 * `num_guia` (lo que codifica el QR y la URL `/paquete/<numGuia>`). READ derivado, sin
 * efectos, para cualquier rol autenticado (misma autorizacion que `generarEtiquetas`).
 * Sin sesion -> `unauthenticated` antes de tocar el service (R14); `numGuia` no entero
 * positivo -> `validation_error` (R15); sin orden viva con esa guia -> `no_encontrada`.
 */
export async function obtenerEtiquetaPorGuia(
  input: unknown,
  deps: EtiquetaActionDeps = {},
): Promise<EtiquetaPorGuiaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R14: antes de tocar el service
    const data = etiquetaPorGuiaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R15)
    const service = deps.etiquetaService ?? buildEtiquetaService();
    return service.obtenerEtiquetaPorGuia(data.numGuia, actor);
  });
  return isAppErrorShape(r) ? toEtiquetaActionError(r) : r;
}
