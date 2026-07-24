"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { startOfDayCR } from "@/lib/utils/fecha-cr";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ILiberacionReprogramadaRepository,
  LiberadaHoyRow,
} from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";

// Feature 46 (T14/T15, R15/R16) — loader del aviso DERIVADO "Liberadas hoy
// (reprogramacion)" de la bodega responsable. NO crea tabla de notificaciones: lee las
// ordenes que el cron marco con `liberada_reprogramada_at` HOY (CR) via
// `findLiberadasHoy`. El destinatario se deriva del rol del actor (R16):
//   - maestro       -> bodega CENTRAL: `{ zona: central, estatus: en_bodega_central }`.
//   - adminSatelite  -> su bodega satelite: `{ zona: suZona, estatus: en_bodega_satelite }`.
// El mensajero previo NO es destinatario (perdio el vinculo en la liberacion, R13).
// Patron de `recepcion-satelite.ts`: `withErrorHandler` + `resolveActorFromSession` +
// inyeccion de deps (repos/actor) para tests. `unauthenticated` es el unico
// AppErrorShape posible en este borde (sin zod); el resto son resultados de dominio.

// Estatus destino de cada bodega (catalogo ya sembrado; esta feature no crea estados).
const ESTATUS_BODEGA_CENTRAL = "en_bodega_central";
const ESTATUS_BODEGA_SATELITE = "en_bodega_satelite";

export type ListarLiberadasHoyResult =
  | { status: "ok"; liberadas: LiberadaHoyRow[] }
  | { status: "forbidden" }
  | { status: "unauthenticated" };

export interface ListarLiberadasHoyDeps {
  repo?: Pick<ILiberacionReprogramadaRepository, "findLiberadasHoy">;
  zonaRepo?: Pick<IZonaRepository, "findCentralZonaId">;
  ordenRepo?: Pick<IOrdenRepository, "findUsuarioZonaId">;
  getActor?: () => Promise<Actor | null>;
  /** Inyectable en tests para fijar "hoy" CR; por defecto `startOfDayCR()`. */
  hoyCR?: Date;
}

/**
 * R15/R16: lista las ordenes liberadas HOY (CR) de la bodega del actor. Rol distinto
 * de maestro/adminSatelite -> forbidden. Sin zona (satelite sin zona / sin zona
 * central) -> lista vacia (no hay bodega que consultar). El filtro se arma SIEMPRE
 * server-side por el rol y la zona del actor, nunca por un parametro del cliente.
 */
export async function listarLiberadasHoy(
  deps: ListarLiberadasHoyDeps = {},
): Promise<ListarLiberadasHoyResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R15: antes de tocar los repos
    if (actor.rol !== "maestro" && actor.rol !== "adminSatelite") {
      return { status: "forbidden" as const }; // R16: solo la bodega responsable
    }

    const hoyCR = deps.hoyCR ?? startOfDayCR();
    const repo = deps.repo ?? new LiberacionReprogramadaRepository(getPrismaClient());

    if (actor.rol === "maestro") {
      const zonaRepo = deps.zonaRepo ?? new ZonaRepository(getPrismaClient());
      const centralZonaId = await zonaRepo.findCentralZonaId();
      if (centralZonaId === null) return { status: "ok" as const, liberadas: [] };
      const liberadas = await repo.findLiberadasHoy(
        { zonaId: centralZonaId, estatusValue: ESTATUS_BODEGA_CENTRAL },
        hoyCR,
      );
      return { status: "ok" as const, liberadas };
    }

    // adminSatelite: su bodega satelite (por su zona).
    const ordenRepo = deps.ordenRepo ?? new OrdenRepository(getPrismaClient());
    const zonaId = await ordenRepo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) return { status: "ok" as const, liberadas: [] };
    const liberadas = await repo.findLiberadasHoy(
      { zonaId, estatusValue: ESTATUS_BODEGA_SATELITE },
      hoyCR,
    );
    return { status: "ok" as const, liberadas };
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}
