"use server";

import { z } from "zod";
import {
  actualizarOrdenSchema,
  crearOrdenSchema,
  listarOrdenesSchema,
  listarOrdenesCompletoSchema,
  type ActualizarOrdenResult,
  type BorrarOrdenResult,
  type CrearOrdenResult,
  type ListarOrdenesCompletoResult,
  type ListarOrdenesResult,
  type ObtenerOrdenResult,
} from "@/lib/types/orden";
import type { Actor, IOrdenService } from "@/lib/interfaces/services/IOrdenService";
import { OrdenService } from "@/lib/services/OrdenService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError, ValidationError, MSG } from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

const idSchema = z.string().min(1);

function buildOrdenService(): IOrdenService {
  const prisma = getPrismaClient();
  const ordenRepo = new OrdenRepository(prisma);
  return new OrdenService(
    ordenRepo,
    // Feature 160 (R11): derivador de intentos EN LOTE del listado. Mismo servicio (y por tanto
    // mismo criterio) que consumen el cron SLA y el drawer de historial: un solo numero.
    new OrdenHistorialService(ordenRepo, new OrdenHistorialRepository(prisma)),
  );
}

export interface OrdenActionDeps {
  ordenService?: IOrdenService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * R25/R26/R27/R28: crear orden.
 *
 * @sin-superficie andamiaje CRUD del arranque: ninguna pantalla ni ruta de API lo usa. Las rutas `app/api/ordenes/api-key/**` instancian `BulkOrdenService`/`ApiOrdenLecturaService` directamente, y la creacion real de ordenes entra por la carga masiva. Su unico consumidor es `tests/integration/actions/ordenes-action.test.ts`. Deuda inocua (no es capacidad perdida: hay otro camino), pendiente de decidir si se borra.
 */
export async function crearOrden(
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<CrearOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18: antes de tocar el service
    const data = crearOrdenSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.ordenService ?? buildOrdenService();
    return service.crear(data, actor); // R42: resultado tipado de dominio
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R29/R34: obtener orden por id.
 *
 * @sin-superficie andamiaje CRUD del arranque, mismo caso que `crearOrden` (ver alli): sin consumidor en `app/` ni en `components/` desde que nacio; el detalle de la orden se sirve por props desde la pagina. Solo lo toca su propio test de integracion.
 */
export async function obtenerOrden(
  id: unknown,
  deps: OrdenActionDeps = {},
): Promise<ObtenerOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // R9: conservar la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.ordenService ?? buildOrdenService();
    return service.obtener(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R30/R31/R32/R33/R34: listar ordenes paginadas. */
export async function listarOrdenes(
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<ListarOrdenesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18
    const data = listarOrdenesSchema.parse(input ?? {}); // R32: ZodError -> VALIDATION_ERROR
    const service = deps.ordenService ?? buildOrdenService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * Feature 151 (R11/R13/R14/R15/R20): dataset COMPLETO del listado, sin paginacion, para
 * la descarga. Calcado de `listarOrdenes` a proposito: mismo borde, mismo actor, mismo
 * schema (menos `page`/`pageSize`) y el MISMO servicio, que es quien autoriza, acota por
 * rol y aplica el tope. Ninguna fila viaja junto a un error.
 */
export async function listarOrdenesCompleto(
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<ListarOrdenesCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const data = listarOrdenesCompletoSchema.parse(input ?? {}); // R15: ZodError -> VALIDATION_ERROR
    const service = deps.ordenService ?? buildOrdenService();
    return service.listarCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R35/R36/R37/R38: actualizar orden por id.
 *
 * @sin-superficie andamiaje CRUD del arranque, mismo caso que `crearOrden` (ver alli): las ediciones reales de una orden pasan por las acciones de dominio (guia, asignacion, incidencias), no por este update generico. Solo lo toca su propio test de integracion.
 */
export async function actualizarOrden(
  id: unknown,
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<ActualizarOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // R9: conservar la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = actualizarOrdenSchema.parse(input); // R38: ZodError -> VALIDATION_ERROR
    const service = deps.ordenService ?? buildOrdenService();
    return service.actualizar(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R39/R40/R41: borrado logico de orden por id.
 *
 * @sin-superficie andamiaje CRUD del arranque, mismo caso que `crearOrden` (ver alli): no hay ninguna pantalla que ofrezca borrar una orden, ni se ha pedido. Solo lo toca su propio test de integracion.
 */
export async function borrarOrden(
  id: unknown,
  deps: OrdenActionDeps = {},
): Promise<BorrarOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      // R9: conservar la clave `id` en fieldErrors.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.ordenService ?? buildOrdenService();
    return service.borrar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
