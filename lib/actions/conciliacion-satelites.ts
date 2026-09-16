"use server";

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { isAppErrorShape, UnauthenticatedError, withErrorHandler } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IConciliacionSatelitesService,
  ListarConsolidacionesSateliteServiceResult,
  ListarSaldosSatelitesServiceResult,
  MarcaConciliacionServiceResult,
} from "@/lib/interfaces/services/IConciliacionSatelitesService";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { SaldosSatelitesRepository } from "@/lib/repositories/SaldosSatelitesRepository";
import { ConciliacionSatelitesService } from "@/lib/services/ConciliacionSatelitesService";
import {
  listarConsolidacionesSateliteCompletoSchema,
  listarConsolidacionesSateliteSchema,
  listarSaldosSatelitesCompletoSchema,
  listarSaldosSatelitesSchema,
  marcarConsolidacionRecibidaSchema,
  revertirConciliacionSchema,
  type ConsolidacionSateliteDTO,
  type SaldoSateliteDTO,
} from "@/lib/types/conciliacion-satelites";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 — SERVER ACTIONS DE LA CONCILIACION DE SATELITES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Server Actions y NO route handlers: son lecturas y mutaciones INTERNAS del mismo proyecto
// (`docs/architecture.md`). No hay ruta nueva de API, no hay CORS y no hay API publica que versionar.
//
// EL REPARTO DE RESPONSABILIDADES ES EL DEL REPO, y el orden importa:
//   1. sin sesion se corta ANTES de validar y ANTES de construir el servicio: no se abre conexion
//      ni se instancia repositorio;
//   2. `schema.parse` mata en el BORDE el monto no numerico, el uuid invalido y —por el
//      `.strict()`— cualquier clave colada;
//   3. el ROL lo decide el SERVICIO (`esAccesoTotal`), porque es dominio y no transporte.
//
// ⚠️ LAS DOS MITADES DEL CONTROL. Cuando llegue la pantalla, `/wallet/satelites` resolvera el rol
// en servidor y hara `notFound()`, **y ademas** el servicio seguira respondiendo `forbidden` por su
// cuenta (R27). Ocultar el boton no es un control por si solo: esta mitad es la que de verdad
// rechaza al `adminSatelite` que llame a la accion a mano.

function buildService(): IConciliacionSatelitesService {
  const prisma = getPrismaClient();
  return new ConciliacionSatelitesService(
    new SaldosSatelitesRepository(prisma),
    // Las DOS escrituras salen de donde ya viven TODAS las escrituras de `cierre_bodega`. Un
    // segundo escritor de la misma tabla es como aparecen dos guardas que divergen.
    new CierresBodegaAdminRepository(prisma),
  );
}

/** Traduce el `AppErrorShape` que puede producir ESTE borde: ZodError o falta de sesion. */
function toConciliacionActionError(
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
      throw new Error(`conciliacion-satelites: AppErrorCode inesperado ${shape.code}`);
  }
}

export interface ConciliacionSatelitesDeps {
  service?: IConciliacionSatelitesService;
  getActor?: () => Promise<Actor | null>;
}

export type ListarSaldosSatelitesActionResult =
  | ListarSaldosSatelitesServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type ListarConsolidacionesSateliteActionResult =
  | ListarConsolidacionesSateliteServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type MarcaConciliacionActionResult =
  | MarcaConciliacionServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/**
 * R23 — la tabla de saldos sin conciliar de todas las bodegas satelite.
 *
 * @sin-superficie la pantalla `/wallet/satelites` entra en la fase 7 de la ficha 431 (T20/T21), que va en una pasada de frontend posterior a esta; el backend se entrega antes a proposito para que el diseño de la pantalla se haga contra datos reales. Esta anotacion CADUCA: en cuanto la pagina monte la accion, se borra en el mismo commit.
 */
