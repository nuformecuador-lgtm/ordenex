"use server";

// Integracion WhatsApp — Server Action PERMANENTE para que el maestro dispare a mano la
// sincronizacion de plantillas (Meta -> local) desde la vista de plantillas, sin esperar al
// cron de 24 h. Gateada a rol `maestro` (mismo criterio que el CRUD de plantillas).
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { WhatsappPlantillasClient } from "@/lib/clients/whatsapp-cloud";
import {
  SincronizarPlantillasWhatsappService,
  type SincronizarPlantillasResult,
} from "@/lib/services/SincronizarPlantillasWhatsappService";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";
import { defaultLogger } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const ALLOWED_ROLES = new Set<string>(["maestro"]);

export type SincronizarPlantillasActionResult =
  | ({ status: "ok" } & SincronizarPlantillasResult)
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "no_configurado" } // faltan credenciales de WhatsApp
  | { status: "error"; detalle: string }; // Meta rechazo o no respondio

export interface SincronizarPlantillasDeps {
  getActor?: () => Promise<Actor | null>;
}

export async function sincronizarPlantillasWhatsapp(
  deps: SincronizarPlantillasDeps = {},
): Promise<SincronizarPlantillasActionResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // solo maestro

  let config;
  try {
    config = loadWhatsappConfig();
  } catch {
    return { status: "no_configurado" };
  }

  const service = new SincronizarPlantillasWhatsappService(
    new WhatsappPlantillasClient({ config }),
    new PlantillaMensajeRepository(getPrismaClient()),
  );

  try {
    const r = await service.sincronizar();
    return { status: "ok", ...r };
  } catch (error) {
    // Fallo de red/auth con Meta: se registra en el servidor (sin secretos) y se reporta.
    defaultLogger.logError(error);
    return {
      status: "error",
      detalle: error instanceof Error ? error.message : "error desconocido",
    };
  }
}
