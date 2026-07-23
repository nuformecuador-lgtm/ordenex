// Integracion WhatsApp — implementacion del puerto de templates: traduce una plantilla local
// al formato de Meta (variables NOMBRADAS -> parametros NUMERADOS, via la util pura) y llama al
// CRUD de `WhatsappPlantillasClient`. Aqui NO hay politica de reintento: eso vive en el
// propagador (fallback a cola) y en el drenado de la cola. Un fallo se PROPAGA como excepcion.

import type { WhatsappConfig } from "@/lib/config/whatsapp";
import { WhatsappPlantillasClient, type PlantillaCategoria } from "@/lib/clients/whatsapp-cloud";
import { construirComponentsTemplate } from "@/lib/utils/whatsapp-template";
import type {
  IWhatsappTemplatePort,
  TemplatePlantillaInput,
} from "@/lib/interfaces/services/IWhatsappTemplatePort";
import type { SetTemplateData } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";

export class WhatsappTemplatePort implements IWhatsappTemplatePort {
  constructor(
    private readonly client: WhatsappPlantillasClient,
    private readonly config: WhatsappConfig,
  ) {}

  async crearTemplate(input: TemplatePlantillaInput): Promise<SetTemplateData> {
    const creada = await this.client.crear({
      nombre: input.nombre,
      idioma: this.config.templateIdioma,
      categoria: this.config.templateCategoria as PlantillaCategoria, // config valida (UTILITY por defecto)
      components: construirComponentsTemplate(input.cuerpo, input.variables),
    });
    return { templateId: creada.id, idioma: this.config.templateIdioma };
  }

  async actualizarTemplate(templateId: string, input: TemplatePlantillaInput): Promise<void> {
    await this.client.actualizar(templateId, {
      components: construirComponentsTemplate(input.cuerpo, input.variables),
    });
  }

  async eliminarTemplate(nombre: string): Promise<void> {
    await this.client.eliminar(nombre);
  }
}
