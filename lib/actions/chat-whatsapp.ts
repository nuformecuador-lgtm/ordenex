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
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { WhatsappCloudClient } from "@/lib/clients/whatsapp-cloud";
import { consoleLogger } from "@/lib/services/whatsapp/chat-logger";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { construirComponentsEnvio } from "@/lib/utils/whatsapp-template";
import { resolverValoresPlantilla } from "@/lib/types/plantilla-datos";
import { renderPlantilla } from "@/lib/utils/plantilla-mensaje";
import { fechaCalendarioCR, inicioDelDiaCREnUtc } from "@/lib/utils/fecha-cr";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import type { IChatConversacionRepository } from "@/lib/interfaces/repositories/IChatConversacionRepository";
import type { IChatMensajeRepository } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { IPlantillaMensajeRepository } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import { agregarReacciones } from "@/lib/utils/chat-reacciones";
import type {
  EnviarMensajeChatResult,
  EnviarPlantillaChatResult,
  ListarHiloChatResult,
  MarcarChatLeidoResult,
  ResumenNoLeidosChatResult,
} from "@/lib/types/chat-whatsapp";

const idSchema = z.string().min(1);
const textoSchema = z.string().trim().min(1).max(4096);

const VENTANA_MS = 24 * 60 * 60 * 1000;

export interface ChatWhatsappDeps {
  getActor?: () => Promise<Actor | null>;
  ordenReader?: IOrdenEnvioReader;
  conversacionRepo?: IChatConversacionRepository;
  mensajeRepo?: IChatMensajeRepository;
  /** Repo de plantillas (solo lo usa `enviarPlantillaChat`). */
  plantillaRepo?: Pick<IPlantillaMensajeRepository, "findEnviableById">;
  /** Service de envio; `null` explicito = WhatsApp no configurado. */
  service?: ChatWhatsappService | null;
  /** Idioma por defecto si el template local no trae idioma sincronizado. */
  idiomaPorDefecto?: string;
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
    client: new WhatsappCloudClient({ config, logger: consoleLogger }),
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
  const datos = await ordenReader.findParaEnvio(oId.data, actor.usuarioId);
  if (datos === null) return { status: "forbidden" }; // R17: inexistente o de otro mensajero

  const service = deps.service !== undefined ? deps.service : buildEnvioService();
  if (service === null) return { status: "no_configurado" };

  const outcome = await service.enviarTexto({
    ordenId: oId.data,
    mensajeroId: actor.usuarioId,
    telefonoE164: datos.orden.telefonoDest,
    texto: txt.data,
  });

  if (outcome.status === "ok") return { status: "ok", mensajeChatId: outcome.mensajeChatId };
  if (outcome.status === "fuera_ventana") return { status: "fuera_ventana" };
  // Rechazo determinista de la Graph API: el saliente ya quedo `failed` con su motivo y NO
  // hay reintento. Se devuelve el detalle porque es justo lo que hace falta para corregir
  // (plantilla, idioma, parametros); el cliente ya lo redacta de secretos.
  if (outcome.status === "permanente") {
    return { status: "permanente", mensajeChatId: outcome.mensajeChatId, detalle: outcome.detalle };
  }
  // R21: transitorio -> ya persistido `queued` y encolado; la UI lo trata como reintentable.
  // No se filtra el detalle del cliente (podria ecoar el destino): solo el desenlace.
  return { status: "transitorio", mensajeChatId: outcome.mensajeChatId };
}

/** Idioma por defecto de los templates si la config esta disponible; `undefined` si no. */
function idiomaPorDefectoDeConfig(): string | undefined {
  try {
    return loadWhatsappConfig().templateIdioma;
  } catch {
    return undefined;
  }
}

/**
 * Envia la PLANTILLA `plantillaId` al cliente de la orden `ordenId` y la persiste en el hilo
 * del chat (`tipo=plantilla`). La orden DEBE estar asignada al actor (scope `OrdenEnvioReader`,
 * R16/R17); si no, rechaza sin enviar. A diferencia del texto libre, una plantilla se puede
 * enviar DENTRO y FUERA de la ventana de 24 h: aqui NO se aplica el bloqueo de ventana. El
 * `transitorio` se maneja como el texto libre (persiste `queued` + encola reintento, R21).
 */
