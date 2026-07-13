// Feature 41 — Route Handler del corte diario (R5/R11/R24). Capa Controller: solo HTTP
// + autorizacion por `CRON_SECRET`; delega TODA la logica de negocio en
// CorteDiarioService (docs/architecture.md, patron Controller -> Service -> Repo). Sin
// queries ni logica de negocio aqui. NUNCA loguea el secreto ni PII (R24).
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import type { ICorteDiarioService } from "@/lib/interfaces/services/ICorteDiarioService";
import { CorteDiarioService } from "@/lib/services/CorteDiarioService";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";

export interface CorteDiarioDeps {
  // Secreto esperado (inyectable en tests). Por defecto, `CRON_SECRET` del entorno.
  getSecret?: () => string | null;
  service?: ICorteDiarioService;
}

function buildService(): ICorteDiarioService {
  const prisma = getPrismaClient();
  return new CorteDiarioService(
    new CorteDiarioRepository(prisma),
    new CierreDiaRepository(prisma),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
    new TarifaZonaMensajeroRepository(prisma),
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
 * tests (secreto + service fake) sin DB real ni entorno. R5: sin/incorrecto secreto ->
 * 401 sin efectos (ni siquiera se construye el service). R24: nunca se loguea el secreto.
 */
export async function handleCorteDiario(
  req: Request,
  deps: CorteDiarioDeps = {},
): Promise<NextResponse> {
  // R5: autorizacion ANTES de cualquier efecto. Secreto no configurado -> 401 (no se
  // ejecuta el corte con el endpoint abierto).
  const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();
  const provided = bearerToken(req);
  if (expected === null || provided === null || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withErrorHandler(async () => {
    const service = deps.service ?? buildService();
    const resumen = await service.ejecutarCorte();
    // R24: resumen SIN PII (solo conteos).
    return {
      vencidosCreados: resumen.vencidosCreados,
      mensajerosEvaluados: resumen.mensajerosEvaluados,
    };
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result); // error notificado por el logger, sin secreto
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleCorteDiario(req);
}
