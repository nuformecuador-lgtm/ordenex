// Feature 109 (design §3, R6/R7/R8/R18/R19/R20/R21/R25) — service del chat de WhatsApp.
// LOGICA PURA, testeable sin DB ni HTTP: ingesta de entrantes (con resolucion D4 y dedupe),
// aplicacion de statuses, regla de la ventana de 24 h y orquestacion del envio saliente
// (en linea + encolado de reintento ante `transitorio`, D1). Recibe repos + cliente por
// constructor (inyeccion por interfaz, patron `EnvioPlantillaWhatsappService`).
import type { WhatsappCloudClient } from "@/lib/clients/whatsapp-cloud";
import type { IChatConversacionRepository } from "@/lib/interfaces/repositories/IChatConversacionRepository";
import type { IChatMensajeRepository } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { WebhookEventos } from "@/lib/types/whatsapp-webhook";

/**
 * Cliente minimo consumido: el envio de texto libre (saliente del chat) y el envio de una
 * PLANTILLA aprobada (saliente fuera de la ventana de 24 h). Ambos exigen credencial de ENVIO.
 */
type ChatClient = Pick<WhatsappCloudClient, "enviarTexto" | "enviarPlantilla">;

/** Resumen de la ingesta de un lote (conteos agregados, sin PII). */
export interface IngestaResumen {
  mensajesRegistrados: number;
  statusesAplicados: number;
  /** Entrantes cuyo numero no mapeo a ninguna orden activa asignada (R25/D4). */
  sinResolver: number;
}

/** Desenlace de un envio saliente de texto desde el chat (lo devuelve la server action). */
export type EnviarTextoChatResult =
  | { status: "ok"; mensajeId: string; mensajeChatId: string }
  | { status: "fuera_ventana" } // R19/D2: bloqueado en el server, exige plantilla
  | { status: "transitorio"; detalle: string; mensajeChatId: string }; // R21: reintentable

export interface EnviarTextoChatInput {
  ordenId: string;
  mensajeroId: string;
  /** Numero del cliente en E.164 sin `+` (lo aporta el `OrdenEnvioReader`). */
  telefonoE164: string;
  texto: string;
}

/**
 * Desenlace de un envio saliente de PLANTILLA desde el chat. A diferencia del texto libre NO
 * tiene `fuera_ventana`: una plantilla aprobada es justamente lo que se puede enviar dentro Y
 * fuera de la ventana de 24 h (ese es su proposito).
 */
export type EnviarPlantillaChatResult =
  | { status: "ok"; mensajeId: string; mensajeChatId: string }
  | { status: "transitorio"; detalle: string; mensajeChatId: string }; // R21: reintentable

export interface EnviarPlantillaChatInput {
  ordenId: string;
  mensajeroId: string;
  /** Numero del cliente en E.164 sin `+` (lo aporta el `OrdenEnvioReader`). */
  telefonoE164: string;
  /** Plantilla local que origina el saliente (se persiste en `plantilla_id`). */
  plantillaId: string;
  /** Nombre del template en Meta. */
  nombre: string;
  /** Codigo de idioma del template (p. ej. "es" o "es_CO"). */
  idioma: string;
  /** Componentes del body ya construidos (formato Graph API), en el orden de las variables. */
  componentes: unknown[];
  /** Texto ya renderizado con los datos de la orden, para mostrarlo en el historial. */
  cuerpoRenderizado: string;
}

export interface ChatWhatsappServiceDeps {
  conversacionRepo: IChatConversacionRepository;
  mensajeRepo: IChatMensajeRepository;
  /**
   * Cliente de envio. OPCIONAL: el webhook de INGESTA no envia nada (ni entrantes ni
   * statuses tocan la Graph API), asi que se construye el service sin cliente cuando la
   * credencial de ENVIO no esta configurada. `enviarTexto`/`reintentarEnvio` lo exigen.
   */
  client?: ChatClient;
  /**
   * D1/F3: encola un reintento del saliente `queued` ante `transitorio`. Opcional para
   * tests; si falta, el `transitorio` se persiste igual (no se pierde) sin encolar.
   */
  encolarReintento?: (mensajeChatId: string) => Promise<void>;
  /** Horas de la ventana de sesion de WhatsApp. Default 24 (R18/R19). */
  ventanaHoras?: number;
  /** Reloj inyectable para tests deterministas. Default `new Date()`. */
  now?: () => Date;
}

