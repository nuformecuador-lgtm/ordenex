// Feature 311 (design §5, R15/R21/R22/R23/R24/R25/R26) — PROXY de media del chat.
//
// Sirve el binario que el cliente mando por WhatsApp, bajandolo de la Graph API con el token del
// SERVIDOR. No se almacena nada (D1/R15): no hay bucket, ni disco, ni columna binaria; solo el
// `media_id` de Meta en la fila y esta ruta, que lo consume bajo demanda.
//
// POR QUE UN ROUTE HANDLER Y NO UNA SERVER ACTION: esto entrega un BINARIO con sus cabeceras
// (`Content-Type`, `Content-Disposition`, `nosniff`), no una mutacion — ver la tabla "Server
// Actions vs Route Handlers" de `docs/architecture.md`.
//
// POR QUE EL ID INTERNO DEL MENSAJE EN LA URL Y NO EL MEDIA ID DE META: el id interno es
// AUTORIZABLE (de el se llega a conversacion -> orden -> mensajero asignado), mientras que un
// media id de Meta es un identificador global sin dueño en nuestro modelo; ademas asi el media id
// no aparece jamas en una URL, un log de acceso ni el historial del navegador (R21/R35).
//
// MIDDLEWARE (R26): esta ruta NO se añade a `PUBLIC_ROUTES` ni a `SELF_AUTH_ROUTES`.
// `/api/chat/media/...` no casa con ninguna entrada de esas listas, asi que el guard de sesion la
// cubre por defecto y la guardia de la feature 229 —que compara `PUBLIC_ROUTES` posicionalmente
// contra una lista firmada— no se roza. La autorizacion REAL (propiedad de la orden) vive aqui.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ChatMensajeRepository } from "@/lib/repositories/ChatMensajeRepository";
import { WhatsappMediaClient } from "@/lib/clients/whatsapp-media";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";
import { CACHE_CONTROL_MEDIA } from "@/lib/config/chat-media";
import { contentDisposition, contentTypeSeguro } from "@/lib/utils/chat-media-headers";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IChatMensajeRepository } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { WhatsappMediaDescargador } from "@/lib/clients/whatsapp-media";

// Prisma + sesion: no corre en el edge.
export const runtime = "nodejs";

/** El id del mensaje es un uuid; cualquier otra cosa ni siquiera llega a la base. */
const mensajeIdSchema = z.uuid();

export interface ChatMediaRouteDeps {
  getActor?: () => Promise<Actor | null>;
  mensajeRepo?: Pick<IChatMensajeRepository, "findMediaParaMensajero">;
  /** `null` explicito = WhatsApp sin credenciales; se responde 502 sin tocar la red. */
  descargador?: WhatsappMediaDescargador | null;
}

/** Construye el descargador; `null` si la credencial de WhatsApp no esta configurada. */
function buildDescargador(): WhatsappMediaDescargador | null {
  try {
    return new WhatsappMediaClient({ config: loadWhatsappConfig() });
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ mensajeId: string }> },
  deps: ChatMediaRouteDeps = {},
): Promise<Response> {
  // 1) Sesion. Sin actor no se toca la Graph API NI la base (R22).
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (actor === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { mensajeId } = await ctx.params;
  const parsed = mensajeIdSchema.safeParse(mensajeId);
  // Un id con formato invalido se trata como ajeno, no como error de validacion: distinguirlos
  // le diria a quien sondea cuales existen.
  if (!parsed.success) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 2) Propiedad de la orden. MISMA puerta que `listarHilo` (R16/R17 de la 109): una sola query
  //    que solo devuelve fila si la orden del mensaje esta asignada a ESTE mensajero. Sin fila,
  //    403 sin llamar a la Graph API (R23).
  const repo = deps.mensajeRepo ?? new ChatMensajeRepository(getPrismaClient());
  const media = await repo.findMediaParaMensajero(parsed.data, actor.usuarioId);
  if (media === null) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 3) El mensaje es suyo pero no tiene adjunto (un texto, una ubicacion, una reaccion).
  if (media.mediaId === null) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const descargador = deps.descargador !== undefined ? deps.descargador : buildDescargador();
  if (descargador === null) {
    return NextResponse.json({ error: "no_configurado" }, { status: 502 });
  }

  const outcome = await descargador.descargar(media.mediaId);

  // R24/D2: "estuvo aqui y ya no esta" es literalmente lo que significa 410, y es un desenlace
  // PROPIO y distinguible para que la UI diga que el archivo ya no esta disponible en vez de
  // pintar un icono roto. Meta borra el binario a los 30 dias.
  if (outcome.status === "expirado") {
    return NextResponse.json({ error: "expirado" }, { status: 410 });
  }
  if (outcome.status === "error") {
    // El detalle del cliente cita operacion y codigo HTTP, nunca el token ni el media id; aun
    // asi no se reenvia al navegador: el mensajero no puede hacer nada con el.
    return NextResponse.json({ error: "graph_api" }, { status: 502 });
  }

  // El MIME de Meta manda sobre el guardado, pero solo como INSUMO: `contentTypeSeguro` lo
  // reduce a la lista blanca o a `octet-stream`, y `nosniff` impide que el navegador adivine.
  const mime = outcome.mime ?? media.mediaMime;
  const descarga = new URL(request.url).searchParams.get("descarga") === "1";

  const headers = new Headers({
    "Content-Type": contentTypeSeguro(mime),
    "Content-Disposition": contentDisposition(mime, media.mediaNombre, descarga),
    "X-Content-Type-Options": "nosniff",
    // NUNCA `public`: el binario es PII del cliente y no puede quedar en una CDN compartida.
    "Cache-Control": CACHE_CONTROL_MEDIA,
  });
  if (outcome.tamano !== null && Number.isFinite(outcome.tamano)) {
    headers.set("Content-Length", String(outcome.tamano));
  }

  // Passthrough del stream de Meta (design §5.3): no se bufferiza y, sobre todo, no se escribe
  // en ningun almacenamiento propio (R15).
  return new Response(outcome.cuerpo, { status: 200, headers });
}
