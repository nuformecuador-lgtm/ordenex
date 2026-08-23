// Feature 99 — Route Handler del cron SLA de devoluciones diferidas (R10-R13). Capa Controller:
// solo HTTP + autorizacion por `CRON_SECRET`; delega TODA la logica de negocio en
// `DevolucionSlaService` (docs/architecture.md, patron Controller -> Service -> Repo). Sin
// queries ni logica de negocio aqui. NUNCA loguea el secreto ni PII (R11). Clon del patron de
// `liberar-reprogramadas` (feature 46), con el MISMO CRON_SECRET.
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import type { IDevolucionSlaService } from "@/lib/interfaces/services/IDevolucionSlaService";
import { DevolucionSlaService } from "@/lib/services/DevolucionSlaService";
import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";

export interface ProcesarDevueltasSlaDeps {
  // Secreto esperado (inyectable en tests). Por defecto, `CRON_SECRET` del entorno.
  getSecret?: () => string | null;
  service?: IDevolucionSlaService;
  // Reloj inyectable (tests): por defecto `new Date()`. Se pasa CRUDO al service (ventana
  // rolling en milisegundos, R13), no por `startOfDayCR` (esto no es un corte diario).
  now?: () => Date;
}

function buildService(): IDevolucionSlaService {
  const prisma = getPrismaClient();
  return new DevolucionSlaService(
    new DevolucionSlaRepository(prisma),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
    new OrdenHistorialService(
      new OrdenRepository(prisma),
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
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
 * Logica del endpoint, extraida de `GET` para permitir inyeccion de dependencias en tests
 * (secreto + service fake + reloj) sin DB real ni entorno. R10: sin/incorrecto secreto (o no
 * configurado) -> 401 sin efectos (ni siquiera se construye el service). R11: nunca se loguea el
 * secreto ni PII. R12: 200 con conteos agregados. R13: reloj inyectable.
 */
export async function handleProcesarDevueltasSla(
  req: Request,
  deps: ProcesarDevueltasSlaDeps = {},
): Promise<NextResponse> {
  // R10: autorizacion ANTES de cualquier efecto. Secreto no configurado -> 401.
  const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();
  const provided = bearerToken(req);
  if (expected === null || provided === null || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withErrorHandler(async () => {
    const service = deps.service ?? buildService();
    // R13: reloj inyectable (por defecto now()); ventana rolling en milisegundos.
    const now = (deps.now ?? (() => new Date()))();
    const resumen = await service.ejecutar(now);
    // R12/R11: resumen SIN PII (solo conteos).
    return {
      evaluadas: resumen.evaluadas,
      liberadas: resumen.liberadas,
      escaladas: resumen.escaladas,
      omitidas: resumen.omitidas,
      // Feature 239 (T3.3, R14/R35): cuantas se anclaron por la rama LEGADA (sin fila de
      // `anclaje_devolucion`). Es el UNICO cambio del contrato HTTP de este endpoint, y es
      // aditivo. Sirve para ver extinguirse la poblacion que quedo en vuelo el dia del
      // despliegue: deberia bajar a cero y quedarse ahi.
      legadas: resumen.legadas,
    };
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result); // error notificado por el logger, sin secreto
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleProcesarDevueltasSla(req);
}
