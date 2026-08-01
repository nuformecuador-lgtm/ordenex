"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { IncidenteAdminRepository } from "@/lib/repositories/IncidenteAdminRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { IncidenteAdminService } from "@/lib/services/IncidenteAdminService";
import { WalletIndemnizacionIncidenteFeedService } from "@/lib/services/WalletIndemnizacionIncidenteFeedService";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { gestionConfig, type GestionMimeType } from "@/lib/config/gestion";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IIncidenteAdminService,
  ReportarIncidenteInput,
} from "@/lib/interfaces/services/IIncidenteAdminService";
import {
  aprobarIncidenteSchema,
  incidenteIdSchema,
  listarHistoricoIncidentesSchema,
  listarPendientesIncidentesSchema,
  rechazarIncidenteSchema,
  reportarIncidenteSchema,
  retractarIncidenteSchema,
  type AprobarIncidenteResult,
  type ListarHistoricoIncidentesResult,
  type ListarIncidentesResult,
  type ListarPendientesIncidentesResult,
  type RechazarIncidenteResult,
  type ReportarIncidenteResult,
  type RetractarIncidenteResult,
  type VerIncidenteResult,
} from "@/lib/types/incidente";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 158 (T1.31, camino del ADMIN) — Server Actions del incidente reportado por un admin.
// Son MUTACIONES INTERNAS del mismo proyecto, asi que van como Server Action y no como Route API
// (`docs/architecture.md`), patron `lib/actions/cierres-admin.ts`. Este archivo es tambien el
// COMPOSITION ROOT: es el unico sitio donde se instancian los repos concretos, el storage, el
// proveedor de URLs firmadas y el feed del egreso.
//
// Todo bajo `withErrorHandler`: un error EXCEPCIONAL (caida de DB, fallo de storage) se
// normaliza a `AppErrorShape`. `unauthenticated` (UNAUTHORIZED) y `validation_error` (ZodError)
// se resuelven en el borde; el resto (`forbidden`/`no_encontrada`/`conflict`) los devuelve el
// service como resultado de DOMINIO, nunca como excepcion.

