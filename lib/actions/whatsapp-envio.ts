"use server";

// Integracion WhatsApp — Server Actions del mensajero: listar las plantillas ENVIABLES y
// ENVIAR una a la orden que gestiona. Mutaciones internas del propio proyecto -> Server Action
// (patron feature 36). Resuelve el actor por sesion; la propiedad de la orden la impone el
// `OrdenEnvioReader` (scope por `mensajeroAsignadoId`), no un check de rol suelto.
import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { OrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import { EnvioPlantillaWhatsappService } from "@/lib/services/EnvioPlantillaWhatsappService";
import { WhatsappCloudClient } from "@/lib/clients/whatsapp-cloud";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  EnviarPlantillaResult,
  ListarEnviablesResult,
  ListarPlantillasTextoResult,
} from "@/lib/types/whatsapp-envio";

const idSchema = z.string().min(1);

export interface WhatsappEnvioDeps {
  getActor?: () => Promise<Actor | null>;
  service?: EnvioPlantillaWhatsappService | null;
}

/** Construye el service de envio; `null` si WhatsApp no esta configurado todavia. */
function buildEnvioService(): EnvioPlantillaWhatsappService | null {
  let config;
  try {
    config = loadWhatsappConfig();
  } catch {
    return null;
  }
  const prisma = getPrismaClient();
  return new EnvioPlantillaWhatsappService({
    ordenReader: new OrdenEnvioReader(prisma),
    plantillaRepo: new PlantillaMensajeRepository(prisma),
    client: new WhatsappCloudClient({ config }),
    idiomaPorDefecto: config.templateIdioma,
  });
}

/**
 * Flujo wa.me: lista las plantillas usables (vigentes, no desactivadas) CON su cuerpo y
 * variables, para que el cliente renderice el texto y abra WhatsApp. No depende de Meta.
 */
export async function listarPlantillasParaEnvio(
  deps: WhatsappEnvioDeps = {},
): Promise<ListarPlantillasTextoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const repo = new PlantillaMensajeRepository(getPrismaClient());
  const items = await repo.listarUsablesParaTexto();
  return { status: "ok", items };
}

/**
 * Chat del mensajero (rediseno ux): plantillas ACTIVAS con su cuerpo y variables. Cruza las
 * dos lecturas que ya existen — `listarUsablesParaTexto` (aporta cuerpo/variables) y
 * `listarEnviables` (impone `estado: "activo"` + enlazada con Meta) — para ofrecer SOLO las
 * que el chat puede enviar de verdad: fuera de la ventana de 24 h `enviarPlantillaChat`
 * resuelve por `findEnviableById`, que exige exactamente ese criterio. Sin este filtro el
 * chat mostraria plantillas `pending` que fallarian con `not_found` al enviarlas.
 */
export async function listarPlantillasActivasParaEnvio(
  deps: WhatsappEnvioDeps = {},
): Promise<ListarPlantillasTextoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const repo = new PlantillaMensajeRepository(getPrismaClient());
  const [textos, enviables] = await Promise.all([
    repo.listarUsablesParaTexto(),
    repo.listarEnviables(),
  ]);
  const activas = new Set(enviables.map((p) => p.id));
  return { status: "ok", items: textos.filter((p) => activas.has(p.id)) };
}

/** Lista las plantillas enviables (activas + enlazadas con Meta) para el envio server-side por Meta. */
export async function listarPlantillasEnviables(
  deps: WhatsappEnvioDeps = {},
): Promise<ListarEnviablesResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const repo = new PlantillaMensajeRepository(getPrismaClient());
  const items = await repo.listarEnviables();
  return { status: "ok", items: items.map((p) => ({ id: p.id, nombre: p.nombre })) };
}

/** Envia la plantilla `plantillaId` a la orden `ordenId` (que debe estar asignada al mensajero). */
export async function enviarPlantillaWhatsapp(
  ordenId: unknown,
  plantillaId: unknown,
  deps: WhatsappEnvioDeps = {},
): Promise<EnviarPlantillaResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const oId = idSchema.safeParse(ordenId);
  const pId = idSchema.safeParse(plantillaId);
  if (!oId.success || !pId.success) return { status: "not_found" };

  const service = deps.service !== undefined ? deps.service : buildEnvioService();
  if (service === null) return { status: "no_configurado" };

  return service.enviar(oId.data, pId.data, actor.usuarioId);
}
