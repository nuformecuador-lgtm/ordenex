"use server";

import { z } from "zod";
import type {
  Actor,
  ActualizarVehiculoServiceResult,
  BorrarVehiculoServiceResult,
  CrearVehiculoServiceResult,
  IVehiculoService,
  ListarVehiculosServiceResult,
} from "@/lib/interfaces/services/IVehiculoService";
import {
  actualizarVehiculoSchema,
  crearVehiculoSchema,
  type VehiculoActionError,
} from "@/lib/types/vehiculos";
import { VehiculoService } from "@/lib/services/VehiculoService";
import { VehiculoRepository } from "@/lib/repositories/VehiculoRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

// Resultados expuestos por las Server Actions: los del service + `unauthenticated`
// (sin sesion valida) + `error` para lo inesperado.
export type ListarVehiculosResult =
  | ListarVehiculosServiceResult
  | { status: "unauthenticated" };

export type CrearVehiculoResult = CrearVehiculoServiceResult | VehiculoActionError;
export type ActualizarVehiculoResult = ActualizarVehiculoServiceResult | VehiculoActionError;
export type BorrarVehiculoResult = BorrarVehiculoServiceResult | VehiculoActionError;

const idSchema = z.string().min(1);

function buildVehiculoService(): IVehiculoService {
  const prisma = getPrismaClient();
  return new VehiculoService(new VehiculoRepository(prisma));
}

export interface VehiculoActionDeps {
  vehiculoService?: IVehiculoService;
  getActor?: () => Promise<Actor | null>;
}

/** Traduce el ZodError del borde a `validation_error` con los errores por campo. */
function errorDeValidacion(error: z.ZodError): VehiculoActionError {
  return {
    status: "validation_error",
    // `flatten()` es la forma que ya usan auth/password-reset en este repo.
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/** R9/R10/R11: listar el catalogo vehiculos (solo maestro). */
export async function listarVehiculos(
  deps: VehiculoActionDeps = {},
): Promise<ListarVehiculosResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R10: sin sesion valida
  const service = deps.vehiculoService ?? buildVehiculoService();
  return service.listar(actor);
}

/** Alta de un tipo de vehiculo (solo maestro). */
export async function crearVehiculo(
  input: unknown,
  deps: VehiculoActionDeps = {},
): Promise<CrearVehiculoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const parsed = crearVehiculoSchema.safeParse(input);
  if (!parsed.success) return errorDeValidacion(parsed.error);

  const service = deps.vehiculoService ?? buildVehiculoService();
  try {
    return await service.crear(parsed.data, actor);
  } catch {
    // El UNIQUE de la base es la ultima palabra: si dos altas simultaneas pasan la
    // comprobacion del service, una de las dos falla aqui y se cuenta como conflict.
    return { status: "conflict" };
  }
}

/** Renombra un tipo de vehiculo (solo maestro). */
export async function actualizarVehiculo(
  id: unknown,
  input: unknown,
  deps: VehiculoActionDeps = {},
): Promise<ActualizarVehiculoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return { status: "validation_error", fieldErrors: { id: ["id invalido"] } };
  }
  const parsed = actualizarVehiculoSchema.safeParse(input);
  if (!parsed.success) return errorDeValidacion(parsed.error);

  const service = deps.vehiculoService ?? buildVehiculoService();
  try {
    return await service.actualizar(parsedId.data, parsed.data, actor);
  } catch {
    return { status: "conflict" };
  }
}

/** Borra un tipo de vehiculo (solo maestro). Bloqueado si esta en uso. */
export async function borrarVehiculo(
  id: unknown,
  deps: VehiculoActionDeps = {},
): Promise<BorrarVehiculoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return { status: "validation_error", fieldErrors: { id: ["id invalido"] } };
  }

  const service = deps.vehiculoService ?? buildVehiculoService();
  try {
    return await service.borrar(parsedId.data, actor);
  } catch {
    // La FK RESTRICT es la garantia real: si algo llego a referenciar el tipo entre
    // la comprobacion y el borrado, el fallo se cuenta como "en uso", no como error.
    return { status: "in_use" };
  }
}