/** Espejo EXACTO de `toCierresAdminActionError`. */
function toIncidenteActionError(
  shape: AppErrorShape,
):
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`incidentes: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IIncidenteAdminService {
  const prisma = getPrismaClient();
  return new IncidenteAdminService(
    new IncidenteAdminRepository(
      prisma,
      // Feature 42: el MISMO repo del libro que usa la aprobacion del cierre. La idempotencia
      // del egreso sale de su `createMany({ skipDuplicates })` sobre el indice unico parcial.
      new WalletMovimientoRepository(prisma),
      // Feature 158/R52: el SEGUNDO (y ultimo) emisor de `egreso_indemnizacion`. Sin
      // dependencias externas: LEE de la propia tx el monto que la aprobacion acaba de escribir.
      new WalletIndemnizacionIncidenteFeedService(),
    ),
    new OrdenRepository(prisma),
    // Feature 149, reusado TAL CUAL: el destino de la reversion se deriva del historial
    // inmutable con `findOrigenesReversion`, no de un estado fijo escrito en el codigo (R57).
    new OrdenHistorialRepository(prisma),
    // Evidencias: MISMO bucket privado que las de gestion (feature 36/119), con los mismos
    // limites. Un incidente y una gestion sobre la misma orden se distinguen por el prefijo del
    // path, no por el bucket.
    new SupabaseFileStorage(undefined, gestionConfig.EVIDENCIA_BUCKET),
    new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET),
  );
}

export interface IncidentesDeps {
  service?: IIncidenteAdminService;
  getActor?: () => Promise<Actor | null>;
}

/** File-like: lo que necesitamos para leer el binario de una evidencia. */
interface FileLike {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** R49: las dos colas del alcance del actor. */
export async function listarIncidentes(
  deps: IncidentesDeps = {},
): Promise<ListarIncidentesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.service ?? buildService();
    return service.listarIncidentes(actor);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41/R44): UNA pagina del HISTORICO de incidentes del
 * alcance + el total. La zona no viaja en el input: la resuelve el servicio desde el actor.
 */
export async function listarHistoricoIncidentesPaginado(
  input: unknown,
  deps: IncidentesDeps = {},
): Promise<ListarHistoricoIncidentesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarHistoricoIncidentesSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarHistoricoIncidentesPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toIncidenteActionError(r) : r;
}

/**
 * Feature 170 — FASE 2 (T J.1, R40/R41/R42/R44): UNA pagina de la COLA de incidentes
 * PENDIENTES de decision del alcance + el total de la cabecera. La zona no viaja en el input:
 * la resuelve el servicio desde el actor.
 */
export async function listarPendientesIncidentesPaginado(
  input: unknown,
  deps: IncidentesDeps = {},
): Promise<ListarPendientesIncidentesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarPendientesIncidentesSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPendientesIncidentesPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toIncidenteActionError(r) : r;
}

/** R46/R48: detalle de un incidente del alcance, con las evidencias FIRMADAS. */
export async function verIncidente(
  input: unknown,
  deps: IncidentesDeps = {},
): Promise<VerIncidenteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = incidenteIdSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.verIncidente(data.incidenteId, actor);
  });
  return isAppErrorShape(r) ? toIncidenteActionError(r) : r;
}

/**
 * R41/R45/R46 — reporta el incidente. Recibe `FormData` porque lleva las 1..N fotos: las Server
 * Actions soportan archivos nativamente y eso evita crear una Route API solo para subirlos
 * (mismo criterio que `gestionar`, feature 36). El MIME y el tamano se REVALIDAN aqui, en el
 * servidor, con el MISMO `evidenciasSchema` que valida el cliente.
 */
export async function reportarIncidente(
  formData: FormData,
  deps: IncidentesDeps = {},
): Promise<ReportarIncidenteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = reportarIncidenteSchema.parse(rawFromFormData(formData));
    const input: ReportarIncidenteInput = {
      ordenId: data.ordenId,
      causa: data.causa,
      motivo: data.motivo,
      evidencias: await leerEvidencias(data.evidencias as unknown as FileLike[]),
    };
    const service = deps.service ?? buildService();
    return service.reportar(input, actor);
  });
  return isAppErrorShape(r) ? toIncidenteActionError(r) : r;
}

/** R50-R53: aprueba con monto y emite el egreso. **Quien reporta no aprueba** (R51). */
export async function aprobarIncidente(
  input: unknown,
  deps: IncidentesDeps = {},
): Promise<AprobarIncidenteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    // El monto viaja TAL CUAL (STRING, sin coercion a number) hasta el service (R55).
    const data = aprobarIncidenteSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.aprobar(data.incidenteId, data.monto, actor);
  });
  return isAppErrorShape(r) ? toIncidenteActionError(r) : r;
}

/** R54/R57: rechaza con motivo obligatorio y devuelve la orden a su estado de origen. */
export async function rechazarIncidente(
  input: unknown,
  deps: IncidentesDeps = {},
): Promise<RechazarIncidenteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = rechazarIncidenteSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.rechazar(data.incidenteId, data.motivo, actor);
  });
  return isAppErrorShape(r) ? toIncidenteActionError(r) : r;
}

/** R59: el AUTOR retracta su propio incidente `solicitado`. Sin motivo: no hay aprobador. */
export async function retractarIncidente(
  input: unknown,
  deps: IncidentesDeps = {},
): Promise<RetractarIncidenteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = retractarIncidenteSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.retractar(data.incidenteId, actor);
  });
  return isAppErrorShape(r) ? toIncidenteActionError(r) : r;
}

/** Extrae los campos del reporte del FormData. Ninguno lleva coercion: son texto y archivos. */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const campo of ["ordenId", "causa", "motivo"]) {
    const value = formData.get(campo);
    if (value !== null) raw[campo] = value;
  }
  // R46: se leen TODAS las entradas de la clave `evidencia` (`getAll`) —el modal hace
  // `append("evidencia", file)` por foto— y se filtran las strings (un File-like tiene
  // `arrayBuffer`). Mismo contrato que el panel del mensajero.
  const evidencias = formData
    .getAll("evidencia")
    .filter((v): v is Exclude<FormDataEntryValue, string> => typeof v !== "string");
  if (evidencias.length > 0) raw.evidencias = evidencias;
  return raw;
}

async function leerEvidencias(files: FileLike[]): Promise<
  { contentType: GestionMimeType; bytes: Uint8Array }[]
> {
  return Promise.all(
    files.map(async (file) => ({
      contentType: file.type as GestionMimeType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}
