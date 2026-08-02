// Feature 90 (design §6, R17-R19) — Route Handler del drenador de la cola de jobs. Capa
// Controller: solo HTTP + autorizacion por `CRON_SECRET` (el MISMO que corte-diario /
// liberar-reprogramadas); delega TODA la logica en `JobQueueService`. Sin queries ni logica
// de negocio aqui. NUNCA loguea el secreto ni PII (R18/R19). Clon estructural EXACTO de
// `liberar-reprogramadas/route.ts`. Unico disparador temporal del drenado: Vercel Cron
// cada minuto (`* * * * *`, R20).
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import type { IJobQueueService } from "@/lib/interfaces/services/IJobQueueService";
import type { JobHandler, RecurrenciaSpec } from "@/lib/interfaces/services/IJobQueueService";
import { JobQueueService } from "@/lib/services/JobQueueService";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";
import { loadJobsConfig } from "@/lib/config/jobs";
import type { JobTipo } from "@prisma/client";
import {
  buildLiberarReprogramadasService,
  crearLiberarReprogramadasHandler,
  recurrenciaLiberarReprogramadas,
} from "@/lib/services/jobs/liberar-reprogramadas-handler";
import {
  buildGeocodificacionService,
  crearGeocodificacionHandler,
} from "@/lib/services/jobs/geocodificacion-handler";
import {
  buildOptimizacionRutaService,
  crearOptimizacionRutaHandler,
} from "@/lib/services/jobs/optimizacion-ruta-handler";
import {
  buildWebhookEstadoService,
  crearWebhookEstadoHandler,
} from "@/lib/services/jobs/webhook-estado-handler";
import { crearWhatsappTemplateSyncHandler } from "@/lib/services/jobs/whatsapp-template-sync-handler";
import { crearWhatsappChatEnvioHandler } from "@/lib/services/jobs/whatsapp-chat-envio-handler";
import {
  buildAnaliticaRollupService,
  crearAnaliticaRollupDiarioHandler,
  recurrenciaAnaliticaRollupDiario,
} from "@/lib/services/jobs/analitica-rollup-diario-handler";

export interface ProcesarJobsDeps {
  // Secreto esperado (inyectable en tests). Por defecto, `CRON_SECRET` del entorno.
  getSecret?: () => string | null;
  service?: IJobQueueService;
  // Reloj inyectable (tests): por defecto `new Date()`.
  now?: () => Date;
}

/**
 * Registro de handlers por tipo de job. La 91 anade `geocodificacion`; falta la 92.
 * Exportada para que el test de registro (R32) verifique que el tipo esta enganchado sin
 * levantar el endpoint entero. Construir el service NO abre conexion (singleton perezoso).
 */
export function buildHandlers(now: () => Date): Map<JobTipo, JobHandler> {
  const handlers = new Map<JobTipo, JobHandler>();
  handlers.set(
    "liberar_reprogramadas",
    crearLiberarReprogramadasHandler(buildLiberarReprogramadasService(), now),
  );
  // Feature 91 (R32): geocodificacion de la direccion de UNA orden. NO se registra en
  // `buildRecurrencias()`: se encola por EVENTO, no por reloj. Un fallo suyo (p. ej. sin
  // `GOOGLE_MAPS_API_KEY`) lo captura `JobQueueService.drenar` job a job, asi que NO
  // afecta al drenado de `liberar_reprogramadas`, que comparte este cron.
  handlers.set("geocodificacion", crearGeocodificacionHandler(buildGeocodificacionService(now)));
  // Feature 92 (R21): reoptimizacion de la ruta de UN mensajero. Como la geocodificacion,
  // NO se registra en `buildRecurrencias()`: se encola por EVENTO (recogida con debounce,
  // gestion inmediata), nunca por reloj. Un fallo suyo (p. ej. sin credencial de service
  // account) lo captura `JobQueueService.drenar` job a job, asi que NO afecta al drenado
  // de `liberar_reprogramadas` ni de `geocodificacion`, que comparten este cron.
  handlers.set(
    "optimizacion_ruta",
    crearOptimizacionRutaHandler(buildOptimizacionRutaService(now)),
  );
  // Feature 99 (R26): entrega firmada del cambio de estado a un integrador suscrito. Como la
  // geocodificacion y la optimizacion, NO se registra en `buildRecurrencias()`: se encola por
  // EVENTO (transicion de estado con owner suscrito), nunca por reloj. Un fallo suyo (callback
  // caido, clave de cifrado ausente) lo captura `JobQueueService.drenar` job a job, asi que NO
  // afecta al drenado de los otros tipos, que comparten este cron.
  handlers.set("webhook_estado", crearWebhookEstadoHandler(buildWebhookEstadoService(now)));
  // Integracion WhatsApp: reintento de una op de plantilla (create/update/delete) que fallo en
  // linea. Encolado por EVENTO (fallo de la propagacion sincrona), no por reloj -> fuera de
  // `buildRecurrencias()`. Las deps (config de WhatsApp) se cargan perezosamente en el handler:
  // un env ausente falla ESTE job (recuperable), no el drenado de los demas tipos.
  handlers.set("whatsapp_template_sync", crearWhatsappTemplateSyncHandler());
  // Feature 109 (D1/F3): reintento del envio saliente de un mensaje de chat que devolvio
  // `transitorio` en linea. Encolado por EVENTO (fallo transitorio), no por reloj -> fuera de
  // `buildRecurrencias()`. Las deps (config de WhatsApp) se cargan perezosamente en el
  // handler: un env ausente falla ESTE job (recuperable), no el drenado de los demas tipos.
  handlers.set("whatsapp_chat_envio", crearWhatsappChatEnvioHandler());
  // Feature 124 (D4->C1, R36): agrega en el rollup diario la fecha CR que acaba de cerrar.
  // A DIFERENCIA de geocodificacion / optimizacion / webhook / whatsapp, este tipo SI se
  // registra en `buildRecurrencias()`: no lo dispara ningun evento del dominio —nadie "crea"
  // un dia—, lo dispara el RELOJ, una vez por dia CR. Sin recurrencia la cola se vaciaria
  // tras la primera corrida y el rollup dejaria de escribirse en silencio, que es el modo de
  // fallo mas caro de esta feature: la tabla no se rompe, simplemente deja de crecer.
  handlers.set(
    "analitica_rollup_diario",
    crearAnaliticaRollupDiarioHandler(buildAnaliticaRollupService(now), now),
  );
  return handlers;
}

