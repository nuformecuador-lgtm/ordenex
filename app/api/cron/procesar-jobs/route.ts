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

export interface ProcesarJobsDeps {
  // Secreto esperado (inyectable en tests). Por defecto, `CRON_SECRET` del entorno.
  getSecret?: () => string | null;
  service?: IJobQueueService;
  // Reloj inyectable (tests): por defecto `new Date()`.
  now?: () => Date;
}

/** Registro de handlers por tipo de job. En v1 solo `liberar_reprogramadas`; 91/92 anaden. */
function buildHandlers(now: () => Date): Map<JobTipo, JobHandler> {
  const handlers = new Map<JobTipo, JobHandler>();
  handlers.set(
    "liberar_reprogramadas",
    crearLiberarReprogramadasHandler(buildLiberarReprogramadasService(), now),
  );
  return handlers;
}

/** Registro de recurrencia por tipo. Solo `liberar_reprogramadas` es recurrente en v1. */
function buildRecurrencias(): Map<JobTipo, RecurrenciaSpec> {
  const recurrencias = new Map<JobTipo, RecurrenciaSpec>();
  recurrencias.set("liberar_reprogramadas", recurrenciaLiberarReprogramadas);
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
