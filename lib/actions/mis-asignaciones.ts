"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenMensajeroMetaRepository } from "@/lib/repositories/OrdenMensajeroMetaRepository";
import { RutaOptimizadaRepository } from "@/lib/repositories/RutaOptimizadaRepository";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { gestionConfig, type GestionMimeType } from "@/lib/config/gestion";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  EvidenciaArchivo,
  GestionarInput,
  IMisAsignacionesService,
  RecogerInput,
} from "@/lib/interfaces/services/IMisAsignacionesService";
import {
  escogerSchema,
  gestionarSchema,
  liberarSchema,
  recogerSchema,
  type EscogerResult,
  type GestionarActionInput,
  type GestionarResult,
  type LiberarResult,
  type ListarMisAsignacionesResult,
  type RecogerResult,
} from "@/lib/types/gestion-orden";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 36 — Server Actions del flujo del mensajero (mutaciones internas del
// mismo proyecto; van como Server Action, no como Route API, patron feature 21).
// Resuelve el actor por sesion, valida en el borde con zod y delega en el
// servicio, TODO bajo `withErrorHandler` (patron ordenes-guia.ts): un error
// EXCEPCIONAL (caida de DB en la tx, fallo de storage) se loguea/normaliza a
// AppErrorShape en vez de propagarse crudo. `unauthenticated` se resuelve en el
// borde (UNAUTHORIZED); `forbidden`/`conflict`/`validation_error` los devuelve el
// service como resultado de dominio (nunca como excepcion).

// Traduce el AppErrorShape que puede producir este borde: solo ZodError
// (VALIDATION_ERROR) o falta de sesion (UNAUTHORIZED). `forbidden`/`conflict` los
// devuelve el service directamente como resultado de dominio, por eso NO aparecen
// aqui. Espejo EXACTO de `toGuiaActionError` en ordenes-guia.ts.
function toMisAsignacionesActionError(
  shape: AppErrorShape,
): { status: "validation_error"; fieldErrors: Record<string, string[]> } | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      // FORBIDDEN/NOT_FOUND/CONFLICT/INTERNAL: este borde nunca los lanza como
      // AppError; si algo desconocido llega aqui, se propaga como fallo real.
      throw new Error(`mis-asignaciones: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IMisAsignacionesService {
  const prisma = getPrismaClient();
  // Reusa la infraestructura de Storage de la feature 21/22 apuntando al bucket
  // NUEVO de evidencias (constructor acepta el bucket, R8/T7).
  return new MisAsignacionesService(
    new GestionOrdenRepository(prisma),
    new OrdenRepository(prisma),
    new SupabaseFileStorage(undefined, gestionConfig.EVIDENCIA_BUCKET),
    new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET),
    // Feature 92 (R23/R28): secuencia optimizada al listar + persistencia del origen `gps`.
    // Feature 99 (R29): la decision de reintento/escalado de una devolucion ya NO vive aqui
    // (se relocalizo al cron SLA), por eso el service ya no recibe el derivador de intentos ni
    // la zona central.
    new RutaOptimizadaRepository(prisma),
    // Feature 115 (R17/R20): meta-repo para reflejar la marca "gestionar mas tarde" del actor.
    new OrdenMensajeroMetaRepository(prisma),
  );
}

export interface MisAsignacionesDeps {
  service?: IMisAsignacionesService;
  getActor?: () => Promise<Actor | null>;
}

/** File-like: lo que necesitamos para leer el binario de la evidencia. */
interface FileLike {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** R9-R13: dos grupos + puntero de bloqueo; solo `mensajero`. */
export async function listarMisAsignaciones(
  deps: MisAsignacionesDeps = {},
): Promise<ListarMisAsignacionesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R12: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.listarMisAsignaciones(actor!);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R14-R17: recoger (lote o de a una) por_recoger -> en_reparto. */
export async function recogerAsignaciones(
  input: unknown,
  deps: MisAsignacionesDeps = {},
): Promise<RecogerResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recogerSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    // Feature 92/R22: `ubicacion` ya validada por `recogerSchema` (rangos [-90,90] /
    // [-180,180]). Ausente = el navegador no la dio o el permiso esta denegado: R25 exige
    // que eso NO bloquee la recogida.
    const recogerInput: RecogerInput = { ordenIds: data.ordenIds, ubicacion: data.ubicacion };
    return service.recogerAsignaciones(recogerInput, actor);
  });
  return isAppErrorShape(r) ? toMisAsignacionesActionError(r) : r;
}

/** R19-R21: escoger una orden para gestionar (fija el bloqueo 1-a-1). */
export async function escogerParaGestion(
  input: unknown,
  deps: MisAsignacionesDeps = {},
): Promise<EscogerResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = escogerSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.escogerParaGestion(data.ordenId, actor);
  });
  return isAppErrorShape(r) ? toMisAsignacionesActionError(r) : r;
}

/**
 * R18/R22-R32: registra la gestion. Recibe FormData (campos + File de evidencia en
 * entrega/rechazo): las Server Actions soportan archivos nativamente y evita crear
 * una Route API (patron feature 21). Revalida MIME/tamano de la foto en servidor
 * via el schema discriminado (R24).
 */
export async function gestionar(
  formData: FormData,
  deps: MisAsignacionesDeps = {},
): Promise<GestionarResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const raw = rawFromFormData(formData);
    const data = gestionarSchema.parse(raw); // ZodError -> VALIDATION_ERROR
    const input = await toGestionarInput(data);
    const service = deps.service ?? buildService();
    return service.gestionar(input, actor);
  });
  return isAppErrorShape(r) ? toMisAsignacionesActionError(r) : r;
}

/**
 * R35: libera el puntero de bloqueo (`usuario.orden_en_gestion_id`) del PROPIO
 * actor cuando cancela/cierra la gestion sin registrar un resultado. Delega en el
 * service, que solo limpia si el puntero apunta a esa orden (concurrencia-seguro,
 * idempotente).
 */
export async function liberarGestion(
  input: unknown,
  deps: MisAsignacionesDeps = {},
): Promise<LiberarResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = liberarSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.liberarGestion(data.ordenId, actor);
  });
  return isAppErrorShape(r) ? toMisAsignacionesActionError(r) : r;
}

/** Extrae los campos de gestion del FormData (montoRecibido a number). */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const campo of [
    "ordenId",
    "resultado",
    "metodoPago",
    "fechaReprogramacion",
    "motivo",
    "causaDevolucion", // feature 73: campo de texto -> entra por el bucle, sin coercion
  ]) {
    const value = formData.get(campo);
    if (value !== null) raw[campo] = value;
  }
  const monto = formData.get("montoRecibido");
  if (monto !== null && monto !== "") raw.montoRecibido = Number(monto);
  // Feature 119 (R5): la evidencia pasa de UNA a 1..N fotos. Se leen TODAS las entradas de la
  // misma clave `evidencia` (`getAll`) —el panel hace `append("evidencia", file)` por foto— y
  // se filtran las strings (un File-like tiene `arrayBuffer`). Se expone como `raw.evidencias`.
  // El panel sin migrar (T11) aun manda UN solo `evidencia`: `getAll` lo lee como lista de 1.
  const evidencias = formData
    .getAll("evidencia")
    .filter((v): v is Exclude<FormDataEntryValue, string> => typeof v !== "string");
  if (evidencias.length > 0) raw.evidencias = evidencias;
  // Feature 92/R22: la geolocalizacion viaja como DOS campos escalares del FormData
  // (`ubicacionLat`/`ubicacionLng`) y se recompone aqui. Solo se arma el objeto si vienen
  // LOS DOS: media coordenada no es una ubicacion, y dejarla a medias haria que zod la
  // rechazara y tumbara toda la gestion por un dato auxiliar (R25 lo prohibe).
  const lat = formData.get("ubicacionLat");
  const lng = formData.get("ubicacionLng");
  if (lat !== null && lat !== "" && lng !== null && lng !== "") {
    raw.ubicacion = { lat: Number(lat), lng: Number(lng) };
  }
  return raw;
}

/** Lee el binario de la evidencia (si aplica) y arma el input del servicio. */
async function toGestionarInput(data: GestionarActionInput): Promise<GestionarInput> {
  // Feature 92/R22: `ubicacion` es transversal a las cuatro ramas (interseccion en el
  // tipo del service), asi que se adjunta una sola vez en vez de repetirla cuatro veces.
  const ubicacion = data.ubicacion;
  switch (data.resultado) {
    case "entregada":
      return {
        ubicacion,
        ordenId: data.ordenId,
        resultado: "entregada",
        montoRecibido: data.montoRecibido,
        metodoPago: data.metodoPago,
        evidencias: await leerEvidencias(data.evidencias as unknown as FileLike[]),
      };
    case "reprogramada":
      return {
        ubicacion,
        ordenId: data.ordenId,
        resultado: "reprogramada",
        fechaReprogramacion: data.fechaReprogramacion,
        motivo: data.motivo,
      };
    case "devuelta":
      return {
        ubicacion,
        ordenId: data.ordenId,
        resultado: "devuelta",
        causaDevolucion: data.causaDevolucion, // feature 73/R6
        motivo: data.motivo,
        evidencias: await leerEvidencias(data.evidencias as unknown as FileLike[]), // feature 75/119
      };
    case "rechazada":
      return {
        ubicacion,
        ordenId: data.ordenId,
        resultado: "rechazada",
        motivo: data.motivo,
        evidencias: await leerEvidencias(data.evidencias as unknown as FileLike[]),
      };
  }
}

async function leerEvidencia(file: FileLike): Promise<EvidenciaArchivo> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { contentType: file.type as GestionMimeType, bytes };
}

// Feature 119 (R5): lee el binario de las N fotos (en el ORDEN en que llegaron -> indice 0..N-1).
async function leerEvidencias(files: FileLike[]): Promise<EvidenciaArchivo[]> {
  return Promise.all(files.map(leerEvidencia));
}
