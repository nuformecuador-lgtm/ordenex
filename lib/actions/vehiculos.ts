"use server";

import { z } from "zod";
import type {
  Actor,
  IVehiculoService,
  ListarVehiculosServiceResult,
  ObtenerVehiculoServiceResult,
} from "@/lib/interfaces/services/IVehiculoService";
import { VehiculoService } from "@/lib/services/VehiculoService";
import { VehiculoRepository } from "@/lib/repositories/VehiculoRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

// Resultados expuestos por la Server Action: los del service + `unauthenticated`
// (sin sesion valida). P1=A: solo lectura, sin escritura (T7 omitida, R12 N/A).
export type ListarVehiculosResult =
  | ListarVehiculosServiceResult
  | { status: "unauthenticated" };

export type ObtenerVehiculoResult =
  | ObtenerVehiculoServiceResult
  | { status: "unauthenticated" };

const idSchema = z.string().min(1);

function buildVehiculoService(): IVehiculoService {
  const prisma = getPrismaClient();
  return new VehiculoService(new VehiculoRepository(prisma));
}

export interface VehiculoActionDeps {
  vehiculoService?: IVehiculoService;
  getActor?: () => Promise<Actor | null>;
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

/**
 * R9/R10/R11: obtener una fila del catalogo por id (solo maestro).
 *
 * @sin-superficie no existe pantalla de vehiculos: de la feature 50 solo se consume `listarVehiculos`, desde `configuracion/tarifas/page.tsx`. Sin consumidor desde fc64e88d (2026-07-10). Deuda inocua (lectura de un catalogo de solo lectura), pendiente de decidir si se borra.
 */
export async function obtenerVehiculo(
  id: unknown,
  deps: VehiculoActionDeps = {},
): Promise<ObtenerVehiculoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R10
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { status: "not_found" };
  const service = deps.vehiculoService ?? buildVehiculoService();
  return service.obtener(parsedId.data, actor);
}
