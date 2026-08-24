"use server";

import { gestionConfig, type GestionMimeType } from "@/lib/config/gestion";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { isAppErrorShape, UnauthenticatedError, withErrorHandler } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type {
  GestionDesdeAyudaInput,
  IGestionDesdeAyudaService,
} from "@/lib/interfaces/services/IGestionDesdeAyudaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenNotaRepository } from "@/lib/repositories/OrdenNotaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GestionDesdeAyudaService } from "@/lib/services/GestionDesdeAyudaService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import {
  gestionarDesdeAyudaSchema,
  type GestionarDesdeAyudaResult,
} from "@/lib/types/gestion-desde-ayuda";

// Feature 237 (design §11, T5.4) — Server Action de la gestion que la TIENDA registra desde la
// pestaña de ayuda.
//
// Va como Server Action y no como Route API porque es una mutacion INTERNA del mismo proyecto
// (`docs/architecture.md`), y recibe `FormData` porque viajan archivos: las Server Actions los
// soportan nativamente, con el MISMO contrato de clave repetida (`evidencia`) que el panel del
// mensajero y que `ReportarIncidenteModal`.
//
// Este archivo es tambien el COMPOSITION ROOT: el unico sitio donde se instancian los repos
// concretos y el storage. Todo bajo `withErrorHandler`: un error EXCEPCIONAL (caida de DB, fallo
// de Storage) se normaliza a `AppErrorShape`; `unauthenticated` (UNAUTHORIZED) y
// `validation_error` (ZodError) se resuelven aqui, y `forbidden`/`conflict` los devuelve el
// servicio como resultado de DOMINIO, nunca como excepcion.

/** Espejo EXACTO de `toMisAsignacionesActionError` / `toIncidenteActionError`. */
function toGestionDesdeAyudaActionError(
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
      throw new Error(`gestion-desde-ayuda: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IGestionDesdeAyudaService {
  const prisma = getPrismaClient();
  const ordenRepo = new OrdenRepository(prisma);
  return new GestionDesdeAyudaService({
    // El MISMO repositorio del hilo: la autorizacion sale de la misma lectura que gobierna quien
    // puede escribir en la conversacion de la orden (R21), no de una tabla de permisos aparte.
    notaRepo: new OrdenNotaRepository(prisma),
    ordenRepo,
    gestionRepo: new GestionOrdenRepository(prisma),
    // 💰 FEATURE 273 (T5, R1/R4): EL CABLEADO DE LA PUERTA DEL TOPE. Es el MISMO servicio de
    // historial que inyectan el panel del mensajero y el cron de SLA, asi que el numero que
    // decide aqui es el mismo numero que ven las otras superficies (215/R4/R6). La dependencia
    // es OBLIGATORIA en `GestionDesdeAyudaDeps`: borrar esta linea rompe el typecheck, no deja
    // la puerta abierta en silencio.
    historial: new OrdenHistorialService(
      ordenRepo,
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
    // MISMO bucket privado y MISMOS limites que las evidencias de gestion (36/119) y de incidente
    // (158). Lo que distingue las fotos de esta via es el prefijo del path, no el bucket.
    storage: new SupabaseFileStorage(undefined, gestionConfig.EVIDENCIA_BUCKET),
  });
}

export interface GestionDesdeAyudaDepsAction {
  service?: IGestionDesdeAyudaService;
  getActor?: () => Promise<Actor | null>;
}

/** File-like: lo minimo para leer el binario de una evidencia (patron de las otras dos vias). */
interface FileLike {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * R1/R12/R13/R14 — registra el desenlace que la tienda eligio sobre una orden en ayuda.
 *
 * El orden de las tres primeras lineas NO es casual: la SESION se resuelve ANTES de parsear y
 * antes de construir el servicio, asi que un anonimo se lleva `unauthenticated` sin que el
 * servicio reciba ni una llamada y sin que se lea ningun archivo del `FormData`.
 *
 * SUPERFICIE (T7, 2026-08-20): la dispara `GestionarDesdeAyudaModal`, que monta `NovedadesModule`
 * desde la pestaña «Ayuda solicitada» de `/novedades`. Aqui vivio la anotacion de excepcion de
 * superficie mientras el backend aterrizaba un commit antes que su pantalla (la zona es
 * `fullstack` y se secuencia backend -> frontend); se RETIRO al cablear la ventana, que es lo que
 * la guardia de superficie exige en cuanto el export vuelve a ser alcanzable.
 */
export async function gestionarDesdeAyuda(
  formData: FormData,
  deps: GestionDesdeAyudaDepsAction = {},
): Promise<GestionarDesdeAyudaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    // R13: el borde REVALIDA tipo, tamaño y numero de imagenes con el mismo schema que la
    // ventana, y no depende de la interfaz para hacerlos cumplir. Un `resultado` fuera de los dos
    // literales tampoco parsea (R1). ZodError -> VALIDATION_ERROR.
    const data = gestionarDesdeAyudaSchema.parse(rawFromFormData(formData));
    const input = {
      ...data,
      evidencias: await leerEvidencias(data.evidencias as unknown as FileLike[]),
    } as GestionDesdeAyudaInput;
    const service = deps.service ?? buildService();
    return service.gestionar(input, actor);
  });
  return isAppErrorShape(r) ? toGestionDesdeAyudaActionError(r) : r;
}

/** Extrae los campos del `FormData`. Ninguno lleva coercion: son texto y archivos. */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const campo of ["ordenId", "resultado", "motivo", "fechaReprogramacion"]) {
    const value = formData.get(campo);
    if (value !== null) raw[campo] = value;
  }
  // Se leen TODAS las entradas de la clave `evidencia` (`getAll`) —la ventana hace
  // `append("evidencia", file)` por foto— y se filtran las strings (un File-like tiene
  // `arrayBuffer`). Mismo contrato que el panel del mensajero y que el modal de incidente.
  const evidencias = formData
    .getAll("evidencia")
    .filter((v): v is Exclude<FormDataEntryValue, string> => typeof v !== "string");
  if (evidencias.length > 0) raw.evidencias = evidencias;
  return raw;
}

/**
 * Lee el binario de las N fotos EN EL ORDEN en que llegaron, que es de donde sale el indice
 * 0..N-1 (y con el, la portada denormalizada de la 119/R12).
 *
 * Este helper esta duplicado a proposito (design §5): ya existe igual en `mis-asignaciones.ts` y
 * en `incidentes.ts`, y esta ficha NO lo extrae. Es lectura de `FormData`, no compensacion: su
 * duplicacion no puede dejar basura en Storage, que es lo que hacia obligatorio unificar el otro.
 * Se dice aqui para que la asimetria sea una decision y no un descuido.
 */
async function leerEvidencias(
  files: FileLike[],
): Promise<{ contentType: GestionMimeType; bytes: Uint8Array }[]> {
  return Promise.all(
    files.map(async (file) => ({
      contentType: file.type as GestionMimeType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}
