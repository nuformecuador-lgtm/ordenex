// Feature 109 (design §2.1, R1-R12) — Route Handler del WEBHOOK de entrada de WhatsApp.
// Capa Controller: solo HTTP + verificacion (handshake GET / firma HMAC POST); delega TODA
// la ingesta en `ChatWhatsappService`. Sin queries ni logica de negocio aqui.
//
// INVARIANTE DE SEGURIDAD (R11): NUNCA se loguea el token de verificacion, el App Secret,
// la firma, ni el numero del cliente ni otro dato personal, en NINGUNA rama.
//
// El endpoint NO usa cookie de sesion: su autenticacion es la firma HMAC (POST) y el token
// de verificacion (GET). Excluido del guard de sesion en `middleware.ts` (R10).
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { loadWhatsappWebhookConfig } from "@/lib/config/whatsapp";
import type { WhatsappWebhookConfig } from "@/lib/config/whatsapp";
import { parseWebhookEventos } from "@/lib/types/whatsapp-webhook";
import { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import type { ChatLogger } from "@/lib/services/ChatWhatsappService";
import { ChatConversacionRepository } from "@/lib/repositories/ChatConversacionRepository";
import { ChatMensajeRepository } from "@/lib/repositories/ChatMensajeRepository";
import { crearEncolarReintentoChatEnvio } from "@/lib/services/jobs/whatsapp-chat-envio-encolado";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { consoleLogger, volcarStatusesFallidos } from "@/lib/services/whatsapp/chat-logger";
import { getPrismaClient } from "@/lib/db/prisma-client";

// El runtime de Node es OBLIGATORIO: `node:crypto` (HMAC) y Prisma no corren en edge.
export const runtime = "nodejs";

const SIGNATURE_HEADER = "x-hub-signature-256";
const SIGNATURE_PREFIX = "sha256=";

export interface WebhookDeps {
  /** Config del webhook (verifyToken + appSecret). Lanza si falta un env (R12). */
  getConfig?: () => WhatsappWebhookConfig;
  /** Service de ingesta (inyectable en tests). Por defecto construye las deps reales. */
  buildService?: () => ChatWhatsappService;
  /** Logger del volcado de diagnostico (inyectable en tests). Default `console.warn`. */
  logger?: ChatLogger;
}

/** Construye el service de ingesta con las deps reales (repos + encolador del reintento). */
function buildIngestaService(): ChatWhatsappService {
  const prisma = getPrismaClient();
  return new ChatWhatsappService({
    conversacionRepo: new ChatConversacionRepository(prisma),
    mensajeRepo: new ChatMensajeRepository(prisma),
    // El webhook solo INGIERE: no envia. Sin cliente de envio (la ingesta no lo usa).
    encolarReintento: crearEncolarReintentoChatEnvio(new JobRepository(prisma)),
    // Diagnostico de los `failed`: codigo/motivo de Meta al log, sin PII (R11).
    logger: consoleLogger,
  });
}

/**
 * GET — handshake de verificacion de Meta (R1/R2). Sin tocar la DB. Responde el `challenge`
 * como texto plano SOLO si `mode==="subscribe"` y el token coincide; en cualquier otro caso
 * (o si el webhook no esta configurado) responde 403 y NUNCA devuelve el challenge.
 */
export async function handleGet(req: Request, deps: WebhookDeps = {}): Promise<Response> {
  let config: WhatsappWebhookConfig;
  try {
    config = (deps.getConfig ?? loadWhatsappWebhookConfig)();
  } catch {
    // Sin token configurado no se puede verificar; se rechaza sin filtrar el nombre al cliente.
    return new Response("forbidden", { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token !== null && challenge !== null && token === config.verifyToken) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("forbidden", { status: 403 });
}

/**
 * POST — ingesta firmada (R3-R9/R11). Lee el cuerpo CRUDO ANTES de parsear; verifica la
 * firma `X-Hub-Signature-256` en tiempo constante (R3/R4). Firma invalida/ausente -> 401
 * sin efectos. Firma valida -> zod strip (R5) -> delega en el service (R6/R7/R8) -> 200,
 * aunque un evento no mapee a hilo (R9). Nunca loguea secretos ni PII (R11).
 */
export async function handlePost(req: Request, deps: WebhookDeps = {}): Promise<Response> {
  let config: WhatsappWebhookConfig;
  try {
    config = (deps.getConfig ?? loadWhatsappWebhookConfig)();
  } catch {
    // Sin App Secret no hay como verificar la firma: se rechaza como no autorizado.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // R3/R4: la firma se valida SOBRE EL CUERPO CRUDO, ANTES de cualquier parseo.
  const raw = await req.text();
  const provided = req.headers.get(SIGNATURE_HEADER);
  if (!firmaValida(raw, provided, config.appSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // R5: parseo + zod strip. Un cuerpo mal formado no rompe el 200 (evento no accionable, R9).
  let eventos;
  try {
    eventos = parseWebhookEventos(JSON.parse(raw));
  } catch (error) {
    // Depuracion de tipos no soportados: el cuerpo no parsea, asi que se vuelca el error
    // COMPLETO junto con el crudo tal como llego. Excepcion consciente a R11.
    console.log("WP - type other", { error, raw });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Depuracion: cuando el lote trae al menos un entrante que NO mapea a un tipo conocido
  // (`otro`: image, audio, sticker, interactive, ...), se imprime la data entrante ENTERA
  // para poder ver que manda Meta —el borde tipado hace zod strip y la descarta—.
  if (eventos.mensajes.some((m) => m.tipo === "otro")) {
    try {
      console.log("WP - type other", JSON.parse(raw));
    } catch (error) {
      console.log("WP - type other", { error, raw });
    }
  }

  // Volcado de diagnostico ANTES de ingerir: si la ingesta fallara, el motivo del `failed`
  // ya quedo en el log. Solo actua sobre statuses `failed` y redacta al destinatario.
  volcarStatusesFallidos(JSON.parse(raw), deps.logger ?? consoleLogger);

  const service = deps.buildService ? deps.buildService() : buildIngestaService();
  const resumen = await service.ingerirEventos(eventos);

  // R9: 200 con conteos agregados (sin PII). Meta no reintenta.
  return NextResponse.json({ ok: true, ...resumen }, { status: 200 });
}

/**
 * Verifica el HMAC-SHA256 del cuerpo crudo contra la cabecera `X-Hub-Signature-256`
 * (`sha256=<hex>`) en tiempo constante (`timingSafeEqual`). Ausente/mal formada/longitud
 * distinta -> false, sin lanzar (R4).
 */
function firmaValida(raw: string, provided: string | null, appSecret: string): boolean {
  if (provided === null || !provided.startsWith(SIGNATURE_PREFIX)) return false;
  const esperado = createHmac("sha256", appSecret).update(raw, "utf8").digest();
  let recibido: Buffer;
  try {
    recibido = Buffer.from(provided.slice(SIGNATURE_PREFIX.length), "hex");
  } catch {
    return false;
  }
  if (recibido.length !== esperado.length) return false;
  return timingSafeEqual(recibido, esperado);
}

export async function GET(req: Request): Promise<Response> {
  return handleGet(req);
}

export async function POST(req: Request): Promise<Response> {
  return handlePost(req);
}
