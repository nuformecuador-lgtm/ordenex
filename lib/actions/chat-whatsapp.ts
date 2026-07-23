"use server";

// Feature 109 (design §2.2, R16-R21) — Server Actions del chat del mensajero. Mutaciones
// internas del propio proyecto -> Server Action (patron feature 107 `whatsapp-envio.ts`).
// Resuelven el actor por sesion; la PROPIEDAD de la orden la impone el `OrdenEnvioReader`
// (scope por `mensajeroAsignadoId`), no un check de rol suelto. La ventana de 24 h y el
// envio los orquesta `ChatWhatsappService`; aqui solo va el borde HTTP/sesion.
import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import { ChatConversacionRepository } from "@/lib/repositories/ChatConversacionRepository";
import { ChatMensajeRepository } from "@/lib/repositories/ChatMensajeRepository";
import { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import { crearEncolarReintentoChatEnvio } from "@/lib/services/jobs/whatsapp-chat-envio-encolado";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { WhatsappCloudClient } from "@/lib/clients/whatsapp-cloud";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import type { IChatConversacionRepository } from "@/lib/interfaces/repositories/IChatConversacionRepository";
import type { IChatMensajeRepository } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type {
  EnviarMensajeChatResult,
  ListarHiloChatResult,
} from "@/lib/types/chat-whatsapp";

const idSchema = z.string().min(1);
const textoSchema = z.string().trim().min(1).max(4096);

const VENTANA_MS = 24 * 60 * 60 * 1000;

export interface ChatWhatsappDeps {
  getActor?: () => Promise<Actor | null>;
  ordenReader?: IOrdenEnvioReader;
  conversacionRepo?: IChatConversacionRepository;
  mensajeRepo?: IChatMensajeRepository;
  /** Service de envio; `null` explicito = WhatsApp no configurado. */
  service?: ChatWhatsappService | null;
  now?: () => Date;
}

/** Construye el service de envio; `null` si WhatsApp no esta configurado todavia. */
function buildEnvioService(): ChatWhatsappService | null {
  let config;
  try {
    config = loadWhatsappConfig();
  } catch {
    return null;
  }
  const prisma = getPrismaClient();
  return new ChatWhatsappService({
    conversacionRepo: new ChatConversacionRepository(prisma),
    mensajeRepo: new ChatMensajeRepository(prisma),
    client: new WhatsappCloudClient({ config }),
    encolarReintento: crearEncolarReintentoChatEnvio(new JobRepository(prisma)),
  });
}

/**
 * R17-R21: envia un TEXTO libre al cliente de la orden `ordenId`. La orden DEBE estar
 * asignada al actor (scope `OrdenEnvioReader`); si no, rechaza sin enviar (R17). El service
 * aplica la ventana de 24 h (R18/R19) y el manejo de `transitorio` (R21).
 */
export async function enviarMensajeChat(
  ordenId: unknown,
  texto: unknown,
  deps: ChatWhatsappDeps = {},
): Promise<EnviarMensajeChatResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const oId = idSchema.safeParse(ordenId);
  const txt = textoSchema.safeParse(texto);
  if (!oId.success || !txt.success) return { status: "forbidden" };

  const ordenReader = deps.ordenReader ?? new OrdenEnvioReader(getPrismaClient());
  const orden = await ordenReader.findParaEnvio(oId.data, actor.usuarioId);
  if (orden === null) return { status: "forbidden" }; // R17: inexistente o de otro mensajero

  const service = deps.service !== undefined ? deps.service : buildEnvioService();
  if (service === null) return { status: "no_configurado" };

  const outcome = await service.enviarTexto({
    ordenId: oId.data,
    mensajeroId: actor.usuarioId,
    telefonoE164: orden.telefonoDest,
    texto: txt.data,
  });

  if (outcome.status === "ok") return { status: "ok", mensajeChatId: outcome.mensajeChatId };
  if (outcome.status === "fuera_ventana") return { status: "fuera_ventana" };
  // R21: transitorio -> ya persistido `queued` y encolado; la UI lo trata como reintentable.
  // No se filtra el detalle del cliente (podria ecoar el destino): solo el desenlace.
  return { status: "transitorio", mensajeChatId: outcome.mensajeChatId };
}

/**
 * R16/R22/R24: lista el hilo de la orden `ordenId` para el mensajero asignado. La UI la
 * consume tambien para el refresco (D5). Nunca devuelve hilos de otras ordenes (R16).
 */
export async function listarHiloChat(
  ordenId: unknown,
  deps: ChatWhatsappDeps = {},
): Promise<ListarHiloChatResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const oId = idSchema.safeParse(ordenId);
  if (!oId.success) return { status: "forbidden" };

  const prisma = getPrismaClient();
  const ordenReader = deps.ordenReader ?? new OrdenEnvioReader(prisma);
  // R16: la propiedad de la orden es la puerta; sin ella no se lee ningun hilo.
  const orden = await ordenReader.findParaEnvio(oId.data, actor.usuarioId);
  if (orden === null) return { status: "forbidden" };

  const conversacionRepo = deps.conversacionRepo ?? new ChatConversacionRepository(prisma);
  const hilo = await conversacionRepo.findByOrdenParaMensajero(oId.data, actor.usuarioId);
  if (hilo === null) {
    // Orden del mensajero pero aun sin hilo: hilo vacio, ventana cerrada (sin entrantes).
    return { status: "ok", ventanaAbierta: false, ultimoEntranteAt: null, mensajes: [] };
  }

  const mensajeRepo = deps.mensajeRepo ?? new ChatMensajeRepository(prisma);
  const mensajes = await mensajeRepo.listarHilo(hilo.id);
  const ahora = (deps.now ?? (() => new Date()))().getTime();
  const ventanaAbierta =
    hilo.ultimoEntranteAt !== null &&
    ahora - hilo.ultimoEntranteAt.getTime() < VENTANA_MS;

  return {
    status: "ok",
    ventanaAbierta,
    ultimoEntranteAt: hilo.ultimoEntranteAt?.toISOString() ?? null,
    mensajes: mensajes.map((m) => ({
      id: m.id,
      direccion: m.direccion,
      tipo: m.tipo,
      cuerpo: m.cuerpo,
      estado: m.estado,
      ocurridoAt: m.ocurridoAt.toISOString(),
    })),
  };
}
