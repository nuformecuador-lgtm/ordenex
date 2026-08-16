"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenNotaRepository } from "@/lib/repositories/OrdenNotaRepository";
import { OrdenNotaService } from "@/lib/services/OrdenNotaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import {
  borrarNotaSchema,
  listarNotasSchema,
  publicarNotaSchema,
  type BorrarNotaResult,
  type ListarNotasResult,
  type NotaValidationError,
  type PublicarNotaResult,
} from "@/lib/types/orden-nota";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 227 (T2.8, design §2.3) — Server Actions del HILO de notas por orden. Son mutaciones
// (y una lectura) INTERNAS del propio proyecto: van como Server Action y no como route handler
// (`docs/architecture.md`; alternativa A5 descartada en design §6).
//
// Patron EXACTO de `orden-mensajero-meta.ts`: se resuelve el actor por sesion, se valida en el
// borde con zod y se delega en el service, TODO dentro de `withErrorHandler`. El orden importa:
// `unauthenticated` se decide ANTES de tocar el service (R13), asi que sin sesion el service no
// recibe ni una llamada.
//
// `forbidden` NO es excepcion: es resultado de dominio del service (rol no autorizado, orden
// ajena, orden inexistente, nota ajena o ventana cerrada — todos el mismo resultado opaco, R10).
//
// R29: aqui no se registra NADA. Ni el cuerpo de una nota, ni el destinatario, ni el actor. No
// hay `console.log` ni `catch` vacios en este archivo; el unico `catch` del flujo es el de
// `withErrorHandler`, que normaliza y propaga.

/**
 * Traduce el `AppErrorShape` que este borde puede producir: ZodError (`VALIDATION_ERROR`, R27) o
 * falta de sesion (`UNAUTHORIZED`, R13). Cualquier otro codigo es un fallo REAL que no se traga:
 * se lanza. Espejo de `toMarcarLuegoActionError`.
 */
function toOrdenNotaActionError(
  shape: AppErrorShape,
): NotaValidationError | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`orden-notas: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IOrdenNotaService {
  return new OrdenNotaService(new OrdenNotaRepository(getPrismaClient()));
}

export interface OrdenNotasDeps {
  service?: IOrdenNotaService;
  getActor?: () => Promise<Actor | null>;
}

/** R11/R13/R15/R27: hilo COMPLETO de la orden (cualquier estatus) + `puedeEscribir` del actor. */
export async function listarNotasOrden(
  input: unknown,
  deps: OrdenNotasDeps = {},
): Promise<ListarNotasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13: ANTES de tocar el service
    const data = listarNotasSchema.parse(input); // R27: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toOrdenNotaActionError(r) : r;
}

/** R1/R5/R6/R7/R8/R13/R14/R27: publica una nota en el hilo, con el autor de la sesion. */
export async function publicarNotaOrden(
  input: unknown,
  deps: OrdenNotasDeps = {},
): Promise<PublicarNotaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    // R7: el tope de 200 se mide aqui, sobre el texto CRUDO. R8: una orden inexistente no llega
    // a crear nada — el service devuelve `forbidden` como resultado de dominio, sin excepcion.
    const data = publicarNotaSchema.parse(input); // R27
    const service = deps.service ?? buildService();
    return service.publicar(data, actor);
  });
  return isAppErrorShape(r) ? toOrdenNotaActionError(r) : r;
}

/** R13/R27/R31/R32/R33/R35: borra (logicamente) una nota PROPIA dentro de la ventana del rol. */
export async function borrarNotaOrden(
  input: unknown,
  deps: OrdenNotasDeps = {},
): Promise<BorrarNotaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const data = borrarNotaSchema.parse(input); // R27
    const service = deps.service ?? buildService();
    return service.borrar(data, actor);
  });
  return isAppErrorShape(r) ? toOrdenNotaActionError(r) : r;
}
