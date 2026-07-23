// Integracion WhatsApp — PROPAGACION local -> Meta de las mutaciones de plantilla.
//
// POLITICA (decision humana): la operacion contra Meta se intenta EN LINEA justo despues de
// que la mutacion local commitee. Si Meta responde bien, se enlaza el template. Si FALLA, NO
// se propaga el error al usuario (la plantilla local ya quedo guardada): se encola un job
// `whatsapp_template_sync` que reintenta con backoff hasta MAX_INTENTOS_WHATSAPP_TEMPLATE (5)
// y, agotados, cae al dead-letter visible de la cola.
//
// El mismo `IWhatsappTemplatePort` lo usan este propagador (camino sincrono) y el handler del
// job (camino de reintento). La diferencia: aqui un fallo se captura y se encola; en el job un
// fallo se relanza para que la cola aplique el backoff.

import type {
  IPlantillaMensajeRepository,
  PlantillaPublica,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { IWhatsappTemplatePort } from "@/lib/interfaces/services/IWhatsappTemplatePort";
import { defaultLogger, type ErrorLogger } from "@/lib/errors";

/** Operacion a reflejar en Meta. */
export type WhatsappTemplateOperacion = "crear" | "actualizar" | "eliminar";

/** Payload del job `whatsapp_template_sync` (sin secretos ni PII: solo ids y la operacion). */
export interface WhatsappTemplateSyncPayload {
  plantillaId: string;
  operacion: WhatsappTemplateOperacion;
  /** Solo en `eliminar`: la plantilla local ya esta soft-deleted, el nombre viaja en el job. */
  nombre?: string;
}

/**
 * Encolador inyectable del job de reintento (implementado sobre `IJobRepository.enqueue`).
 * `lastError` = motivo del fallo sincrono, para grabarlo en `last_error` desde el encolado.
 */
export type EncolarWhatsappTemplateSync = (
  payload: WhatsappTemplateSyncPayload,
  lastError?: string,
) => Promise<void>;

/** Mensaje SEGURO de un error (los errores de WhatsApp ya evitan secretos por diseno). */
function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Aplica a Meta la operacion sobre una plantilla concreta (crear si no esta enlazada, o
 * actualizar si ya tiene templateId) y persiste el enlace. Reutilizado por el propagador y el
 * job. Lanza si Meta falla (el llamador decide: encolar vs backoff).
 */
export async function aplicarUpsertTemplate(
  port: IWhatsappTemplatePort,
  repo: Pick<IPlantillaMensajeRepository, "setTemplate">,
  plantilla: Pick<PlantillaPublica, "id" | "nombre" | "cuerpo" | "variables" | "templateId">,
): Promise<void> {
  const input = {
    nombre: plantilla.nombre,
    cuerpo: plantilla.cuerpo,
    variables: plantilla.variables,
  };
  if (plantilla.templateId === null) {
    const enlace = await port.crearTemplate(input);
    await repo.setTemplate(plantilla.id, enlace);
  } else {
    await port.actualizarTemplate(plantilla.templateId, input);
  }
}

/**
 * Propagador que el `PlantillaMensajeService` invoca tras cada mutacion local. Sus metodos
 * NUNCA lanzan: un fallo de Meta se degrada a un job de reintento.
 */
export class PlantillaWhatsappPropagator {
  constructor(
    private readonly port: IWhatsappTemplatePort,
    private readonly repo: Pick<IPlantillaMensajeRepository, "setTemplate">,
    private readonly encolar: EncolarWhatsappTemplateSync,
    // Logger inyectable: el fallo de Meta se registra en el servidor (sin secretos) ANTES de
    // encolar el reintento, para que no quede invisible mientras el job espera al cron.
    private readonly logger: ErrorLogger = defaultLogger,
  ) {}

  /** Tras crear una plantilla local: crea su template en Meta. */
  async trasCrear(plantilla: PlantillaPublica): Promise<void> {
    await this.intentar(plantilla, "crear");
  }

  /** Tras actualizar nombre/cuerpo: crea (si no enlazada) o actualiza el template en Meta. */
  async trasActualizar(plantilla: PlantillaPublica): Promise<void> {
    await this.intentar(plantilla, "actualizar");
  }

  /** Tras el soft-delete local: borra el template en Meta (por nombre). */
  async trasEliminar(id: string, nombre: string): Promise<void> {
    try {
      await this.port.eliminarTemplate(nombre);
    } catch (error) {
      this.logger.logError(error);
      await this.encolar({ plantillaId: id, operacion: "eliminar", nombre }, mensajeDe(error));
    }
  }

  private async intentar(
    plantilla: PlantillaPublica,
    operacion: Exclude<WhatsappTemplateOperacion, "eliminar">,
  ): Promise<void> {
    try {
      await aplicarUpsertTemplate(this.port, this.repo, plantilla);
    } catch (error) {
      this.logger.logError(error);
      await this.encolar({ plantillaId: plantilla.id, operacion }, mensajeDe(error));
    }
  }
}
