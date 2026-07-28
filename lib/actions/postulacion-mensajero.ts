"use server";

import { headers } from "next/headers";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { PostulacionRepository } from "@/lib/repositories/PostulacionRepository";
import { PostulacionMensajeroService } from "@/lib/services/PostulacionMensajeroService";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { notificarPostulacionPendienteReal } from "@/lib/notificaciones/notificadores";
import { ResetRateLimiter } from "@/lib/utils/reset-rate-limit";
import { postulacionConfig } from "@/lib/config/postulacion";
import type { IPostulacionMensajeroService } from "@/lib/interfaces/services/IPostulacionMensajeroService";
import {
  DOCUMENTO_TIPOS,
  postulacionSchema,
  type DocumentoTipo,
  type PostulacionArchivo,
  type PostularMensajeroActionResult,
} from "@/lib/types/postulacion-mensajero";
import type { PostulacionMimeType } from "@/lib/config/postulacion";

// Feature 21 — Server Action PUBLICA de postulacion de mensajero. Es una mutacion
// interna desde el propio formulario (no API publica), asi que va como Server
// Action (architecture.md). NO lee ni setea cookies: la accion es publica y NO
// concede sesion (R22). Endurecida con rate-limiting por IP|email (A4).

export interface RequestContext {
  ipAddress: string;
}

// Limitador por proceso (misma instancia entre invocaciones) para que la ventana
// deslizante persista, patron de password-reset (feature 20).
const postulacionLimiter = new ResetRateLimiter();

function buildRateKey(ip: string, email: string): string {
  return `postulacion:${ip}|${email.toLowerCase()}`;
}

async function requestContextFromHeaders(): Promise<RequestContext> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const ipAddress = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : (requestHeaders.get("x-real-ip") ?? "unknown");
  return { ipAddress };
}

function buildService(): IPostulacionMensajeroService {
  const prisma = getPrismaClient();
  return new PostulacionMensajeroService(
    new PostulacionRepository(prisma),
    new SupabaseFileStorage(),
    // Feature 146/R23: COMPOSITION ROOT del aviso "postulacion pendiente". El notificador real
    // se cablea aqui —donde ya vive el acceso a la base— y NO como default del service, para
    // que un service construido sin cablear (dobles de test) no pueda escribir en la base.
    notificarPostulacionPendienteReal,
  );
}

/** File-like: lo que necesitamos para leer el binario de un documento. */
interface FileLike {
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface PostulacionDeps {
  service?: IPostulacionMensajeroService;
  getContext?: () => Promise<RequestContext>;
  limiter?: ResetRateLimiter;
}

/**
 * Recibe FormData (campos de texto + 5 File), valida en el borde con zod, aplica
 * el limite de tasa y delega en el servicio. Traduce el resultado del servicio a
 * PostularMensajeroActionResult. No requiere ni concede sesion (R22).
 */
export async function postularMensajero(
  formData: FormData,
  deps: PostulacionDeps = {},
): Promise<PostularMensajeroActionResult> {
  const raw: Record<string, unknown> = {};
  for (const campo of [
    "nombre",
    "primer_apellido",
    "segundo_apellido",
    "email",
    "telefono",
    "tipo_identificacion_id",
    "cedula",
    "vehiculo_id",
    "placa",
    "password",
    "confirmacion_password",
  ]) {
    const value = formData.get(campo);
    if (value !== null) raw[campo] = value;
  }
  for (const tipo of DOCUMENTO_TIPOS) {
    const file = formData.get(tipo);
    if (file !== null) raw[tipo] = file;
  }

  const parsed = postulacionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const limiter = deps.limiter ?? postulacionLimiter;
  const context = await (deps.getContext ?? requestContextFromHeaders)();
  const rateKey = buildRateKey(context.ipAddress, parsed.data.email);
  if (
    limiter.superaLimite(
      rateKey,
      postulacionConfig.RATE_MAX,
      postulacionConfig.RATE_WINDOW_MINUTES * 60_000,
    )
  ) {
    return { status: "rate_limited" }; // A4
  }
  limiter.registrar(rateKey);

  // Leer los 5 binarios del FormData (los File ya pasaron tipo/tamano en zod).
  const documentos = {} as Record<DocumentoTipo, PostulacionArchivo>;
  for (const tipo of DOCUMENTO_TIPOS) {
    const file = parsed.data[tipo] as unknown as FileLike;
    const bytes = new Uint8Array(await file.arrayBuffer());
    documentos[tipo] = { contentType: file.type as PostulacionMimeType, bytes };
  }

  const service = deps.service ?? buildService();
  return service.postular({
    nombre: parsed.data.nombre,
    primerApellido: parsed.data.primer_apellido,
    segundoApellido: parsed.data.segundo_apellido,
    email: parsed.data.email,
    telefono: parsed.data.telefono,
    tipoIdentificacionId: parsed.data.tipo_identificacion_id,
    cedula: parsed.data.cedula,
    vehiculoId: parsed.data.vehiculo_id,
    placa: parsed.data.placa,
    password: parsed.data.password,
    documentos,
  });
}