export async function enviarPlantillaChat(
  ordenId: unknown,
  plantillaId: unknown,
  deps: ChatWhatsappDeps = {},
): Promise<EnviarPlantillaChatResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const oId = idSchema.safeParse(ordenId);
  const pId = idSchema.safeParse(plantillaId);
  if (!oId.success || !pId.success) return { status: "forbidden" };

  const prisma = getPrismaClient();
  const ordenReader = deps.ordenReader ?? new OrdenEnvioReader(prisma);
  const datos = await ordenReader.findParaEnvio(oId.data, actor.usuarioId);
  if (datos === null) return { status: "forbidden" }; // R17: inexistente o de otro mensajero

  const plantillaRepo = deps.plantillaRepo ?? new PlantillaMensajeRepository(prisma);
  const plantilla = await plantillaRepo.findEnviableById(pId.data);
  if (plantilla === null) return { status: "not_found" }; // no existe o no es enviable

  const service = deps.service !== undefined ? deps.service : buildEnvioService();
  if (service === null) return { status: "no_configurado" };

  // Mapeo variables->orden y construccion de componentes: MISMA logica que el envio server-side
  // de la feature 107 (no se reinventa). El cuerpo renderizado se persiste para el historial.
  const valores = resolverValoresPlantilla(plantilla.variables, datos);
  const componentes = construirComponentsEnvio(plantilla.variables, valores);
  const cuerpoRenderizado = renderPlantilla(plantilla.cuerpo, valores);
  const idioma =
    plantilla.templateIdioma || deps.idiomaPorDefecto || idiomaPorDefectoDeConfig() || "es";

  const outcome = await service.enviarPlantilla({
    ordenId: oId.data,
    mensajeroId: actor.usuarioId,
    telefonoE164: datos.orden.telefonoDest,
    plantillaId: plantilla.id,
    nombre: plantilla.nombre,
    idioma,
    componentes,
    cuerpoRenderizado,
  });

  if (outcome.status === "ok") return { status: "ok", mensajeChatId: outcome.mensajeChatId };
  if (outcome.status === "permanente") {
    return { status: "permanente", mensajeChatId: outcome.mensajeChatId, detalle: outcome.detalle };
  }
  // R21: transitorio -> ya persistido `queued` y encolado; la UI lo trata como reintentable.
  // No se filtra el detalle (podria ecoar el destino): solo el desenlace.
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
  const datos = await ordenReader.findParaEnvio(oId.data, actor.usuarioId);
  if (datos === null) return { status: "forbidden" };

  const conversacionRepo = deps.conversacionRepo ?? new ChatConversacionRepository(prisma);
  const hilo = await conversacionRepo.findByOrdenParaMensajero(oId.data, actor.usuarioId);
  if (hilo === null) {
    // Orden del mensajero pero aun sin hilo: hilo vacio, ventana cerrada (sin entrantes) y
    // nada bloqueado — es justo el estado en que se puede abrir la conversacion con una
    // plantilla, que es la unica via valida con la ventana cerrada.
    return {
      status: "ok",
      ventanaAbierta: false,
      ultimoEntranteAt: null,
      plantillaBloqueada: false,
      textoLibreHabilitado: false,
      mensajes: [],
    };
  }

  const mensajeRepo = deps.mensajeRepo ?? new ChatMensajeRepository(prisma);
  const filas = await mensajeRepo.listarHilo(hilo.id);
  // Feature 308 (R19/R20/D4): las filas `tipo=reaccion` NO son burbujas. Se sacan del hilo y se
  // cuelgan del mensaje al que reaccionan. `mensajes` es ya el hilo SIN ellas.
  const { burbujas: mensajes, reaccionesPorWaMessageId } = agregarReacciones(filas);
  const ahoraDate = (deps.now ?? (() => new Date()))();
  const ahora = ahoraDate.getTime();
  const ventanaAbierta =
    hilo.ultimoEntranteAt !== null &&
    ahora - hilo.ultimoEntranteAt.getTime() < VENTANA_MS;

  // QUE SE PUEDE ENVIAR se juzga SOLO con los mensajes de HOY, no con el hilo entero. El hilo
  // es por `(orden_id, telefono_e164)` y sobrevive a las reasignaciones, asi que sin este
  // corte un saliente de ayer dejaba el chat mudo para siempre (ver `ListarHiloChatResult`).
  // El HISTORIAL que se devuelve no se toca: se sigue viendo completo.
  //
  // La cota es `inicioDelDiaCREnUtc` (06:00Z del dia CR), NO `startOfDayCR`: aqui se compara
  // contra `ocurrido_at`, que es un `timestamp`, y confundirlas es el off-by-one de seis horas
  // que documenta `lib/utils/fecha-cr.ts:27-29`.
  const inicioDelDia = inicioDelDiaCREnUtc(fechaCalendarioCR(ahoraDate)).getTime();
  const deHoy = mensajes.filter((m) => m.ocurridoAt.getTime() >= inicioDelDia);
  const hayEntranteHoy = deHoy.some((m) => m.direccion === "entrante");
  const haySalienteHoy = deHoy.some((m) => m.direccion === "saliente");

  return {
    status: "ok",
    ventanaAbierta,
    ultimoEntranteAt: hilo.ultimoEntranteAt?.toISOString() ?? null,
    // Cualquier saliente de hoy cuenta, no solo una plantilla: un texto libre —o la
    // bienvenida automatica— tambien deja la conversacion esperando respuesta del cliente.
    plantillaBloqueada: haySalienteHoy && !hayEntranteHoy,
    // `&& ventanaAbierta` es un cinturon, no un caso real: el inicio del dia CR esta como
    // mucho a 24 h de `now`, asi que un entrante de hoy implica ventana abierta. Se deja
    // explicito para que la UI no prometa nunca un envio que `enviarMensajeChat` rechazaria.
    textoLibreHabilitado: hayEntranteHoy && ventanaAbierta,
    mensajes: mensajes.map((m) => ({
      id: m.id,
      direccion: m.direccion,
      tipo: m.tipo,
      cuerpo: m.cuerpo,
      estado: m.estado,
      // Feature 121 (R8): coords del entrante de ubicacion; null en el resto (columnas nullable).
      latitud: m.latitud,
      longitud: m.longitud,
      // Feature 308 (R19/R21): metadatos del adjunto SIN el media id de Meta. La UI pide el
      // binario por `/api/chat/media/${m.id}` (id interno, autorizable); el id de Meta se queda
      // en el servidor. `mediaId === null` = este mensaje no tiene adjunto.
      media:
        m.mediaId === null
          ? null
          : { mime: m.mediaMime, nombre: m.mediaNombre, tamanoBytes: m.mediaTamanoBytes },
      // Ya viene validado con zod desde el repo (`safeParse`): un JSON corrupto llega como null.
      contactos: m.contactos,
      sistema:
        m.tipo === "sistema"
          ? {
              telefonoAnterior: m.sistemaTelefonoAnterior,
              telefonoNuevo: m.sistemaTelefonoNuevo,
            }
          : null,
      reacciones:
        m.waMessageId === null ? [] : (reaccionesPorWaMessageId.get(m.waMessageId) ?? []),
      ocurridoAt: m.ocurridoAt.toISOString(),
    })),
  };
}