export async function listarSaldosSatelitesAction(
  input: unknown,
  deps: ConciliacionSatelitesDeps = {},
): Promise<ListarSaldosSatelitesActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarSaldosSatelitesSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.listarSaldosSatelites(data, actor);
  });
  return isAppErrorShape(r) ? toConciliacionActionError(r) : r;
}

/**
 * R29 — el mismo conjunto de saldos SIN paginar, para la descarga. El tope lo evalua el servicio y
 * `limite_excedido` viaja con conteos y sin filas.
 *
 * @sin-superficie el control de descarga de la tabla de saldos vive en `/wallet/satelites`, que entra en la fase 7 de la ficha 431 (frontend). Igual que su hermana paginada, la anotacion se borra en el commit que la cablee.
 */
export async function listarSaldosSatelitesCompletoAction(
  input: unknown,
  deps: ConciliacionSatelitesDeps = {},
): Promise<ListarCompletoResult<SaldoSateliteDTO>> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarSaldosSatelitesCompletoSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.listarSaldosSatelitesCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toConciliacionActionError(r) : r;
}

/**
 * R24 — el desglose de consolidaciones de UNA bodega satelite.
 *
 * @sin-superficie el desglose por bodega es la fila desplegada de `/wallet/satelites`, que entra en la fase 7 de la ficha 431 (frontend). La anotacion caduca con el commit que la monte.
 */
export async function listarConsolidacionesSateliteAction(
  input: unknown,
  deps: ConciliacionSatelitesDeps = {},
): Promise<ListarConsolidacionesSateliteActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarConsolidacionesSateliteSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.listarConsolidacionesSatelite(data, actor);
  });
  return isAppErrorShape(r) ? toConciliacionActionError(r) : r;
}

/**
 * R29 — el desglose entero de esa bodega, para la descarga.
 *
 * @sin-superficie el control de descarga del desglose vive en `/wallet/satelites` (fase 7 de la ficha 431, pasada de frontend). La anotacion se borra en el commit que lo cablee.
 */
export async function listarConsolidacionesSateliteCompletoAction(
  input: unknown,
  deps: ConciliacionSatelitesDeps = {},
): Promise<ListarCompletoResult<ConsolidacionSateliteDTO>> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarConsolidacionesSateliteCompletoSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.listarConsolidacionesSateliteCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toConciliacionActionError(r) : r;
}

/**
 * R9/R10/R11/R13 — MARCAR una consolidacion como RECIBIDA, con su monto.
 *
 * El monto muere en el BORDE si esta ausente, es negativo o trae tres decimales (R10,
 * `montoPositivoSchema`), y en ese caso no se llama al servicio ni se escribe nada.
 *
 * @sin-superficie las acciones de marcar y revertir viven en `/wallet/satelites`, que entra en la fase 7 de la ficha 431 (T20/T21) en una pasada de frontend posterior. La anotacion CADUCA: se borra en el commit que monte el boton.
 */
export async function marcarConsolidacionRecibidaAction(
  input: unknown,
  deps: ConciliacionSatelitesDeps = {},
): Promise<MarcaConciliacionActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = marcarConsolidacionRecibidaSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.marcarRecibida(data, actor);
  });
  return isAppErrorShape(r) ? toConciliacionActionError(r) : r;
}

/**
 * R12/R13 — REVERTIR la marca. Devuelve la consolidacion a «Pendiente de conciliar» y borra los
 * cuatro datos de la marca; el monto que se borra queda documentado en el historial.
 *
 * @sin-superficie la accion de revertir vive en `/wallet/satelites`, que entra en la fase 7 de la ficha 431 (pasada de frontend posterior). La anotacion se borra en el commit que monte el boton.
 */
export async function revertirConciliacionAction(
  input: unknown,
  deps: ConciliacionSatelitesDeps = {},
): Promise<MarcaConciliacionActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = revertirConciliacionSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.revertirConciliacion(data, actor);
  });
  return isAppErrorShape(r) ? toConciliacionActionError(r) : r;
}
