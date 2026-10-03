"use server";

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { ICoberturaService } from "@/lib/interfaces/services/ICoberturaService";
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import { CoberturaRepository } from "@/lib/repositories/CoberturaRepository";
import { CoberturaService } from "@/lib/services/CoberturaService";
import type { CoberturaDistritoDTO } from "@/lib/types/cobertura";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";

// Ficha 465 (design §3.5) — Server Action del Excel de cobertura por distrito. De SOLO LECTURA
// (R21). No recibe entrada externa, asi que no hay zod que validar.

/** Dependencias inyectables del borde (patron `GeografiaActionDeps`), solo para probar. */
export interface CoberturaActionDeps {
  coberturaService?: ICoberturaService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * EL COMPOSITION ROOT: el unico sitio que construye el servicio y le PASA su repositorio real.
 * `tests/unit/actions/cobertura.composition-root.test.ts` comprueba que de verdad llega.
 */
function buildCoberturaService(): ICoberturaService {
  return new CoberturaService(new CoberturaRepository(getPrismaClient()));
}

/**
 * Una fila de dominio por distrito del catalogo (R4), clasificada y ordenada. Lee en cada
 * llamada. Sin sesion -> `unauthenticated` sin construir el servicio (R3); rol distinto de
 * maestro -> `forbidden` (R2).
 *
 * Superficie: `DescargarCoberturaButton` en `/configuracion/tarifas` (ficha 465, T8-T9).
 */
export async function listarCoberturaDistritos(
  deps: CoberturaActionDeps = {},
): Promise<ListarCompletoResult<CoberturaDistritoDTO>> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  const service = deps.coberturaService ?? buildCoberturaService();
  return service.listar(actor);
}
