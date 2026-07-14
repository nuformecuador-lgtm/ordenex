// Feature 45 (R27-R31) — Route Handler del cron mensual de GASTOS FIJOS. Capa Controller:
// solo HTTP + autorizacion por `CRON_SECRET`; delega TODA la logica de negocio en
// GeneracionGastosFijosService (docs/architecture.md, patron Controller -> Service -> Repo).
// Sin queries ni logica de negocio aqui. NUNCA loguea el secreto ni PII (R29). Clon del patron
// de `corte-diario` (feature 41) / `liberar-reprogramadas` (feature 46), con el MISMO
// CRON_SECRET. Auth ANTES de cualquier efecto (401 sin construir el service ni tocar la DB).
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import type { IGeneracionGastosFijosService } from "@/lib/interfaces/services/IGeneracionGastosFijosService";
import { GeneracionGastosFijosService } from "@/lib/services/GeneracionGastosFijosService";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { GastoFijoPlantillaRepository } from "@/lib/repositories/GastoFijoPlantillaRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";

export interface GenerarGastosFijosDeps {
  // Secreto esperado (inyectable en tests). Por defecto, `CRON_SECRET` del entorno.
  getSecret?: () => string | null;
  service?: IGeneracionGastosFijosService;
  // Reloj inyectable (tests): por defecto `new Date()`. Determina el periodo YYYY-MM CR (R30).
  now?: () => Date;
}

function buildService(): IGeneracionGastosFijosService {
  const prisma = getPrismaClient();
  return new GeneracionGastosFijosService(
    new GastoFijoPlantillaRepository(prisma),
    new WalletMovimientoRepository(prisma),
    prisma,
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
 * (secreto + service fake + reloj) sin DB real ni entorno. R29: sin/incorrecto secreto (o no
 * configurado) -> 401 sin efectos (ni siquiera se construye el service ni se toca la DB).
 * NUNCA se loguea el secreto. 200 con conteos agregados (sin PII).
 */
export async function handleGenerarGastosFijos(
  req: Request,
  deps: GenerarGastosFijosDeps = {},
): Promise<NextResponse> {
  // R29: autorizacion ANTES de cualquier efecto. Secreto no configurado -> 401 (el endpoint
  // no queda abierto). Reutiliza el MISMO CRON_SECRET que corte-diario/liberar-reprogramadas.
  const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();
  const provided = bearerToken(req);
  if (expected === null || provided === null || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withErrorHandler(async () => {
    const service = deps.service ?? buildService();
    // R30: el periodo YYYY-MM se deriva de `now` en hora CR dentro del service.
    const hoy = (deps.now ?? (() => new Date()))();
    const resumen = await service.ejecutarGeneracion(hoy);
    // R29: resumen SIN PII (solo conteos + periodo).
    return {
      periodo: resumen.periodo,
      plantillasActivas: resumen.plantillasActivas,
      egresosGenerados: resumen.egresosGenerados,
    };
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result); // error notificado por el logger, sin secreto
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleGenerarGastosFijos(req);
}
