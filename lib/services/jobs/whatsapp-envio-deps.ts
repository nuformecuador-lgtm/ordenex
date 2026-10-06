// Ficha 474 (design §8, T8.1) — dependencias REALES de los envios automaticos por WhatsApp, para los
// handlers de la cola y las server actions. UN solo composition root para el motor.
//
// La credencial de Meta se carga PEREZOSAMENTE (dentro de `meta()`): un env ausente falla ESE job
// con su motivo en `last_error` —y la ejecucion queda `error` «WhatsApp no está configurado»—, no el
// drenado de los demas tipos (patron `whatsapp-bienvenida-handler.ts`). Construir esto NO abre
// conexion ni lee env de Meta.
import type { PrismaClient } from "@prisma/client";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { WhatsappEnvioRepository } from "@/lib/repositories/WhatsappEnvioRepository";
import { WhatsappEjecucionRepository } from "@/lib/repositories/WhatsappEjecucionRepository";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { SupabaseAlmacenEnviosWhatsapp } from "@/lib/storage/SupabaseAlmacenEnviosWhatsapp";
import { WhatsappCloudClient } from "@/lib/clients/whatsapp-cloud";
import { WhatsappMediaUploadClient } from "@/lib/clients/whatsapp-media-upload";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";
import { consoleLogger } from "@/lib/services/whatsapp/chat-logger";
import { EjecucionEnvioService, type MetaEnvios } from "@/lib/services/EjecucionEnvioService";
import { WhatsappEnvioService } from "@/lib/services/WhatsappEnvioService";

export interface EnviosWhatsappDeps {
  prisma: PrismaClient;
  envios: WhatsappEnvioRepository;
  ejecuciones: WhatsappEjecucionRepository;
  cola: JobRepository;
  almacen: SupabaseAlmacenEnviosWhatsapp;
  ejecutor: EjecucionEnvioService;
  configuracion: WhatsappEnvioService;
}

/** Meta real, construida al PRIMER uso de cada ejecucion. Lanza si falta una credencial. */
export function metaReal(): MetaEnvios {
  const config = loadWhatsappConfig();
  return {
    enviador: new WhatsappCloudClient({ config, logger: consoleLogger }),
    subidor: new WhatsappMediaUploadClient({ config }),
    idioma: config.templateIdioma,
  };
}

export function buildEnviosWhatsappDeps(now: () => Date = () => new Date()): EnviosWhatsappDeps {
  const prisma = getPrismaClient();
  const envios = new WhatsappEnvioRepository(prisma);
  const ejecuciones = new WhatsappEjecucionRepository(prisma);
  const plantillas = new PlantillaMensajeRepository(prisma);
  const cola = new JobRepository(prisma);
  const almacen = new SupabaseAlmacenEnviosWhatsapp();
  const ejecutor = new EjecucionEnvioService({ envios, ejecuciones, plantillas, almacen, cola, meta: metaReal, now });
  const configuracion = new WhatsappEnvioService({ envios, ejecuciones, plantillas, cola, now });
  return { prisma, envios, ejecuciones, cola, almacen, ejecutor, configuracion };
}
