// Feature 109 (design §3, R6/R7/R8/R18/R19/R20/R21/R25) — service del chat de WhatsApp.
// LOGICA PURA, testeable sin DB ni HTTP: ingesta de entrantes (con resolucion D4 y dedupe),
// aplicacion de statuses, regla de la ventana de 24 h y orquestacion del envio saliente
// (en linea + encolado de reintento ante `transitorio`, D1). Recibe repos + cliente por
// constructor (inyeccion por interfaz, patron `EnvioPlantillaWhatsappService`).
import type { WhatsappCloudClient, WhatsappEnvioOutcome } from "@/lib/clients/whatsapp-cloud";
import type { IChatConversacionRepository } from "@/lib/interfaces/repositories/IChatConversacionRepository";
import type { IChatMensajeRepository } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { IPlantillaMensajeRepository } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { IOrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import type { WebhookEventos, WebhookStatus } from "@/lib/types/whatsapp-webhook";
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";
import { esErrorTransitorio } from "@/lib/services/whatsapp/errores-meta";
import { construirComponentsEnvio } from "@/lib/utils/whatsapp-template";
import { resolverValoresPlantilla } from "@/lib/types/plantilla-datos";

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
  /**
   * Feature 299 (R16/R18): hilos cuyo `telefono_e164` se reescribio por un cambio de numero del
   * cliente. Conteo AGREGADO, sin PII: nunca el numero anterior ni el nuevo.
   */
  hilosMigrados: number;
}

/** Desenlace de un envio saliente de texto desde el chat (lo devuelve la server action). */
export type EnviarTextoChatResult =
  | { status: "ok"; mensajeId: string; mensajeChatId: string }
  | { status: "fuera_ventana" } // R19/D2: bloqueado en el server, exige plantilla
  | { status: "transitorio"; detalle: string; mensajeChatId: string } // R21: reintentable
  // La Graph API rechazo la peticion (4xx que no es 429). NO se reintenta: el saliente queda
  // `failed` con el motivo, en vez de `queued` para siempre.
  | { status: "permanente"; detalle: string; mensajeChatId: string };

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
  | { status: "transitorio"; detalle: string; mensajeChatId: string } // R21: reintentable
  | { status: "permanente"; detalle: string; mensajeChatId: string };

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
  /**
   * Resolucion de la plantilla y de los datos de la orden para REENVIAR un saliente
   * `tipo=plantilla` que quedo `queued`. Opcional: sin ellos, `reintentarEnvio` no reintenta
   * plantillas (no las degrada a texto libre, que seria un mensaje distinto y ademas
   * rechazado fuera de la ventana de 24 h).
   */
  plantillaRepo?: Pick<IPlantillaMensajeRepository, "findEnviableById">;
  ordenReader?: IOrdenEnvioReader;
  /** Idioma por defecto si la plantilla no tiene idioma sincronizado con Meta. */
  idiomaPorDefecto?: string;
  /** Horas de la ventana de sesion de WhatsApp. Default 24 (R18/R19). */
  ventanaHoras?: number;
  /** Logger inyectable, patron `GeocodeLogger`. NUNCA recibe PII ni secretos (R11). */
  logger?: ChatLogger;
  /** Reloj inyectable para tests deterministas. Default `new Date()`. */
  now?: () => Date;
}

/** Logger inyectable del chat. Solo mensajes agregados: nunca numero destino ni cuerpo. */
export interface ChatLogger {
  warn(message: string): void;
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
    let hilosMigrados = 0;

    for (const mensaje of eventos.mensajes) {
      // Feature 299 (design §3, R16/R17/R18): el CAMBIO DE NUMERO se aplica ANTES de resolver
      // la orden. Migrar primero es lo que hace que este mismo evento —y todo lo que venga
      // despues del numero nuevo— caiga en el hilo que ya existia, en vez de abrir uno vacio.
      // El repo es tolerante al conflicto y devuelve 0 sin lanzar (P5), asi que la ingesta del
      // lote y su 200 se mantienen pase lo que pase. No se loguea ningun numero (R35).
      if (mensaje.sistema !== undefined && mensaje.sistema.telefonoAnterior !== null) {
        hilosMigrados += await this.deps.conversacionRepo.migrarTelefono(
          mensaje.sistema.telefonoAnterior,
          mensaje.sistema.telefonoNuevo,
        );
      }

      // Normaliza el numero entrante (Meta lo entrega con o sin `+`) antes de resolver/keyear:
      // asi el mismo cliente cae SIEMPRE en el mismo hilo (raiz del bug de duplicados).
      //
      // La resolucion usa el `from` del evento, que en un cambio de numero es el ANTERIOR. Y
      // TIENE que ser asi: la orden se busca por `orden.telefono_dest`, que R17 prohibe tocar,
      // asi que el unico numero que casa con la orden sigue siendo el anterior.
      const resolucion = await this.deps.conversacionRepo.resolverOrdenActivaPorNumero(
        normalizarTelefonoWa(mensaje.telefonoE164),
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
        // Feature 299 (R18): tras migrar, el hilo de esta orden vive bajo el numero NUEVO. El
        // upsert tiene que keyear por ese numero o crearia un hilo vacio con el viejo y la
        // evidencia caeria fuera del hilo que el mensajero mira.
        telefonoE164:
          mensaje.sistema !== undefined ? mensaje.sistema.telefonoNuevo : resolucion.telefonoE164,
      });

