// Integracion WhatsApp — ENVIO de una plantilla (Message Template de Meta) a la orden que
// gestiona un mensajero. Orquesta: authz de la orden (asignada al mensajero) -> resolver la
// plantilla enviable -> mapear sus variables a datos de la orden -> enviar via Graph API.
//
// El envio usa `enviarPlantilla` (name + language + components), no texto libre: es la unica
// forma de INICIAR conversacion fuera de la ventana de 24 h (decision humana).
import type { WhatsappCloudClient } from "@/lib/clients/whatsapp-cloud";
import type { IPlantillaMensajeRepository } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { IOrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import type { EnviarPlantillaResult } from "@/lib/types/whatsapp-envio";
import { construirComponentsEnvio } from "@/lib/utils/whatsapp-template";
import { resolverValoresOrden } from "@/lib/utils/whatsapp-envio-valores";

export interface EnvioPlantillaDeps {
  ordenReader: IOrdenEnvioReader;
  plantillaRepo: Pick<IPlantillaMensajeRepository, "findEnviableById">;
  client: WhatsappCloudClient;
  /** Idioma por defecto si el template local no tiene idioma sincronizado. */
  idiomaPorDefecto: string;
}

export class EnvioPlantillaWhatsappService {
  constructor(private readonly deps: EnvioPlantillaDeps) {}

  /**
   * Envia la plantilla `plantillaId` a la orden `ordenId` en nombre de `mensajeroId`.
   * Devuelve un resultado de dominio (nunca lanza por fallo de Meta: lo mapea a `envio_fallido`).
   */
  async enviar(
    ordenId: string,
    plantillaId: string,
    mensajeroId: string,
  ): Promise<EnviarPlantillaResult> {
    const orden = await this.deps.ordenReader.findParaEnvio(ordenId, mensajeroId);
    if (orden === null) return { status: "forbidden" }; // inexistente o de otro mensajero

    const plantilla = await this.deps.plantillaRepo.findEnviableById(plantillaId);
    if (plantilla === null) return { status: "not_found" }; // no existe o no es enviable

    const valores = resolverValoresOrden(plantilla.variables, orden);
    const components = construirComponentsEnvio(plantilla.variables, valores);
    const idioma = plantilla.templateIdioma || this.deps.idiomaPorDefecto;

    const outcome = await this.deps.client.enviarPlantilla(
      orden.telefonoDest,
      plantilla.nombre,
      idioma,
      components,
    );
    if (outcome.status === "ok") return { status: "ok", mensajeId: outcome.mensajeId };
    return { status: "envio_fallido", detalle: outcome.detalle };
  }
}