export class ChatWhatsappService {
  private readonly ventanaMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: ChatWhatsappServiceDeps) {
    this.ventanaMs = (deps.ventanaHoras ?? 24) * 60 * 60 * 1000;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * R6/R7/R8/R25: ingiere el lote ya normalizado del webhook. Por cada entrante resuelve la
   * orden destino (D4); si no resuelve, NO rompe el lote (cuenta `sinResolver` y sigue, R9).
   * El insert es idempotente (dedupe por `wa_message_id`); solo un insert NUEVO sella
   * `ultimo_entrante_at`. Los statuses actualizan el saliente por su `wa_message_id`.
   */
  async ingerirEventos(eventos: WebhookEventos): Promise<IngestaResumen> {
    let mensajesRegistrados = 0;
    let statusesAplicados = 0;
    let sinResolver = 0;

    for (const mensaje of eventos.mensajes) {
      const resolucion = await this.deps.conversacionRepo.resolverOrdenActivaPorNumero(
        mensaje.telefonoE164,
      );
      if (resolucion === null) {
        // R25/D4: el numero no mapea a ninguna orden viva y asignada. No se pierde el 200:
        // se cuenta y se sigue (sin loguear el numero, R11).
        sinResolver += 1;
        continue;
      }

      const hilo = await this.deps.conversacionRepo.upsertParaOrden({
        ordenId: resolucion.ordenId,
        mensajeroId: resolucion.mensajeroId,
        telefonoE164: resolucion.telefonoE164,
      });

      const insertado = await this.deps.mensajeRepo.insertarEntranteIdempotente({
        conversacionId: hilo.id,
        tipo: mensaje.tipo,
        cuerpo: mensaje.cuerpo,
        waMessageId: mensaje.waMessageId,
        ocurridoAt: mensaje.ocurridoAt,
      });

      if (insertado) {
        // R13: solo un entrante NUEVO mueve la ventana de 24 h (el dedupe no la re-sella).
        await this.deps.conversacionRepo.marcarUltimoEntrante(hilo.id, mensaje.ocurridoAt);
        mensajesRegistrados += 1;
      }
    }

    for (const status of eventos.statuses) {
      const afectadas = await this.deps.mensajeRepo.actualizarEstadoPorWaMessageId(
        status.waMessageId,
        status.estado,
      );
      statusesAplicados += afectadas;
    }

    return { mensajesRegistrados, statusesAplicados, sinResolver };
  }

  /**
   * R18/R19/R20/R21: envia un TEXTO libre saliente. Aplica la ventana de 24 h leyendo
   * `ultimo_entrante_at` del hilo (get-or-create). Fuera de ventana BLOQUEA (D2). Dentro:
   * envia en linea; `ok` persiste el saliente con su `wa_message_id`; `transitorio` lo
   * persiste como `queued` (no se pierde) y encola el reintento (D1).
   */
  async enviarTexto(input: EnviarTextoChatInput): Promise<EnviarTextoChatResult> {
    const client = this.requireClient();
    const hilo = await this.deps.conversacionRepo.upsertParaOrden({
      ordenId: input.ordenId,
      mensajeroId: input.mensajeroId,
      telefonoE164: input.telefonoE164,
    });

    if (!this.dentroDeVentana(hilo.ultimoEntranteAt)) {
      // R19/D2: sin entrante reciente, el texto libre lo rechazaria Meta; se bloquea aqui.
      return { status: "fuera_ventana" };
    }

    const ahora = this.now();
    const outcome = await client.enviarTexto(input.telefonoE164, input.texto);

    if (outcome.status === "ok") {
      const guardado = await this.deps.mensajeRepo.insertarSaliente({
        conversacionId: hilo.id,
        tipo: "texto",
        cuerpo: input.texto,
        waMessageId: outcome.mensajeId,
        estado: "sent",
        ocurridoAt: ahora,
      });
      return { status: "ok", mensajeId: outcome.mensajeId, mensajeChatId: guardado.id };
    }

    // R21/D1: `transitorio`. Se persiste como `queued` (sin perder el texto) y se encola el
    // reintento. El detalle del cliente ya viene sin secretos ni numero destino.
    const encolado = await this.deps.mensajeRepo.insertarSaliente({
      conversacionId: hilo.id,
      tipo: "texto",
      cuerpo: input.texto,
      waMessageId: null,
      estado: "queued",
      ocurridoAt: ahora,
    });
    if (this.deps.encolarReintento) await this.deps.encolarReintento(encolado.id);
    return { status: "transitorio", detalle: outcome.detalle, mensajeChatId: encolado.id };
  }

  /**
   * Envia una PLANTILLA aprobada como saliente del chat y la persiste en el hilo. A diferencia
   * de `enviarTexto` NO aplica el bloqueo de la ventana de 24 h: la plantilla es la via valida
   * para escribir fuera de ventana (y tambien sirve dentro). `ok` persiste el saliente
   * `tipo=plantilla` con su `plantilla_id`, el texto renderizado y el `wa_message_id`;
   * `transitorio` lo persiste como `queued` (no se pierde) y encola el reintento (D1/R21).
   */
  async enviarPlantilla(input: EnviarPlantillaChatInput): Promise<EnviarPlantillaChatResult> {
    const client = this.requireClient();
    const hilo = await this.deps.conversacionRepo.upsertParaOrden({
      ordenId: input.ordenId,
      mensajeroId: input.mensajeroId,
      telefonoE164: input.telefonoE164,
    });

    const ahora = this.now();
    const outcome = await client.enviarPlantilla(
      input.telefonoE164,
      input.nombre,
      input.idioma,
      input.componentes,
    );

    if (outcome.status === "ok") {
      const guardado = await this.deps.mensajeRepo.insertarSaliente({
        conversacionId: hilo.id,
        tipo: "plantilla",
        cuerpo: input.cuerpoRenderizado,
        plantillaId: input.plantillaId,
        waMessageId: outcome.mensajeId,
        estado: "sent",
        ocurridoAt: ahora,
      });
      return { status: "ok", mensajeId: outcome.mensajeId, mensajeChatId: guardado.id };
    }

    // R21/D1: `transitorio`. Se persiste como `queued` (sin perder la plantilla) y se encola el
    // reintento. El detalle del cliente ya viene sin secretos ni numero destino.
    const encolado = await this.deps.mensajeRepo.insertarSaliente({
      conversacionId: hilo.id,
      tipo: "plantilla",
      cuerpo: input.cuerpoRenderizado,
      plantillaId: input.plantillaId,
      waMessageId: null,
      estado: "queued",
      ocurridoAt: ahora,
    });
    if (this.deps.encolarReintento) await this.deps.encolarReintento(encolado.id);
    return { status: "transitorio", detalle: outcome.detalle, mensajeChatId: encolado.id };
  }

  /**
   * D1/F3: reintenta el envio de un saliente `queued` (drenado del job). Si el mensaje ya no
   * esta `queued` (reconciliado por otra corrida) es un no-op. `ok` reconcilia el
   * `wa_message_id`; `transitorio` RELANZA para que el job aplique backoff/dead-letter.
   */
  async reintentarEnvio(mensajeChatId: string): Promise<void> {
    const client = this.requireClient();
    const mensaje = await this.deps.mensajeRepo.findById(mensajeChatId);
    if (mensaje === null || mensaje.estado !== "queued") return;

    const hilo = await this.deps.conversacionRepo.findById(mensaje.conversacionId);
    if (hilo === null) return;

    const outcome = await client.enviarTexto(hilo.telefonoE164, mensaje.cuerpo ?? "");
    if (outcome.status === "ok") {
      await this.deps.mensajeRepo.reconciliarSaliente(mensaje.id, outcome.mensajeId, "sent");
      return;
    }
    // Sigue fallando: relanza para el backoff del job (detalle sin secretos ni destino).
    throw new Error(outcome.detalle);
  }

  /** El cliente de envio es obligatorio para las operaciones salientes (no para la ingesta). */
  private requireClient(): ChatClient {
    if (this.deps.client === undefined) {
      throw new Error("ChatWhatsappService: cliente de envio no configurado");
    }
    return this.deps.client;
  }

  /** R18/R19: hay ventana si existe un entrante y ocurrio hace menos de `ventanaMs`. */
  private dentroDeVentana(ultimoEntranteAt: Date | null): boolean {
    if (ultimoEntranteAt === null) return false;
    return this.now().getTime() - ultimoEntranteAt.getTime() < this.ventanaMs;
  }
}
