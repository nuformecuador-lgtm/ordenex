// Integracion WhatsApp — puerto de las operaciones CRUDAS de template contra Meta, aislado
// del resto para que la propagacion (sincrona, con fallback a cola) y el job de reintento
// hablen con Meta por el MISMO seam. La implementacion (`WhatsappTemplatePort`) usa
// `WhatsappPlantillasClient` + la util de conversion de variables; los tests inyectan un doble.

import type { SetTemplateData } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";

/** Datos de la plantilla local necesarios para crear/actualizar su template en Meta. */
export interface TemplatePlantillaInput {
  nombre: string;
  cuerpo: string;
  variables: string[];
}

export interface IWhatsappTemplatePort {
  /** Crea el template en Meta y devuelve lo que hay que persistir (templateId + idioma). */
  crearTemplate(input: TemplatePlantillaInput): Promise<SetTemplateData>;
  /** Actualiza en Meta el template ya enlazado (por su templateId). */
  actualizarTemplate(templateId: string, input: TemplatePlantillaInput): Promise<void>;
  /** Borra en Meta el template por su nombre (todas sus versiones de idioma). */
  eliminarTemplate(nombre: string): Promise<void>;
}
