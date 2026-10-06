"use server";

// Ficha 476 (design §5, R3/R4) — las tiendas que ofrece el panel de parametros del picking.
//
// Solo `maestro` (mismo criterio que la configuracion de envios, R1 de la 474) y el rol se mira
// ANTES de construir el repositorio (R4: un no-maestro no lee ninguna orden). SOLO LECTURA. Los
// conteos salen de `resumenTiendasPicking`, con la MISMA definicion de «atrasada» que el PDF.
import { z } from "zod";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPickingRepository } from "@/lib/interfaces/repositories/IPickingRepository";
import type { ListarTiendasPickingResult } from "@/lib/whatsapp-envios/informes/picking/tipos";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { PickingRepository } from "@/lib/repositories/PickingRepository";
import { diasAtrasoSchema } from "@/lib/whatsapp-envios/informes/picking/parametros";
import { resumenTiendasPicking } from "@/lib/whatsapp-envios/informes/picking/informe";

/** Dependencias inyectables (tests). En produccion: sesion, repo real (perezoso) y reloj. */
export interface ListarTiendasPickingDeps {
  getActor?: () => Promise<Actor | null>;
  repo?: () => IPickingRepository;
  now?: () => Date;
}

const ROLES_PERMITIDOS = new Set<string>(["maestro"]);

const entradaSchema = z.object({ diasAtraso: diasAtrasoSchema }).strict();

/**
 * R3 — tiendas `adminTienda` con fulfillment, por nombre, con sus ordenes en preparacion y las que
 * llevan mas de `diasAtraso` dias.
 *
 * @sin-superficie 476: la monta el panel `picking` de ParametrosInforme, que hace frontend_dev (F5) en esta misma ficha; quitar esta anotacion al montarlo.
 */
export async function listarTiendasPicking(
  input: unknown,
  deps: ListarTiendasPickingDeps = {},
): Promise<ListarTiendasPickingResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  if (!ROLES_PERMITIDOS.has(actor.rol)) return { status: "forbidden" };

  const p = entradaSchema.safeParse(input);
  if (!p.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of p.error.issues) {
      const campo = issue.path.length > 0 ? issue.path.join(".") : "diasAtraso";
      (fieldErrors[campo] ??= []).push(issue.message);
    }
    return { status: "validation_error", fieldErrors };
  }
  const repo = (deps.repo ?? (() => new PickingRepository(getPrismaClient())))();
  const ahora = (deps.now ?? (() => new Date()))();
  return { status: "ok", tiendas: await resumenTiendasPicking(repo, ahora, p.data.diasAtraso) };
}
