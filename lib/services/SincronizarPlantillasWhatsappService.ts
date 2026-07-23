// Integracion WhatsApp — sincronizacion Meta -> local (cron 24h). LEE las plantillas de la
// WABA en Meta y actualiza las plantillas LOCALES existentes que coinciden por NOMBRE: guarda
// su templateId + idioma y refleja el status de revision de Meta en el estado local. NO crea ni
// borra filas locales (decision humana: "solo actualizar existentes"); una desactivacion local
// (`inactivo`) no se revierte (lo garantiza el repo).
import { z } from "zod";
import type { PlantillaEstado } from "@prisma/client";
import type { WhatsappPlantillasClient } from "@/lib/clients/whatsapp-cloud";
import type { IPlantillaMensajeRepository } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import { extraerVariables } from "@/lib/utils/plantilla-mensaje";

/** Conteos de una corrida (sin PII: solo agregados). */
export interface SincronizarPlantillasResult {
  /** Templates devueltos por Meta. */
  leidas: number;
  /** Plantillas locales actualizadas (habia una con ese nombre). */
  actualizadas: number;
  /** Plantillas locales CREADAS (no existian; importadas desde Meta). */
  creadas: number;
  /** Templates que no se pudieron importar (nombre ya en uso por una borrada, p. ej.). */
  omitidas: number;
}

// El componente BODY de un template de Meta lleva el texto con parametros numerados `{{1}}`.
const bodyComponentSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

/**
 * Extrae el texto del componente BODY de un template de Meta (el cuerpo del mensaje). Si no
 * hay BODY o no trae texto, devuelve cadena vacia. Los `{{1}}`, `{{2}}` de Meta quedan como
 * variables locales "1", "2" (claves validas [a-z0-9_]+): se importa tal cual manda Meta.
 */
export function extraerCuerpoDeComponents(components: unknown): string {
  if (!Array.isArray(components)) return "";
  for (const c of components) {
    const parsed = bodyComponentSchema.safeParse(c);
    if (parsed.success && parsed.data.type.toUpperCase() === "BODY") {
      return parsed.data.text ?? "";
    }
  }
  return "";
}

/**
 * Traduce el status de revision de un template de Meta al enum local. APPROVED habilita el
 * envio (`activo`); REJECTED lo marca `refused`; cualquier otro estado intermedio (PENDING,
 * IN_APPEAL, PENDING_DELETION, ...) queda `pending`.
 */
export function mapEstadoMeta(status: string): PlantillaEstado {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return "activo";
    case "REJECTED":
      return "refused";
    default:
      return "pending";
  }
}

export class SincronizarPlantillasWhatsappService {
  constructor(
    private readonly client: WhatsappPlantillasClient,
    private readonly repo: IPlantillaMensajeRepository,
  ) {}

  async sincronizar(): Promise<SincronizarPlantillasResult> {
    const templates = await this.client.listar();
    let actualizadas = 0;
    let creadas = 0;
    let omitidas = 0;
    for (const t of templates) {
      const estado = mapEstadoMeta(t.status);
      // 1) intenta actualizar una plantilla local existente (por nombre).
      const actualizada = await this.repo.sincronizarTemplatePorNombre(t.nombre, {
        templateId: t.id,
        idioma: t.idioma,
        estado,
      });
      if (actualizada) {
        actualizadas += 1;
        continue;
      }
      // 2) no existia: la IMPORTA (crea) desde el template de Meta.
      const cuerpo = extraerCuerpoDeComponents(t.components);
      const creada = await this.repo.crearDesdeMeta({
        nombre: t.nombre,
        cuerpo,
        variables: extraerVariables(cuerpo),
        templateId: t.id,
        idioma: t.idioma,
        estado,
      });
      if (creada) creadas += 1;
      else omitidas += 1; // nombre ya en uso por una borrada: no se resucita
    }
    return { leidas: templates.length, actualizadas, creadas, omitidas };
  }
}
