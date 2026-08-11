// Feature 196 (R19-R22, design §5) — Route Handler del cron del SNAPSHOT DIARIO del ranking.
// Capa Controller: solo HTTP + autorizacion por `CRON_SECRET`; delega TODA la logica de
// negocio en RankingSnapshotService (docs/architecture.md, patron Controller -> Service ->
// Repo). Sin queries ni logica de negocio aqui. NUNCA emite el secreto ni PII (R21).
//
// Clon literal del patron de `corte-diario` (feature 41) / `generar-gastos-fijos` (feature 45),
// con el MISMO `CRON_SECRET` que ya comparten esos dos crons: no se inventa otra
// autenticacion. Auth ANTES de cualquier efecto (401 sin construir el service ni tocar la DB).
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import type { IRankingSnapshotService } from "@/lib/interfaces/services/IRankingSnapshotService";
import { RankingSnapshotService } from "@/lib/services/RankingSnapshotService";
import { RankingSnapshotRepository } from "@/lib/repositories/RankingSnapshotRepository";
import { RankingRepository } from "@/lib/repositories/RankingRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { PremioRankingRepository } from "@/lib/repositories/PremioRankingRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";

export interface SnapshotRankingDeps {
  // Secreto esperado (inyectable en tests). Por defecto, `CRON_SECRET` del entorno.
  getSecret?: () => string | null;
  service?: IRankingSnapshotService;
  // Reloj inyectable (tests): por defecto `new Date()`. R2/R15: la fecha congelada (D−1 CR)
  // se DERIVA de este instante dentro del service; el endpoint NO acepta fecha por parametro
  // ni la lee del querystring, asi que no hay backfill por la puerta de atras.
  now?: () => Date;
}

function buildService(): IRankingSnapshotService {
  const prisma = getPrismaClient();
  return new RankingSnapshotService(
    new RankingSnapshotRepository(prisma),
    new RankingRepository(prisma),
    new UserRepository(prisma),
    new PremioRankingRepository(prisma),
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
 * (secreto + service fake + reloj) sin DB real ni entorno. R19: secreto ausente, mal formado,
 * distinto o NO CONFIGURADO en el entorno -> 401 sin efecto alguno (ni siquiera se construye
 * el service ni se toca la DB). R21: el secreto no sale nunca en la respuesta ni en los logs.
 */
export async function handleSnapshotRanking(
  req: Request,
  deps: SnapshotRankingDeps = {},
): Promise<NextResponse> {
  // R19: autorizacion ANTES de cualquier efecto. Secreto no configurado -> 401 (el endpoint
  // no queda abierto). Reutiliza el MISMO CRON_SECRET que corte-diario/generar-gastos-fijos.
  const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();
  const provided = bearerToken(req);
  if (expected === null || provided === null || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withErrorHandler(async () => {
    const service = deps.service ?? buildService();
    const ahora = (deps.now ?? (() => new Date()))();
    const resumen = await service.congelar(ahora);
    // R20: exactamente tres claves y ninguna PII —ni un nombre, ni un id—. `status` es el
    // vocabulario del dominio; en el borde HTTP la clave se llama `estado` (design §5).
    return {
      fecha: resumen.fecha,
      estado: resumen.status,
      filas: resumen.filas,
    };
  });

  // R22: el fallo se registra por el canal de errores del repo (`withErrorHandler` ->
  // `normalizeError` -> `defaultLogger.logError`) y se responde con error, nunca en silencio.
  // R21: `appErrorToResponse` normaliza sin filtrar el secreto ni datos personales.
  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleSnapshotRanking(req);
}
