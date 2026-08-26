// MENSAJE DE BIENVENIDA — handler del job `whatsapp_bienvenida` y su fabrica de dependencias
// reales. Espejo de `whatsapp-chat-envio-handler.ts`.
//
// Envia al cliente la plantilla marcada como bienvenida cuando su paquete fue recogido. NO es
// recurrente: se encola por EVENTO (la transicion `recoleccion -> en_reparto`), nunca por reloj.
// Las deps (config de WhatsApp) se cargan PEREZOSAMENTE: un env ausente falla ESTE job
// —recuperable y con su motivo en `last_error`—, no el drenado de los demas tipos.
//
// Reutiliza la MISMA cadena de resolucion que `enviarPlantillaChat` (`lib/actions/chat-whatsapp.ts`):
// datos de la orden -> valores -> componentes de Meta -> cuerpo renderizado. No la reimplementa.
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import { ChatConversacionRepository } from "@/lib/repositories/ChatConversacionRepository";
import { ChatMensajeRepository } from "@/lib/repositories/ChatMensajeRepository";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { OrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { crearEncolarReintentoChatEnvio } from "@/lib/services/jobs/whatsapp-chat-envio-encolado";
import { WhatsappCloudClient } from "@/lib/clients/whatsapp-cloud";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";
import { consoleLogger } from "@/lib/services/whatsapp/chat-logger";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";
import { construirComponentsEnvio } from "@/lib/utils/whatsapp-template";
import { resolverValoresPlantilla } from "@/lib/types/plantilla-datos";
import { renderPlantilla } from "@/lib/utils/plantilla-mensaje";
import type { IPlantillaMensajeRepository } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { IOrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import type { ChatLogger } from "@/lib/services/ChatWhatsappService";

const payloadSchema = z.object({
  ordenId: z.string().min(1),
  mensajeroId: z.string().min(1),
  ocurridoAt: z.string().min(1),
});

/** Lo que el handler necesita; inyectable entero para poder ejercitarlo sin DB ni Meta. */
export interface WhatsappBienvenidaDeps {
  service: ChatWhatsappService;
  plantillaRepo: Pick<IPlantillaMensajeRepository, "findWelcomeMessage" | "findEnviableById">;
  ordenReader: IOrdenEnvioReader;
  /** Idioma del template si la plantilla no trae el suyo sincronizado desde Meta. */
  idiomaPorDefecto?: string;
  logger?: ChatLogger;
}

/**
 * Construye las deps reales. `loadWhatsappConfig` LANZA si falta un env, y eso es deliberado:
 * a diferencia de `buildEnvioService()` de la Server Action —que devuelve `null` para responder
 * `no_configurado` a una UI— aqui el fallo tiene que acabar en `last_error`, no convertirse en
 * un `return` silencioso. Un envio que no sale sin dejar rastro es justo lo que esta feature
 * existe para evitar.
 */
export function buildWhatsappBienvenidaDeps(): WhatsappBienvenidaDeps {
  const prisma = getPrismaClient();
  const config = loadWhatsappConfig();
  return {
    service: new ChatWhatsappService({
      conversacionRepo: new ChatConversacionRepository(prisma),
      mensajeRepo: new ChatMensajeRepository(prisma),
      client: new WhatsappCloudClient({ config, logger: consoleLogger }),
      // ⚠️ ESTA LINEA ES LA QUE HACE CORRECTO EL `MAX_INTENTOS_BIENVENIDA = 1`, y por eso NO se
      // copia `buildWhatsappChatEnvioService`, que la omite a proposito (alli seria recursivo:
      // es el service DEL job de reintento).
      //
      // `enviarPlantilla` solo encola el reintento `if (this.deps.encolarReintento)`
      // (`ChatWhatsappService.ts:357`). Sin esta dep, un `transitorio` de Meta persistiria el
      // saliente `queued` y NO LO REINTENTARIA NADIE NUNCA: se quedaria `queued` para siempre
      // mientras el job diria `done`. Con ella, los fallos de Meta los absorbe
      // `whatsapp_chat_envio` con sus 5 intentos, y este job puede permitirse uno solo.
      encolarReintento: crearEncolarReintentoChatEnvio(new JobRepository(prisma)),
      logger: consoleLogger,
    }),
    plantillaRepo: new PlantillaMensajeRepository(prisma),
    ordenReader: new OrdenEnvioReader(prisma),
    idiomaPorDefecto: config.templateIdioma,
    logger: consoleLogger,
  };
}

/**
 * Handler del job. `buildDeps` inyectable para tests; en produccion construye lo real en cada
 * ejecucion (config perezosa).
 *
 * QUE LANZA Y QUE NO, que es toda la politica de rastro de esta feature:
 *
 * - LANZA en las condiciones de CONFIGURACION —bienvenida desmarcada entre medias, plantilla no
 *   aprobada por Meta, orden reasignada, destinatario sin telefono—. Con `maxIntentos: 1` eso
 *   deja UNA fila `jobs` en `failed` con el motivo concreto en `last_error`, consultable en el
 *   minuto siguiente a la recogida.
 * - NO LANZA por el desenlace de Meta. `enviarPlantilla` DEVUELVE el resultado en vez de lanzar,
 *   y los dos desenlaces malos ya dejaron mejor rastro del que dejaria un job muerto: un
 *   `permanente` deja el saliente `failed` con el error de Meta VISIBLE EN EL HILO DEL CHAT, y un
 *   `transitorio` deja el saliente `queued` con su propio job de reintento en marcha. Relanzar
 *   aqui duplicaria el rastro y enterraria el job por algo que ya esta gestionado.
 */
export function crearWhatsappBienvenidaHandler(
  buildDeps: () => WhatsappBienvenidaDeps = buildWhatsappBienvenidaDeps,
): JobHandler {
  return async (job: JobDTO) => {
    const payload = payloadSchema.parse(job.payload);
    const deps = buildDeps();
    const log = deps.logger;

    // La marca se relee AL ENVIAR, no viaja en el payload: quien es la bienvenida es
    // configuracion, y asi una correccion del maestro en los ~60 s hasta el drenado surte efecto.
    const marcada = await deps.plantillaRepo.findWelcomeMessage();
    if (marcada === null) {
      // Carrera real: el maestro desmarco la bienvenida entre la recogida y este drenado.
      throw new Error(
        "bienvenida no enviada: ya no hay ninguna plantilla marcada como mensaje de bienvenida",
      );
    }

    // Las dos guardas de enviabilidad se comprueban por separado para que el motivo en
    // `last_error` diga QUE hay que arreglar, no un generico "no se pudo".
    if (marcada.estado !== "activo") {
      throw new Error(
        `bienvenida no enviada: la plantilla "${marcada.nombre}" esta en estado ${marcada.estado}, no activo`,
      );
    }
    if (marcada.templateId === null) {
      throw new Error(
        `bienvenida no enviada: la plantilla "${marcada.nombre}" no tiene template_id (no propagada a Meta)`,
      );
    }

    // El scope por mensajero es la puerta de `findParaEnvio` y no tiene variante sin el. Si la
    // orden se reasigno en el ultimo minuto, `null`. Es lo correcto y no un accidente: el cuerpo
    // de la plantilla puede nombrar al mensajero (`{{mensajero}}`, `{{mensajero_placa}}`), y un
    // envio "generico" tras la reasignacion le contaria al cliente un dato falso.
    const datos = await deps.ordenReader.findParaEnvio(payload.ordenId, payload.mensajeroId);
    if (datos === null) {
      throw new Error(
        "bienvenida no enviada: la orden ya no esta asignada al mensajero que la recogio, o fue borrada",
      );
    }

    // ANTES de tocar Meta y —esto es lo que importa— antes de que `enviarPlantilla` haga su
    // `upsertParaOrden`: sin esta guarda se crearia un hilo de chat con `telefono_e164 = ""`
    // que despues Meta rechazaria igual.
    if (normalizarTelefonoWa(datos.orden.telefonoDest) === "") {
      throw new Error("bienvenida no enviada: la orden no tiene telefono de destinatario");
    }

    // Sin esto la plantilla no es enviable aunque este marcada y activa: hace falta el cuerpo y
    // las variables, que `findWelcomeMessage` no trae (es un lector de la MARCA, no del envio).
    const plantilla = await deps.plantillaRepo.findEnviableById(marcada.id);
    if (plantilla === null) {
      throw new Error(
        `bienvenida no enviada: la plantilla "${marcada.nombre}" dejo de ser enviable`,
      );
    }

    // Misma cadena que `enviarPlantillaChat` (`lib/actions/chat-whatsapp.ts:159-163`).
    const valores = resolverValoresPlantilla(plantilla.variables, datos);
    const componentes = construirComponentsEnvio(plantilla.variables, valores);
    const cuerpoRenderizado = renderPlantilla(plantilla.cuerpo, valores);
    const idioma = plantilla.templateIdioma || deps.idiomaPorDefecto || "es";

    const outcome = await deps.service.enviarPlantilla({
      ordenId: payload.ordenId,
      mensajeroId: payload.mensajeroId,
      telefonoE164: datos.orden.telefonoDest,
      plantillaId: plantilla.id,
      nombre: plantilla.nombre,
      idioma,
      componentes,
      cuerpoRenderizado,
    });

    if (outcome.status !== "ok") {
      // Solo se registra el DESENLACE y la orden. Nunca el telefono ni el cuerpo (regla del
      // `ChatLogger`): el rastro real ya vive en la fila de `chat_mensaje`.
      log?.warn(
        `bienvenida: envio no confirmado (orden ${payload.ordenId}, desenlace ${outcome.status})`,
      );
    }
  };
}
