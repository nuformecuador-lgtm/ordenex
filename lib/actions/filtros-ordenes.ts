"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { GeoRepository } from "@/lib/repositories/GeoRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { FiltrosOrdenesService } from "@/lib/services/FiltrosOrdenesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IFiltrosOrdenesService } from "@/lib/interfaces/services/IFiltrosOrdenesService";
import type { ObtenerCatalogoFiltrosOrdenesResult } from "@/lib/types/filtros-ordenes";

/**
 * Feature 144/B2 (R47/R52/R53) — punto de entrada del catalogo de filtros de `/ordenes`.
 *
 * Lo invoca el SERVER COMPONENT de la pagina (decision (c) del spec): una sola llamada al
 * cargar, cuyas cinco lecturas corren en paralelo dentro del service, y el resultado baja
 * al cliente por props. NO hay endpoint HTTP nuevo, ni query params, ni una consulta por
 * cada seleccion del usuario.
 *
 * Solo LECTURA de catalogos. La autorizacion la aplica el service (R52/R53), no la page.
 */
export interface FiltrosOrdenesActionDeps {
  filtrosOrdenesService?: IFiltrosOrdenesService;
  getActor?: () => Promise<Actor | null>;
}

function buildFiltrosOrdenesService(): IFiltrosOrdenesService {
  const prisma = getPrismaClient();
  return new FiltrosOrdenesService(
    new ZonaRepository(prisma),
    new UserRepository(prisma),
    new GeoRepository(prisma),
  );
}

export async function obtenerCatalogoFiltrosOrdenes(
  deps: FiltrosOrdenesActionDeps = {},
): Promise<ObtenerCatalogoFiltrosOrdenesResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  const service = deps.filtrosOrdenesService ?? buildFiltrosOrdenesService();
  return service.obtenerCatalogo(actor);
}
