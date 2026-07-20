// Feature 91 (design §7, R32) — handler DELGADO del job `geocodificacion` y su fabrica de
// dependencias reales. Espejo de `liberar-reprogramadas-handler.ts`.
//
// Este tipo de job NO es recurrente: no se registra en `buildRecurrencias()`. Se encola
// por EVENTO (creacion o correccion de la direccion de una orden), no por reloj.
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { IGeocodeClient } from "@/lib/interfaces/external/IGeocodeClient";
import { GeocodificacionService } from "@/lib/services/GeocodificacionService";
import { GoogleGeocodeClient } from "@/lib/clients/google-geocode";
import { OrdenGeocodeRepository } from "@/lib/repositories/OrdenGeocodeRepository";
import { GeocodeCacheRepository } from "@/lib/repositories/GeocodeCacheRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadGeocodeConfig } from "@/lib/config/geocode";

/** R32: adapta `GeocodificacionService.ejecutar` a la firma `JobHandler`. */
export function crearGeocodificacionHandler(service: GeocodificacionService): JobHandler {
  return async (job: JobDTO) => {
    await service.ejecutar(job);
  };
}

/**
 * Construye el service real con sus repos y el cliente HTTP (patron
 * `buildLiberarReprogramadasService`).
 *
 * OJO: la config se carga aqui y NUNCA lanza si falta la credencial (design §2). Sin
 * credencial se construye igualmente un cliente (que no llegara a usarse, porque el
 * service corta antes con `GeocodeNoConfiguradoError`, R25). Esto es lo que garantiza que
 * un despliegue sin `GOOGLE_MAPS_API_KEY` NO tumbe el drenado de la cola, que comparte
 * cron con `liberar_reprogramadas` (feature 46, ya en produccion).
 */
export function buildGeocodificacionService(now: () => Date = () => new Date()) {
  const prisma = getPrismaClient();
  const config = loadGeocodeConfig();
  const client: IGeocodeClient = new GoogleGeocodeClient({
    apiKey: config.GOOGLE_MAPS_API_KEY ?? "",
    timeoutMs: config.GEOCODE_TIMEOUT_MS,
  });
  return new GeocodificacionService(
    new OrdenGeocodeRepository(prisma),
    new GeocodeCacheRepository(prisma),
    client,
    config,
    now,
  );
}