      const insertado = await this.deps.mensajeRepo.insertarEntranteIdempotente({
        conversacionId: hilo.id,
        tipo: mensaje.tipo,
        cuerpo: mensaje.cuerpo,
        waMessageId: mensaje.waMessageId,
        // Feature 121 (R4): un entrante de ubicacion trae sus coords; el resto queda null. Un
        // entrante de ubicacion es un entrante mas: no toca el dedupe ni el sellado (R5/R6).
        latitud: mensaje.ubicacion?.latitud ?? null,
        longitud: mensaje.ubicacion?.longitud ?? null,
        // Feature 299 (R1/R2/R4/R5/R7/R12): los campos de los tipos nuevos viajan igual que
        // lat/lng en la 121. El dedupe por `wa_message_id` y el sellado de `ultimo_entrante_at`
        // NO se tocan: una imagen, una reaccion o la evidencia del cambio de numero son
        // entrantes MAS. Eso es tambien lo que impide DUPLICAR la evidencia si Meta reenvia el
        // mismo `system` (R18): el segundo intento cae en el dedupe y no inserta.
        mediaId: mensaje.media?.mediaId ?? null,
        mediaMime: mensaje.media?.mediaMime ?? null,
        mediaNombre: mensaje.media?.mediaNombre ?? null,
        mediaTamanoBytes: mensaje.media?.mediaTamanoBytes ?? null,
        reaccionAWaMessageId: mensaje.reaccion?.objetivoWaMessageId ?? null,
        reaccionEmoji: mensaje.reaccion?.emoji ?? null,
        contactos: mensaje.contactos ?? null,
        sistemaTelefonoAnterior: mensaje.sistema?.telefonoAnterior ?? null,
        sistemaTelefonoNuevo: mensaje.sistema?.telefonoNuevo ?? null,
        ocurridoAt: mensaje.ocurridoAt,
      });