/**
 * Entrantes SIN LEER por orden para el mensajero de la sesion. Es la fuente del distintivo
 * numerico del chat: el numero de cada conversacion y, sumado, el del boton flotante.
 *
 * El scope es la sesion, no un parametro: la accion no recibe `mensajeroId` para que nadie
 * pueda pedir el resumen de otro. Devuelve SOLO las ordenes con pendientes; la UI trata la
 * ausencia como cero.
 */
export async function resumenNoLeidosChat(
  deps: ChatWhatsappDeps = {},
): Promise<ResumenNoLeidosChatResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const conversacionRepo =
    deps.conversacionRepo ?? new ChatConversacionRepository(getPrismaClient());
  const filas = await conversacionRepo.contarNoLeidosPorMensajero(actor.usuarioId);
  return {
    status: "ok",
    conversaciones: filas.map((f) => ({ ordenId: f.ordenId, noLeidos: f.noLeidos })),
  };
}

/**
 * Sella el hilo de `ordenId` como leido hasta su ultimo entrante. La UI la llama cuando la
 * conversacion esta ABIERTA delante del mensajero (y de nuevo cuando llega un entrante con
 * ella abierta): ver el mensaje ES leerlo.
 *
 * La propiedad de la orden es la puerta, igual que en `listarHiloChat` (R16): una orden de
 * otro mensajero responde `forbidden` sin escribir. Es idempotente.
 */
export async function marcarChatLeido(
  ordenId: unknown,
  deps: ChatWhatsappDeps = {},
): Promise<MarcarChatLeidoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const oId = idSchema.safeParse(ordenId);
  if (!oId.success) return { status: "forbidden" };

  const prisma = getPrismaClient();
  const ordenReader = deps.ordenReader ?? new OrdenEnvioReader(prisma);
  const datos = await ordenReader.findParaEnvio(oId.data, actor.usuarioId);
  if (datos === null) return { status: "forbidden" };

  const conversacionRepo = deps.conversacionRepo ?? new ChatConversacionRepository(prisma);
  await conversacionRepo.marcarLeidoHastaUltimoEntrante(oId.data, actor.usuarioId);
  return { status: "ok" };
}
