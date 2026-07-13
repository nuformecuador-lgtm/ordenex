// Feature 15 — Route Handler de carga masiva de ordenes. Capa Controller: solo
// HTTP + zod/limites de borde; delega toda la logica de negocio en
// BulkOrdenService (docs/architecture.md, patron Controller -> Service -> Repo).
import { NextResponse } from "next/server";
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
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { parseSpreadsheet } from "@/lib/parsers/spreadsheet";
import { findMissingHeaders } from "@/lib/types/carga-masiva";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";

export interface CargaMasivaDeps {
  getActor?: () => Promise<Actor | null>;
  bulkService?: IBulkOrdenService;
}

function buildBulkService(): IBulkOrdenService {
  const prisma = getPrismaClient();
  return new BulkOrdenService(new OrdenRepository(prisma));
}

/** Extension en minusculas sin punto (p.ej. "csv"), o "" si no hay. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/**
 * Logica del endpoint, extraida de `POST` para permitir inyeccion de
 * dependencias en tests de integracion (actor + service fake), sin requerir
 * DB real ni cookies reales.
 */
export async function handleCargaMasiva(
  req: Request,
  deps: CargaMasivaDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R10

    // R11: autorizacion ANTES de tocar el archivo ("sin procesar el archivo").
    // BulkOrdenService.cargarMasiva vuelve a autorizar de forma independiente
    // (defensa en profundidad / uso directo en tests), pero el borde HTTP no
    // puede esperar a parsear el archivo para saber si debe rechazar.
    if (actor.rol !== "adminTienda") throw new ForbiddenError();

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      // R12: archivo ausente bajo el campo "file" (nombre por defecto de BulkUpload).
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { file: ["archivo requerido"] },
      });
    }

    const ext = extensionOf(file.name);
    if (ext !== "csv" && ext !== "xlsx") {
      // R13: tipo no soportado, rechazado antes de intentar parsear.
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { file: ["tipo de archivo no soportado; use .csv o .xlsx"] },
      });
    }
    if (file.size > cargaMasivaConfig.MAX_FILE_BYTES) {
      // R28: tamano maximo, antes de leer el contenido.
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { file: ["el archivo excede el tamano maximo permitido"] },
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { headers, rows } = await parseSpreadsheet(buffer, ext);

    const missingHeaders = findMissingHeaders(headers);
    if (missingHeaders.length > 0) {
      // R16: columnas obligatorias ausentes en la cabecera.
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { headers: [`columnas obligatorias ausentes: ${missingHeaders.join(", ")}`] },
      });
    }
    if (rows.length === 0) {
      // R17: archivo sin filas de datos.
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { file: ["archivo sin filas"] },
      });
    }
    if (rows.length > cargaMasivaConfig.MAX_ROWS) {
      // R28: numero maximo de filas, antes de persistir.
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { file: ["el archivo excede el numero maximo de filas permitido"] },
      });
    }

    const service = deps.bulkService ?? buildBulkService();
    const cargaResult = await service.cargarMasiva(rows, actor);
    if (cargaResult.status === "forbidden") throw new ForbiddenError(); // R11
    return cargaResult.summary; // R30
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result); // R31
  return NextResponse.json(result, { status: 200 });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleCargaMasiva(req);
}
