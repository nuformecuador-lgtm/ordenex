"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
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
  recogerSchema,
  type EscogerResult,
  type GestionarActionInput,
  type GestionarResult,
  type ListarMisAsignacionesResult,
  type RecogerResult,
} from "@/lib/types/gestion-orden";

// Feature 36 — Server Actions del flujo del mensajero (mutaciones internas del
// mismo proyecto; van como Server Action, no como Route API, patron feature 21).
// Resuelve el actor por sesion, valida en el borde con zod y delega en el
// servicio. `unauthenticated` se resuelve en el borde; `forbidden`/`conflict`/
// `validation_error` los devuelve el service como resultado de dominio.

function buildService(): IMisAsignacionesService {
  const prisma = getPrismaClient();
  // Reusa la infraestructura de Storage de la feature 21/22 apuntando al bucket
  // NUEVO de evidencias (constructor acepta el bucket, R8/T7).
  return new MisAsignacionesService(
    new GestionOrdenRepository(prisma),
    new OrdenRepository(prisma),
    new SupabaseFileStorage(undefined, gestionConfig.EVIDENCIA_BUCKET),
    new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET),
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
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R12: antes de tocar el service
  const service = deps.service ?? buildService();
  return service.listarMisAsignaciones(actor);
}

/** R14-R17: recoger (lote o de a una) en_espera_aceptacion -> en_reparto. */
export async function recogerAsignaciones(
  input: unknown,
  deps: MisAsignacionesDeps = {},
): Promise<RecogerResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  const parsed = recogerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const service = deps.service ?? buildService();
  const recogerInput: RecogerInput = { ordenIds: parsed.data.ordenIds };
  return service.recogerAsignaciones(recogerInput, actor);
}

/** R19-R21: escoger una orden para gestionar (fija el bloqueo 1-a-1). */
export async function escogerParaGestion(
  input: unknown,
  deps: MisAsignacionesDeps = {},
): Promise<EscogerResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  const parsed = escogerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const service = deps.service ?? buildService();
  return service.escogerParaGestion(parsed.data.ordenId, actor);
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
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const raw = rawFromFormData(formData);
  const parsed = gestionarSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = await toGestionarInput(parsed.data);
  const service = deps.service ?? buildService();
  return service.gestionar(input, actor);
}

/** Extrae los campos de gestion del FormData (montoRecibido a number). */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const campo of ["ordenId", "resultado", "metodoPago", "fechaReprogramacion", "motivo"]) {
    const value = formData.get(campo);
    if (value !== null) raw[campo] = value;
  }
  const monto = formData.get("montoRecibido");
  if (monto !== null && monto !== "") raw.montoRecibido = Number(monto);
  const evidencia = formData.get("evidencia");
  if (evidencia !== null && typeof evidencia !== "string") raw.evidencia = evidencia;
  return raw;
}

/** Lee el binario de la evidencia (si aplica) y arma el input del servicio. */
async function toGestionarInput(data: GestionarActionInput): Promise<GestionarInput> {
  switch (data.resultado) {
    case "entregada":
      return {
        ordenId: data.ordenId,
        resultado: "entregada",
        montoRecibido: data.montoRecibido,
        metodoPago: data.metodoPago,
        evidencia: await leerEvidencia(data.evidencia as unknown as FileLike),
      };
    case "reprogramada":
      return {
        ordenId: data.ordenId,
        resultado: "reprogramada",
        fechaReprogramacion: data.fechaReprogramacion,
        motivo: data.motivo,
      };
    case "devuelta":
      return { ordenId: data.ordenId, resultado: "devuelta", motivo: data.motivo };
    case "rechazada":
      return {
        ordenId: data.ordenId,
        resultado: "rechazada",
        motivo: data.motivo,
        evidencia: await leerEvidencia(data.evidencia as unknown as FileLike),
      };
  }
}

async function leerEvidencia(file: FileLike): Promise<EvidenciaArchivo> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { contentType: file.type as GestionMimeType, bytes };
}
