"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenNotaRepository } from "@/lib/repositories/OrdenNotaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenNotaService } from "@/lib/services/OrdenNotaService";
import { HabilitarNovedadService } from "@/lib/services/HabilitarNovedadService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IHabilitarNovedadService } from "@/lib/interfaces/services/IHabilitarNovedadService";
import {
  habilitarNovedadSchema,
  type HabilitarNovedadResult,
} from "@/lib/types/novedad-habilitar";
import type { NotaValidationError } from "@/lib/types/orden-nota";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// «HABILITAR» una novedad (pedido humano 2026-08-18) — Server Action, patron EXACTO de
// `lib/actions/orden-ayuda.ts`: se resuelve el actor por sesion, se valida en el borde con zod y se
// delega en el service, TODO dentro de `withErrorHandler`. `unauthenticated` se decide ANTES de
// tocar el service, asi que sin sesion el service no recibe ni una llamada.
//
// `forbidden` NO es excepcion: es el resultado de dominio que devuelve el hilo de notas (rol, orden
// ajena, orden inexistente o ventana cerrada — todos el mismo resultado opaco).
//
// Aqui no se registra NADA: la nota es texto que una tienda escribio sobre una orden concreta y no
// tiene por que acabar en un log.

/** Espejo de `toSolicitarAyudaActionError`: este borde solo produce ZodError o falta de sesion. */
function toHabilitarNovedadActionError(
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
      throw new Error(`habilitar-novedad: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IHabilitarNovedadService {
  const prisma = getPrismaClient();
  return new HabilitarNovedadService(
    new OrdenNotaService(new OrdenNotaRepository(prisma)),
    new OrdenRepository(prisma),
  );
}

export interface HabilitarNovedadDeps {
  service?: IHabilitarNovedadService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Publica la nota en el hilo de la orden y apaga su bandera de AYUDA. NO cambia el estatus.
 *
 * FEATURE 239 (T3.1, R23): antes apagaba DOS banderas y con eso la orden desaparecia de
 * `/novedades` aunque siguiera en `devuelta` — con el reloj del SLA corriendo, hasta escalar y
 * cobrarse sola. `gestion_aprobada` ya no existe: la devolucion se lista por igualdad de estado,
 * asi que habilitar retira la solicitud de ayuda y nada mas.
 */
export async function habilitarNovedad(
  input: unknown,
  deps: HabilitarNovedadDeps = {},
): Promise<HabilitarNovedadResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const data = habilitarNovedadSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.habilitar(data, actor);
  });
  return isAppErrorShape(r) ? toHabilitarNovedadActionError(r) : r;
}
