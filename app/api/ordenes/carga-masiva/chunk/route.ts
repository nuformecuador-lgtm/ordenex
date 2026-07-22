// Carga masiva por CHUNKS — Route Handler que recibe un LOTE de filas ya
// parseadas en el navegador (JSON), no el archivo. Evita el límite de body del
// route handler (~4.5MB en Vercel): el archivo se parsea/deduplica en el cliente
// y sus filas llegan en lotes pequeños. Cada lote reutiliza `BulkOrdenService`
// (misma validación/persistencia; `dryRun` para la validación previa).
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  withErrorHandler,
  isAppErrorShape,
  appErrorToResponse,
  UnauthenticatedError,
  ForbiddenError,
  ValidationError,
  MSG,
} from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IBulkOrdenService } from "@/lib/interfaces/services/IBulkOrdenService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";

export interface CargaMasivaChunkDeps {
  getActor?: () => Promise<Actor | null>;
  bulkService?: IBulkOrdenService;
}

function buildBulkService(): IBulkOrdenService {
  const prisma = getPrismaClient();
  // La via sesion (`cargarMasiva`) NO usa el resolver de tarifa (feature 98/R9); se inyecta solo
  // para satisfacer el contrato del constructor (dependencia requerida, compartida con la via API).
  return new BulkOrdenService(
    new OrdenRepository(prisma),
    new TarifaVigentePorTiendaRepository(prisma),
  );
}

// Body del lote: filas ya normalizadas (clave = header, valor = texto) + dryRun.
// El tope por lote es defensivo; el tope GLOBAL de filas lo aplica el cliente.
const chunkBodySchema = z.object({
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1, "el lote no puede estar vacío")
    .max(cargaMasivaConfig.MAX_CHUNK_ROWS, "el lote excede el máximo permitido"),
  dryRun: z.boolean().optional().default(false),
});

/**
 * Lógica del endpoint, extraída para inyección de dependencias en tests
 * (actor + service fake), sin DB ni cookies reales.
 */
export async function handleCargaMasivaChunk(
  req: Request,
  deps: CargaMasivaChunkDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    // Autorización antes de tocar el cuerpo (defensa en profundidad; el service
    // vuelve a autorizar).
    if (actor.rol !== "adminTienda") throw new ForbiddenError();

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { rows: ["cuerpo JSON inválido"] },
      });
    }

    const parsed = chunkBodySchema.safeParse(json);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors });
    }

    const service = deps.bulkService ?? buildBulkService();
    const cargaResult = await service.cargarMasiva(
      parsed.data.rows as RawRow[],
      actor,
      { dryRun: parsed.data.dryRun },
    );
    if (cargaResult.status === "forbidden") throw new ForbiddenError();
    return cargaResult.summary;
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleCargaMasivaChunk(req);
}
