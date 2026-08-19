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
import { GoogleRoutesClient } from "@/lib/clients/google-routes";
import { HaversineRouteOptimizationClient } from "@/lib/clients/haversine-route-optimization";
import { FallbackRouteOptimizationClient } from "@/lib/clients/fallback-route-optimization";
import { RutaOptimizadaRepository } from "@/lib/repositories/RutaOptimizadaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadRouteOptimizationConfig } from "@/lib/config/route-optimization";
import { construirTokenProvider } from "@/lib/auth/google-sa-token";
import type { TokenProvider } from "@/lib/auth/google-token-shared";
import { optlog, opterror } from "@/lib/logging/optimizer-log";

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
    optlog("job — recibido", { jobId: job.id, createdAt: job.createdAt.toISOString() });
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      optlog("job — payload invalido", { jobId: job.id });
      throw new Error("optimizacion_ruta: payload invalido (se esperaba { mensajeroId })");
    }
    try {
      await service.ejecutar(parsed.data.mensajeroId, {
        motivo: "debounce",
        jobCreatedAt: job.createdAt,
      });
      optlog("job — completado", { jobId: job.id });
    } catch (error) {
      // Se traza y se RE-LANZA: la cola necesita el fallo para su backoff y su dead-letter.
      opterror("job — fallo; la cola aplicara backoff", error, { jobId: job.id });
      throw error;
    }
  };
}

/**
 * Construye el service real con sus repos y el cliente HTTP.
 *
 * OJO: la config se carga aqui y NUNCA lanza si falta la credencial (design §2). La
 * ELECCION del modo de autenticacion (ADC / WIF keyless / JWT-bearer) y la validacion de
 * las piezas del modo elegido ocurren en `construirTokenProvider`, que lanza
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
  optlog("build — config cargada", {
    projectId: config.GOOGLE_ROUTE_OPT_PROJECT_ID ?? "AUSENTE",
    useAdc: config.GOOGLE_ROUTE_OPT_USE_ADC,
    timeoutMs: config.ROUTE_OPT_TIMEOUT_MS,
    maxParadas: config.RUTA_MAX_PARADAS,
    debounceS: config.RUTA_DEBOUNCE_S,
    origenTtlMin: config.RUTA_ORIGEN_TTL_MIN,
    syncMinIntervaloS: config.RUTA_SYNC_MIN_INTERVALO_S,
    routingPreference: config.ROUTES_ROUTING_PREFERENCE,
  });

  let tokenProvider: TokenProvider | null = null;
  // UN solo proveedor de token para las DOS APIs (optimizacion y trazado): el selector
  // ADC/WIF/JWT se resuelve una vez y ambos clientes heredan el modo que salga.
  const getToken = async () => {
    // R12: lanza `RutaNoConfiguradoError` ANTES de firmar nada y ANTES de la red.
    tokenProvider ??= construirTokenProvider(config);
    return tokenProvider.obtener();
  };

  const google = new GoogleRouteOptimizationClient({
    projectId: config.GOOGLE_ROUTE_OPT_PROJECT_ID ?? "",
    timeoutMs: config.ROUTE_OPT_TIMEOUT_MS,
    getToken,
  });

  const routes = new GoogleRoutesClient({
    getToken,
    timeoutMs: config.ROUTE_OPT_TIMEOUT_MS,
    routingPreference: config.ROUTES_ROUTING_PREFERENCE,
  });

  // Fallback (design §9.A): si falta la credencial, `google.optimizar` propaga
  // `RutaNoConfiguradoError` (perezoso, dentro de `getToken`) y el compuesto cae a un orden
  // local aproximado (Haversine + vecino mas cercano) en vez de dejar la ruta sin ordenar.
  // Cualquier otro fallo del proveedor se propaga tal cual.
  const client: IRouteOptimizationClient = new FallbackRouteOptimizationClient(
    google,
    new HaversineRouteOptimizationClient(),
  );

  return new OptimizacionRutaService(
    new RutaOptimizadaRepository(prisma),
    new OrdenRepository(prisma),
    client,
    config,
    now,
    undefined,
    routes,
  );
}
