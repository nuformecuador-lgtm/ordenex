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
  ConflictError,
  ValidationError,
  MSG,
} from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IBulkOrdenService } from "@/lib/interfaces/services/IBulkOrdenService";
import {
  CargaLoteAjenoError,
  CargaNombreDuplicadoError,
} from "@/lib/interfaces/repositories/IOrdenRepository";
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
  // Feature 141 (R18): TOKEN del lote EMITIDO POR EL SERVIDOR en el primer chunk y reenviado
  // por el cliente en los siguientes. Ausente = esta petición crea el lote. Debe tener el
  // formato del token (UUID); cualquier otra cosa es error de validación (422) y no crea
  // ninguna orden ni lote. Un token con formato válido pero desconocido/ajeno -> 403 (R19).
  cargaId: z.uuid("cargaId debe ser un UUID").optional(),
  // Feature 141 (R20/R21/R22): nombre OPCIONAL del lote, definido por el usuario. Solo lo
  // persiste la petición que CREA el lote; repetir un nombre propio -> 409 (R24).
  name: z.string().trim().min(1).max(120).optional(),
  // Feature 141 (R29): total de filas de la SESIÓN declarado por el cliente (no el del chunk).
  totalFiles: z.number().int().min(0).optional(),
  // Feature 141/R46: este endpoint NO conoce `download_type`; una clave desconocida en el
  // cuerpo se ignora (el schema no es `.strict()`), como hasta ahora.
});

/**
 * Feature 141: traduce los dos errores de dominio del lote a códigos del borde.
 * - `CargaLoteAjenoError` (token desconocido o de otro usuario) -> 403 (R19).
 * - `CargaNombreDuplicadoError` (el actor ya tiene un lote con ese nombre) -> 409 (R24),
 *   con el nombre duplicado en el mensaje.
 * En ambos casos la transacción del repositorio ya revirtió: la petición no creó órdenes.
 * Cualquier otro error se propaga tal cual al manejador genérico.
 */
async function ejecutarCarga(
  service: IBulkOrdenService,
  body: { rows: unknown[]; dryRun: boolean; cargaId?: string; name?: string; totalFiles?: number },
  actor: Actor,
) {
  try {
    return await service.cargarMasiva(body.rows as RawRow[], actor, {
      dryRun: body.dryRun,
      cargaId: body.cargaId,
      name: body.name,
      totalFiles: body.totalFiles,
    });
  } catch (err) {
    if (err instanceof CargaLoteAjenoError) throw new ForbiddenError();
    if (err instanceof CargaNombreDuplicadoError) throw new ConflictError(err.message);
    throw err;
  }
}

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
    const cargaResult = await ejecutarCarga(service, parsed.data, actor);
    if (cargaResult.status === "forbidden") throw new ForbiddenError();
    return cargaResult.summary;
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleCargaMasivaChunk(req);
}
