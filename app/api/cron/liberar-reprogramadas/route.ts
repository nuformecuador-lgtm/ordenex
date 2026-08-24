// Feature 46 — Route Handler de la liberacion programada de reprogramadas (R6/R7/R19/R20).
// Capa Controller: solo HTTP + autorizacion por `CRON_SECRET`; delega TODA la logica de
// negocio en LiberacionReprogramadaService (docs/architecture.md, patron Controller ->
// Service -> Repo). Sin queries ni logica de negocio aqui. NUNCA loguea el secreto ni PII
// (R19). Clon del patron de `corte-diario` (feature 41), con el MISMO CRON_SECRET.
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import type { ILiberacionReprogramadaService } from "@/lib/interfaces/services/ILiberacionReprogramadaService";
import { LiberacionReprogramadaService } from "@/lib/services/LiberacionReprogramadaService";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";
import { startOfDayCR } from "@/lib/utils/fecha-cr";

export interface LiberarReprogramadasDeps {
  // Secreto esperado (inyectable en tests). Por defecto, `CRON_SECRET` del entorno.
  getSecret?: () => string | null;
  service?: ILiberacionReprogramadaService;
  // Reloj inyectable (tests): por defecto `new Date()`. Se pasa por `startOfDayCR` (R9).
  now?: () => Date;
}

function buildService(): ILiberacionReprogramadaService {
  const prisma = getPrismaClient();
  return new LiberacionReprogramadaService(
    new LiberacionReprogramadaRepository(prisma),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
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
 * Logica del endpoint, extraida de `GET` para permitir inyeccion de dependencias en
 * tests (secreto + service fake + reloj) sin DB real ni entorno. R6: sin/incorrecto
 * secreto (o no configurado) -> 401 sin efectos (ni siquiera se construye el service).
 * R19: nunca se loguea el secreto. R7: 200 con conteos agregados (sin PII).
 */
export async function handleLiberarReprogramadas(
  req: Request,
  deps: LiberarReprogramadasDeps = {},
): Promise<NextResponse> {
  // R6: autorizacion ANTES de cualquier efecto. Secreto no configurado -> 401.
  const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();
  const provided = bearerToken(req);
  if (expected === null || provided === null || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withErrorHandler(async () => {
    const service = deps.service ?? buildService();
    // R9: "hoy" en zona America/Costa_Rica (UTC-6) para comparar fecha_reprogramacion.
    const hoyCR = startOfDayCR((deps.now ?? (() => new Date()))());
    const resumen = await service.ejecutarLiberacion(hoyCR);
    // R7/R19: resumen SIN PII (solo conteos).
    return {
      evaluadas: resumen.evaluadas,
      liberadas: resumen.liberadas,
      omitidas: resumen.omitidas,
      // FEATURE 276 (T6.2, R12/R13): el contador de las congeladas. Es un AGREGADO sin PII y es lo
      // unico que hace observable, desde fuera, la poblacion que espera una aprobacion de cierre.
      // `?? 0` por el patron aditivo del `LiberacionResult`.
      esperandoCierre: resumen.esperandoCierre ?? 0,
    };
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result); // error notificado por el logger, sin secreto
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleLiberarReprogramadas(req);
}
