"use server";

import type {
  Actor,
  IVehiculoService,
  ListarVehiculosServiceResult,
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

// BORRADO 2026-08-07 (chore de deuda de superficie, decision humana): aqui vivia
// `obtenerVehiculo` (R9/R10/R11), y con ella su `ObtenerVehiculoResult`, el `idSchema` y el
// import de `zod`. NACIO MUERTA: `git log -S "obtenerVehiculo" -- app components` devuelve una
// lista VACIA desde `fc64e88d` (2026-07-10, feature 50). No existe pantalla de vehiculos; de
// toda la feature 50 lo unico que se consume es `listarVehiculos`, desde
// `configuracion/tarifas/page.tsx`. `IVehiculoService.obtener` NO se toca: sigue declarado y
// probado en `tests/unit/services/vehiculo-service.test.ts`, que es donde vive la autz por rol.
