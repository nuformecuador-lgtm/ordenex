// Integracion WhatsApp — implementacion del puerto de templates: traduce una plantilla local
// al formato de Meta (variables NOMBRADAS -> parametros NUMERADOS, via la util pura) y llama al
// CRUD de `WhatsappPlantillasClient`. Aqui NO hay politica de reintento: eso vive en el
// propagador (fallback a cola) y en el drenado de la cola. Un fallo se PROPAGA como excepcion.
//
// Ficha 474 (design §5.1, R4/R5): una plantilla de INFORME lleva los ejemplos de SU informe (no
// los del catalogo de orden), y una con documento lleva la cabecera DOCUMENT con el handle del
// documento de ejemplo. Una plantilla de orden produce exactamente los mismos componentes de antes.

import type { WhatsappConfig } from "@/lib/config/whatsapp";
import {
  WhatsappPlantillaError,
  WhatsappPlantillasClient,
  type PlantillaCategoria,
} from "@/lib/clients/whatsapp-cloud";
import {
  construirComponentsTemplate,
  type OpcionesComponentsTemplate,
} from "@/lib/utils/whatsapp-template";
import type {
  IWhatsappTemplatePort,
  TemplatePlantillaInput,
} from "@/lib/interfaces/services/IWhatsappTemplatePort";
import type { SetTemplateData } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { IProveedorHandleDocumento } from "@/lib/services/whatsapp/documento-ejemplo-plantilla";
import { ejemploDeVariableInforme } from "@/lib/whatsapp-envios/informes/catalogo";

export class WhatsappTemplatePort implements IWhatsappTemplatePort {
  constructor(
    private readonly client: WhatsappPlantillasClient,
    private readonly config: WhatsappConfig,
    /** Ficha 474: proveedor del handle del documento de ejemplo (R5). */
    private readonly documento?: IProveedorHandleDocumento,
  ) {}

  async crearTemplate(input: TemplatePlantillaInput): Promise<SetTemplateData> {
    const creada = await this.client.crear({
      nombre: input.nombre,
      idioma: this.config.templateIdioma,
      categoria: this.config.templateCategoria as PlantillaCategoria, // config valida (UTILITY por defecto)
      components: construirComponentsTemplate(input.cuerpo, input.variables, await this.opciones(input)),
    });
    return { templateId: creada.id, idioma: this.config.templateIdioma };
  }

  async actualizarTemplate(templateId: string, input: TemplatePlantillaInput): Promise<void> {
    await this.client.actualizar(templateId, {
      components: construirComponentsTemplate(input.cuerpo, input.variables, await this.opciones(input)),
    });
  }

  async eliminarTemplate(nombre: string): Promise<void> {
    await this.client.eliminar(nombre);
  }

  /** `undefined` para una plantilla de orden: salida identica a la de antes de la 474. */
  private async opciones(input: TemplatePlantillaInput): Promise<OpcionesComponentsTemplate | undefined> {
    const informeClave = input.informeClave ?? null;
    if (informeClave === null) return undefined;
    const opts: OpcionesComponentsTemplate = { ejemplos: ejemploDeVariableInforme(informeClave) };
    if (input.llevaDocumento === true) {
      if (this.documento === undefined) {
        throw new WhatsappPlantillaError("plantilla con documento sin proveedor del documento de ejemplo");
      }
      opts.documento = { headerHandle: await this.documento.obtenerHandle() };
    }
    return opts;
  }
}