      if (insertado) {
        // R13: solo un entrante NUEVO mueve la ventana de 24 h (el dedupe no la re-sella).
        await this.deps.conversacionRepo.marcarUltimoEntrante(hilo.id, mensaje.ocurridoAt);
        mensajesRegistrados += 1;
      }
    }

    for (const status of eventos.statuses) {
      // Un `failed` persiste ADEMAS el motivo que manda Meta (`errors[0]`). Los demas estados
      // pasan `undefined` para no tocar esas columnas (ver `actualizarEstadoPorWaMessageId`).
      const esFallo = status.estado === "failed";
      const afectadas = await this.deps.mensajeRepo.actualizarEstadoPorWaMessageId(
        status.waMessageId,
        status.estado,
        esFallo ? status.error : undefined,
      );
      statusesAplicados += afectadas;

      if (esFallo) {
        await this.procesarFallo(status, afectadas);
      }
    }

    return { mensajesRegistrados, statusesAplicados, sinResolver, hilosMigrados };
  }

  /**
   * Un saliente que Meta reporta como `failed`: se DEJA CONSTANCIA siempre y se reintenta
   * SOLO si el codigo describe una condicion pasajera (`esErrorTransitorio`).
   *
   * La asimetria es deliberada. La mayoria de los `failed` son deterministas (destinatario
   * fuera de la lista de permitidos, plantilla no aprobada, numero sin WhatsApp) y
   * reintentarlos gasta cuota, consume los intentos del job y acaba en dead-letter sin
   * cambiar nada. Mismo criterio que `GeocodificacionService` con los desenlaces del geocoder.
   *
   * Para que el job pueda reintentarlo, el mensaje se devuelve a `queued`: `reintentarEnvio`
   * es un no-op sobre cualquier otro estado (guarda de idempotencia que se conserva intacta).
   */
  private async procesarFallo(status: WebhookStatus, afectadas: number): Promise<void> {
    const transitorio = esErrorTransitorio(status.error?.codigo);

    // R11: se cita el codigo y el texto del ERROR, jamas el numero destino ni el cuerpo.
    this.deps.logger?.warn(
      `[whatsapp] saliente failed wamid=${status.waMessageId} registrado=${afectadas > 0} ` +
        `codigo=${status.error?.codigo ?? "sin-codigo"} transitorio=${transitorio} ` +
        `titulo=${JSON.stringify(status.error?.titulo ?? null)} ` +
        `detalle=${JSON.stringify(status.error?.detalle ?? null)}`,
    );

    // `afectadas === 0`: el status llego antes que el saliente (o es de otro emisor). No hay
    // nada que reintentar y forzarlo crearia un job apuntando a un mensaje inexistente.
    if (!transitorio || afectadas === 0) return;
    if (this.deps.encolarReintento === undefined) return;

    const mensaje = await this.deps.mensajeRepo.findByWaMessageId(status.waMessageId);
    if (mensaje === null) return;

    // Vuelve a `queued` para que `reintentarEnvio` lo tome (su guarda exige ese estado).
    await this.deps.mensajeRepo.actualizarEstadoPorWaMessageId(
      status.waMessageId,
      "queued",
      status.error,
    );
    await this.deps.encolarReintento(mensaje.id);
  }

  /**
   * R18/R19/R20/R21: envia un TEXTO libre saliente. Aplica la ventana de 24 h leyendo
   * `ultimo_entrante_at` del hilo (get-or-create). Fuera de ventana BLOQUEA (D2). Dentro:
   * envia en linea; `ok` persiste el saliente con su `wa_message_id`; `transitorio` lo
   * persiste como `queued` (no se pierde) y encola el reintento (D1).
   */
  async enviarTexto(input: EnviarTextoChatInput): Promise<EnviarTextoChatResult> {
    const client = this.requireClient();
    // Numero normalizado (solo digitos): misma clave del hilo y mismo destino en la Graph API.
    const telefonoE164 = normalizarTelefonoWa(input.telefonoE164);
    const hilo = await this.deps.conversacionRepo.upsertParaOrden({
      ordenId: input.ordenId,
      mensajeroId: input.mensajeroId,
      telefonoE164,
    });

    // La ventana se decide por el ULTIMO ENTRANTE REAL del hilo (no la columna, que puede
    // quedar desincronizada): asi el envio coincide con el panel, que habilita el input cuando
    // hay mensajes entrantes.
    const ultimoEntranteAt = await this.deps.mensajeRepo.ultimoEntranteAt(hilo.id);
    if (!this.dentroDeVentana(ultimoEntranteAt)) {
      // R19/D2: sin entrante reciente, el texto libre lo rechazaria Meta; se bloquea aqui.
      return { status: "fuera_ventana" };
    }

    const ahora = this.now();
    const outcome = await client.enviarTexto(telefonoE164, input.texto);

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

    // Rechazo de la Graph API (4xx): DETERMINISTA. Se persiste `failed` con el motivo y NO se
    // encola nada; reintentarlo daria el mismo error y lo dejaria `queued` indefinidamente.
    if (outcome.status === "permanente") {
      const fallido = await this.persistirFalloPermanente(
        { conversacionId: hilo.id, tipo: "texto", cuerpo: input.texto, plantillaId: null },
        outcome,
        ahora,
      );
      return { status: "permanente", detalle: outcome.detalle, mensajeChatId: fallido };
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
    // Numero normalizado (solo digitos): misma clave del hilo y mismo destino en la Graph API.
    const telefonoE164 = normalizarTelefonoWa(input.telefonoE164);
    const hilo = await this.deps.conversacionRepo.upsertParaOrden({
      ordenId: input.ordenId,
      mensajeroId: input.mensajeroId,
      telefonoE164,
    });

    const ahora = this.now();
    const outcome = await client.enviarPlantilla(
      telefonoE164,
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

    if (outcome.status === "permanente") {
      const fallido = await this.persistirFalloPermanente(
        {
          conversacionId: hilo.id,
          tipo: "plantilla",
          cuerpo: input.cuerpoRenderizado,
          plantillaId: input.plantillaId,
        },
        outcome,
        ahora,
      );
      return { status: "permanente", detalle: outcome.detalle, mensajeChatId: fallido };
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

    // Un saliente de PLANTILLA se reenvia COMO PLANTILLA. Antes se reenviaba siempre con
    // `enviarTexto`, lo que mandaba el cuerpo renderizado como texto libre: un mensaje
    // distinto del que el mensajero eligio y, fuera de la ventana de 24 h, rechazado por Meta.
    const outcome =
      mensaje.tipo === "plantilla"
        ? await this.reenviarPlantilla(client, hilo, mensaje)
        : await client.enviarTexto(hilo.telefonoE164, mensaje.cuerpo ?? "");

    if (outcome.status === "ok") {
      await this.deps.mensajeRepo.reconciliarSaliente(mensaje.id, outcome.mensajeId, "sent");
      return;
    }
    if (outcome.status === "permanente") {
      // Rechazo determinista: cerrar el mensaje como `failed` y COMPLETAR el job. Relanzar
      // aqui solo gastaria los intentos restantes contra el mismo error y lo dejaria `queued`.
      await this.deps.mensajeRepo.marcarFallido(mensaje.id, {
        codigo: outcome.codigoMeta,
        titulo: null,
        detalle: outcome.detalle,
      });
      this.deps.logger?.warn(
        `[whatsapp] reintento rechazado de forma permanente, sin mas intentos: ${outcome.detalle}`,
      );
      return;
    }
    // Sigue fallando de forma pasajera: relanza para el backoff del job.
    throw new Error(outcome.detalle);
  }

  /**
   * Reconstruye el envio de plantilla de un saliente `queued`: resuelve la plantilla por su
   * `plantilla_id` y re-renderiza los componentes con los datos VIGENTES de la orden (misma
   * cadena que `EnvioPlantillaWhatsappService`, unica fuente de la construccion).
   *
   * Se re-renderiza en vez de guardar los componentes porque el cuerpo depende de datos que
   * pueden haber cambiado entre el fallo y el reintento (num_guia, monto). Reenviar los
   * valores viejos mandaria al cliente informacion desactualizada.
   */
  private async reenviarPlantilla(
    client: ChatClient,
    hilo: { telefonoE164: string; ordenId: string; mensajeroId: string },
    mensaje: { plantillaId: string | null },
  ): Promise<WhatsappEnvioOutcome> {
    const { plantillaRepo, ordenReader } = this.deps;
    if (plantillaRepo === undefined || ordenReader === undefined || mensaje.plantillaId === null) {
      // Sin las deps de plantilla no se puede reconstruir el envio. Es DETERMINISTA: relanzar
      // en bucle no las va a materializar, pero tampoco se degrada a texto libre.
      throw new Error("reintento de plantilla: faltan plantillaRepo/ordenReader o plantilla_id");
    }

    const plantilla = await plantillaRepo.findEnviableById(mensaje.plantillaId);
    if (plantilla === null) {
      throw new Error("reintento de plantilla: la plantilla ya no es enviable");
    }
    const datos = await ordenReader.findParaEnvio(hilo.ordenId, hilo.mensajeroId);
    if (datos === null) {
      throw new Error("reintento de plantilla: la orden ya no esta asignada a ese mensajero");
    }

    const valores = resolverValoresPlantilla(plantilla.variables, datos);
    const componentes = construirComponentsEnvio(plantilla.variables, valores);
    return client.enviarPlantilla(
      hilo.telefonoE164,
      plantilla.nombre,
      plantilla.templateIdioma || (this.deps.idiomaPorDefecto ?? "es"),
      componentes,
    );
  }

  /**
   * Persiste un saliente que la Graph API rechazo de forma DETERMINISTA: estado `failed` y el
   * motivo en las columnas de error, para que sea visible sin entrar al panel de Meta.
   *
   * Se guarda igual que un envio bueno (no se descarta) porque el mensajero necesita ver que
   * lo intento y por que no salio; lo que NO se hace es encolar reintento.
   */
  private async persistirFalloPermanente(
    base: {
      conversacionId: string;
      tipo: "texto" | "plantilla";
      cuerpo: string;
      plantillaId: string | null;
    },
    outcome: { detalle: string; codigoMeta: number | null },
    ahora: Date,
  ): Promise<string> {
    const guardado = await this.deps.mensajeRepo.insertarSaliente({
      conversacionId: base.conversacionId,
      tipo: base.tipo,
      cuerpo: base.cuerpo,
      plantillaId: base.plantillaId,
      waMessageId: null,
      estado: "failed",
      ocurridoAt: ahora,
      error: {
        codigo: outcome.codigoMeta,
        titulo: null,
        detalle: outcome.detalle,
      },
    });
    this.deps.logger?.warn(
      `[whatsapp] saliente rechazado por la Graph API (sin reintento): ${outcome.detalle}`,
    );
    return guardado.id;
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
