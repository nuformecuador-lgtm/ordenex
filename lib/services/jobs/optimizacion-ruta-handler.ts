// Feature 92 (design §4.4, R21) — handler DELGADO del job `optimizacion_ruta` y su fabrica
// de dependencias reales. Espejo de `geocodificacion-handler.ts`.
//
// Este tipo de job NO es recurrente: NO se registra en `buildRecurrencias()`. Se encola por
// EVENTO (recogida con debounce, gestion inmediata), no por reloj.
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { IRouteOptimizationClient } from "@/lib/interfaces/external/IRouteOptimizationClient";
import { OptimizacionRutaService } from "@/lib/services/OptimizacionRutaService";
import { GoogleRouteOptimizationClient } from "@/lib/clients/google-route-optimization";
import { RutaOptimizadaRepository } from "@/lib/repositories/RutaOptimizadaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadRouteOptimizationConfig } from "@/lib/config/route-optimization";
import { construirTokenProvider } from "@/lib/auth/google-sa-token";

/** R21/PII: el payload lleva SOLO el id del mensajero. Cualquier otra forma es un error. */
const payloadSchema = z.object({ mensajeroId: z.string().min(1) });

/**
 * Adapta `OptimizacionRutaService.ejecutar` a la firma `JobHandler`.
 *
 * R20: se pasa `job.createdAt` como `jobCreatedAt`. Es la pieza que hace funcionar la
 * guarda de obsolescencia: sin ella, el debounce en vuelo pagaria una reoptimizacion que
 * un disparo inmediato posterior ya hizo.
 */
export function crearOptimizacionRutaHandler(service: OptimizacionRutaService): JobHandler {
  return async (job: JobDTO) => {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error("optimizacion_ruta: payload invalido (se esperaba { mensajeroId })");
    }
    await service.ejecutar(parsed.data.mensajeroId, {
      motivo: "debounce",
      jobCreatedAt: job.createdAt,
    });
  };
}

/**
 * Construye el service real con sus repos y el cliente HTTP.
 *
 * OJO: la config se carga aqui y NUNCA lanza si falta la credencial (design §2). La
 * validacion de las tres piezas ocurre en `construirTokenProvider`, que lanza
 * `RutaNoConfiguradoError` — pero SOLO cuando se pide el token, es decir DESPUES de todas
 * las guardas de coste y dentro del `try` por job de `JobQueueService.drenar`. Esto es lo
 * que garantiza que un despliegue sin credencial de Route Optimization NO tumbe el drenado
 * de la cola, que comparte cron con `liberar_reprogramadas` (feature 46, en produccion) y
 * `geocodificacion` (feature 91). El proveedor de token se construye PEREZOSAMENTE por el
 * mismo motivo: construirlo aqui lanzaria al registrar el handler.
 */
export function buildOptimizacionRutaService(now: () => Date = () => new Date()) {
  const prisma = getPrismaClient();
  const config = loadRouteOptimizationConfig();

  let tokenProvider: ReturnType<typeof construirTokenProvider> | null = null;
  const client: IRouteOptimizationClient = new GoogleRouteOptimizationClient({
    projectId: config.GOOGLE_ROUTE_OPT_PROJECT_ID ?? "",
    timeoutMs: config.ROUTE_OPT_TIMEOUT_MS,
    getToken: async () => {
      // R12: lanza `RutaNoConfiguradoError` ANTES de firmar nada y ANTES de la red.
      tokenProvider ??= construirTokenProvider(config);
      return tokenProvider.obtener();
    },
  });

  return new OptimizacionRutaService(
    new RutaOptimizadaRepository(prisma),
    new OrdenRepository(prisma),
    client,
    config,
    now,
  );
}