/**
 * Registro de recurrencia por tipo. Recurrentes son los tipos que dispara el RELOJ:
 * `liberar_reprogramadas` (00:00 CR) y, desde la 124, `analitica_rollup_diario` (00:30 CR).
 * La geocodificacion, la optimizacion de ruta, el webhook de estado y los dos de WhatsApp se
 * encolan por EVENTO y NO deben re-agendarse (R32/R21). Exportada por el mismo motivo que
 * `buildHandlers`.
 */
export function buildRecurrencias(): Map<JobTipo, RecurrenciaSpec> {
  const recurrencias = new Map<JobTipo, RecurrenciaSpec>();
  recurrencias.set("liberar_reprogramadas", recurrenciaLiberarReprogramadas);
  // Feature 124 (D4->C1, R36): el rollup diario es RECURRENTE porque nada en el dominio lo
  // dispara —el hecho de que un dia cierre no genera ningun evento—. Cada corrida re-agenda
  // la siguiente a las 00:30 CR con el `dedupe_key` de la fecha que agregara, asi que la
  // cola se auto-perpetua y un fallo terminal de una ocurrencia no detiene la serie.
  recurrencias.set("analitica_rollup_diario", recurrenciaAnaliticaRollupDiario);
  return recurrencias;
}

function buildService(now: () => Date): IJobQueueService {
  const prisma = getPrismaClient();
  return new JobQueueService(
    new JobRepository(prisma),
    buildHandlers(now),
    buildRecurrencias(),
    loadJobsConfig(),
    now,
  );
}

// Extrae el token `Bearer <token>` del header Authorization; null si ausente/mal formado.
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header === null) return null;
  const match = header.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

/**
 * Logica del endpoint, extraida de `GET` para inyeccion de dependencias en tests (secreto +
 * service fake + reloj) sin DB real ni entorno. R17: sin/incorrecto secreto (o no
 * configurado) -> 401 sin efectos (ni siquiera se construye el service). R19: nunca se
 * loguea el secreto. R18: 200 con conteos agregados (sin PII).
 */
export async function handleProcesarJobs(
  req: Request,
  deps: ProcesarJobsDeps = {},
): Promise<NextResponse> {
  // R17: autorizacion ANTES de cualquier efecto. Secreto no configurado -> 401.
  const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();
  const provided = bearerToken(req);
  if (expected === null || provided === null || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withErrorHandler(async () => {
    const now = deps.now ?? (() => new Date());
    const service = deps.service ?? buildService(now);
    // R18: drena hasta JOBS_BATCH_SIZE jobs; devuelve conteos agregados SIN PII.
    return service.drenar(loadJobsConfig().JOBS_BATCH_SIZE);
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result); // R19: sin secreto ni PII
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleProcesarJobs(req);
}
