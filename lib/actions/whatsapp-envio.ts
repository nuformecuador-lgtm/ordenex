"use server";

// Integracion WhatsApp — Server Actions del mensajero: LISTAR las plantillas que puede usar,
// para que el cliente renderice el texto y abra WhatsApp por el camino wa.me. Mutaciones
// internas del propio proyecto -> Server Action (patron feature 36). Resuelve el actor por
// sesion.
//
// El ENVIO SERVER-SIDE POR META se borro de aqui el 2026-08-07 por decision humana
// (`enviarPlantillaWhatsapp` + `listarPlantillasEnviables`): nunca tuvo boton — `git log -S`
// sobre `app/` y `components/` devuelve CERO commits en toda su vida — y la UI que existe usa
// el camino wa.me. Lo que se manda por Meta de verdad va por `lib/actions/chat-whatsapp.ts`.
import { getPrismaClient } from "@/lib/db/prisma-client";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ListarPlantillasTextoResult } from "@/lib/types/whatsapp-envio";

export interface WhatsappEnvioDeps {
  getActor?: () => Promise<Actor | null>;
}

/**
 * Flujo wa.me DEL MENSAJERO: lista las plantillas usables (vigentes, no desactivadas) CON su
 * cuerpo y variables, para que el cliente renderice el texto y abra WhatsApp. No depende de Meta.
 *
 * SIN las plantillas de tienda (`incluirDeTienda: false`, 2026-08-27): esas no son del
 * mensajero. Se crean para que el admin de la tienda las mande desde `/novedades` y por eso no
 * se envian a Meta; ofrecerselas aqui las pondria en manos de quien no las escribio.
 */
export async function listarPlantillasParaEnvio(
  deps: WhatsappEnvioDeps = {},
): Promise<ListarPlantillasTextoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const repo = new PlantillaMensajeRepository(getPrismaClient());
  const items = await repo.listarUsablesParaTexto({ incluirDeTienda: false });
  return { status: "ok", items };
}

/**
 * Flujo wa.me DEL ADMIN DE TIENDA (`/novedades`): lo mismo que arriba pero CON las plantillas
 * de tienda, que es la unica superficie donde se pueden usar.
 *
 * Es una accion aparte y no un parametro de la de arriba a proposito: "que plantillas me
 * tocan" lo decide la SUPERFICIE, y un booleano viajando desde el cliente seria justo la
 * forma de que el panel del mensajero pidiera las de tienda con un `true`.
 */
export async function listarPlantillasParaEnvioTienda(
  deps: WhatsappEnvioDeps = {},
): Promise<ListarPlantillasTextoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const repo = new PlantillaMensajeRepository(getPrismaClient());
  const items = await repo.listarUsablesParaTexto({ incluirDeTienda: true });
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
    // El chat es superficie del mensajero: nunca las de tienda. Ademas `listarEnviables`
    // exige `templateId`, que una plantilla de tienda no tiene, asi que el cruce ya las
    // dejaba fuera; se dice explicito para que la razon no dependa de ese efecto lateral.
    repo.listarUsablesParaTexto({ incluirDeTienda: false }),
    repo.listarEnviables(),
  ]);
  const activas = new Set(enviables.map((p) => p.id));
  return { status: "ok", items: textos.filter((p) => activas.has(p.id)) };
}

// OJO AL NOMBRE. Aqui vivian `listarPlantillasEnviables` y `enviarPlantillaWhatsapp` (el camino
// Meta), borradas el 2026-08-07. Las DOS que quedan arriba se llaman casi igual y estan VIVAS:
// `listarPlantillasParaEnvio` la llama `components/shared/EnviarPlantillaWhatsappButton.tsx` y
// `listarPlantillasActivasParaEnvio` la llama `chat/ChatConversacion.tsx:21`.
// `repo.listarEnviables()` tampoco murio: lo sigue usando `listarPlantillasActivasParaEnvio`
// para quedarse solo con las plantillas que Meta aceptaria.
