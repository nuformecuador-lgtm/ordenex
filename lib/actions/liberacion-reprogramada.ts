"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { startOfDayCR } from "@/lib/utils/fecha-cr";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ILiberacionReprogramadaRepository,
  LiberadaHoyRow,
} from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
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
  /**
   * Feature 160 (R11/R27): derivador de intentos EN LOTE. Va como dep del BORDE y no como
   * dependencia de constructor de `LiberacionReprogramadaService` porque —contra lo que asumia
   * `design.md §3.5`— ese servicio NO tiene metodo de listado: el aviso "liberadas hoy" se
   * arma AQUI, leyendo `findLiberadasHoy` directamente (patron pre-existente de este loader).
   * Meter la dep en el servicio del cron obligaria a que las 2 rutas de cron que lo instancian
   * cargaran un derivador que nunca usan. El CRITERIO sigue viviendo en el servicio; aqui solo
   * se mergea el mapa.
   */
  historial?: Pick<IOrdenHistorialService, "contarIntentosEnLote">;
  getActor?: () => Promise<Actor | null>;
  /** Inyectable en tests para fijar "hoy" CR; por defecto `startOfDayCR()`. */
  hoyCR?: Date;
}

/** Wiring de produccion del derivador de intentos (feature 160). */
function buildHistorialService(): Pick<IOrdenHistorialService, "contarIntentosEnLote"> {
  const prisma = getPrismaClient();
  return new OrdenHistorialService(
    new OrdenRepository(prisma),
    new OrdenHistorialRepository(prisma),
  );
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

    // Feature 160 (R11/R14/R27): mergea el conteo de intentos sobre las filas YA acotadas por
    // el rol/zona del actor, con UNA sola consulta al historial (R12) y `?? 0` (el `0` SIEMPRE
    // se expone, R14/R19). Lista vacia -> 0 consultas (R13, guarda del propio derivador).
    const historial = deps.historial ?? buildHistorialService();
    const conIntentos = async (rows: LiberadaHoyRow[]): Promise<LiberadaHoyRow[]> => {
      const intentos = await historial.contarIntentosEnLote(rows.map((r) => r.id));
      return rows.map((r) => ({ ...r, intentosEntrega: intentos.get(r.id) ?? 0 }));
    };

    if (actor.rol === "maestro") {
      const zonaRepo = deps.zonaRepo ?? new ZonaRepository(getPrismaClient());
      const centralZonaId = await zonaRepo.findCentralZonaId();
      if (centralZonaId === null) return { status: "ok" as const, liberadas: [] };
      const liberadas = await repo.findLiberadasHoy(
        { zonaId: centralZonaId, estatusValue: ESTATUS_BODEGA_CENTRAL },
        hoyCR,
      );
      return { status: "ok" as const, liberadas: await conIntentos(liberadas) };
    }

    // adminSatelite: su bodega satelite (por su zona).
    const ordenRepo = deps.ordenRepo ?? new OrdenRepository(getPrismaClient());
    const zonaId = await ordenRepo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) return { status: "ok" as const, liberadas: [] };
    const liberadas = await repo.findLiberadasHoy(
      { zonaId, estatusValue: ESTATUS_BODEGA_SATELITE },
      hoyCR,
    );
    return { status: "ok" as const, liberadas: await conIntentos(liberadas) };
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}
