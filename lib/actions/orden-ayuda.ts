"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { OrdenNotaRepository } from "@/lib/repositories/OrdenNotaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenNotaService } from "@/lib/services/OrdenNotaService";
import { SolicitudAyudaService } from "@/lib/services/SolicitudAyudaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ISolicitudAyudaService } from "@/lib/interfaces/services/ISolicitudAyudaService";
import {
  intentoContactoSchema,
  recuperarAyudaSchema,
  solicitarAyudaSchema,
  type IntentoContactoResult,
  type RecuperarAyudaResult,
  type SolicitarAyudaResult,
} from "@/lib/types/orden-ayuda";
import type { NotaValidationError } from "@/lib/types/orden-nota";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// SOLICITUD DE AYUDA sobre una orden (pedido humano 2026-08-18) — Server Action, patron EXACTO de
// `lib/actions/orden-notas.ts`: se resuelve el actor por sesion, se valida en el borde con zod y se
// delega en el service, TODO dentro de `withErrorHandler`. `unauthenticated` se decide ANTES de
// tocar el service, asi que sin sesion el service no recibe ni una llamada.
//
// `forbidden` NO es excepcion: es el resultado de dominio que devuelve el hilo de notas (rol,
// orden ajena, orden inexistente o ventana cerrada — todos el mismo resultado opaco).
//
// Aqui no se registra NADA, por la misma razon que en `orden-notas.ts`: el motivo de la ayuda es
// texto que un mensajero escribio sobre una orden concreta y no tiene por que acabar en un log.

/** Espejo de `toOrdenNotaActionError`: este borde solo produce ZodError o falta de sesion. */
function toSolicitarAyudaActionError(
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
      throw new Error(`orden-ayuda: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): ISolicitudAyudaService {
  const prisma = getPrismaClient();
  const notaRepo = new OrdenNotaRepository(prisma);
  return new SolicitudAyudaService(
    new OrdenNotaService(notaRepo),
    new OrdenRepository(prisma),
    notaRepo,
    // Solo por `liberarOrdenEnGestion`: pedir ayuda suelta el puntero 1-a-1 de gestion.
    new GestionOrdenRepository(prisma),
  );
}

export interface SolicitudAyudaDeps {
  service?: ISolicitudAyudaService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Publica el motivo en el hilo de la orden y marca la orden como «con ayuda solicitada», lo que la
 * hace aparecer en `/novedades` para su tienda.
 */
export async function solicitarAyudaOrden(
  input: unknown,
  deps: SolicitudAyudaDeps = {},
): Promise<SolicitarAyudaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const data = solicitarAyudaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.solicitar(data, actor);
  });
  return isAppErrorShape(r) ? toSolicitarAyudaActionError(r) : r;
}

/**
 * «Recuperar»: retira la solicitud de ayuda de la orden. Con eso vuelve al listado normal del
 * mensajero y deja de aparecer en `/novedades` por esta razon. El hilo NO se toca.
 */
export async function recuperarOrdenAyuda(
  input: unknown,
  deps: SolicitudAyudaDeps = {},
): Promise<RecuperarAyudaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recuperarAyudaSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.recuperar(data, actor);
  });
  return isAppErrorShape(r) ? toSolicitarAyudaActionError(r) : r;
}

/**
 * «+1 intento de contacto»: suma uno al contador de la orden y devuelve el valor resultante para
 * que la pantalla lo pinte sin una segunda lectura. Solo la tienda dueña.
 */
export async function registrarIntentoContactoOrden(
  input: unknown,
  deps: SolicitudAyudaDeps = {},
): Promise<IntentoContactoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = intentoContactoSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.registrarIntentoContacto(data, actor);
  });
  return isAppErrorShape(r) ? toSolicitarAyudaActionError(r) : r;
}
