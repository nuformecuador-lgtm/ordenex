"use server";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ListarOrderStatusResult } from "@/lib/types/order-status";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

// Feature 63/R2: roles autorizados para leer el catalogo `order_status` = "todos
// excepto mensajero" (maestro/admin/adminTienda/adminSatelite). Cualquier otro rol
// (incluido `mensajero`) -> forbidden (R4). Set explicito, no una negacion de
// `mensajero`, para que un rol futuro desconocido caiga a forbidden por defecto.
const ROLES_CATALOGO = new Set<string>([
  "maestro",
  "admin",
  "adminTienda",
  "adminSatelite",
]);

function buildOrdenRepoParaCatalogo(): Pick<IOrdenRepository, "listOrderStatus"> {
  return new OrdenRepository(getPrismaClient());
}

export interface ListarOrderStatusDeps {
  ordenRepo?: Pick<IOrdenRepository, "listOrderStatus">;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Feature 63/A2 (R1-R5): lista el catalogo `order_status` (id, value) para las
 * tabs de ordenes. Nacio como accion NUEVA e independiente de `listarCatalogoEstatus()`
 * (feature 17, `lib/actions/ordenes-guia.ts`) para NO relajar la autorizacion de aquella,
 * que era solo maestro/admin. Desde el 2026-08-07 aquella ya no existe —se borro por
 * quedarse sin consumidor tras `54757be4`— y esta es la UNICA lectura del catalogo:
 * la autz es "todos excepto mensajero" (R2/R4). Sin sesion -> unauthenticated
 * (R3). Reusa `IOrdenRepository.listOrderStatus()`, que garantiza orden
 * determinista (R5). `deps` inyectables (`getActor`, `ordenRepo`) para test.
 */
export async function listarOrderStatus(
  deps: ListarOrderStatusDeps = {},
): Promise<ListarOrderStatusResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R3: sin datos, repo NO se llama
  if (!ROLES_CATALOGO.has(actor.rol)) return { status: "forbidden" }; // R4: mensajero/otro

  const repo = deps.ordenRepo ?? buildOrdenRepoParaCatalogo();
  const estatus = await repo.listOrderStatus(); // R1/R2, orden determinista R5
  return { status: "ok", estatus };
}
